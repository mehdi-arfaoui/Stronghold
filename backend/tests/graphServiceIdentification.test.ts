import assert from 'node:assert/strict';
import test from 'node:test';
import Graph from 'graphology';
import { generateBIA } from '../src/graph/biaEngine.js';
import { analyzeFullGraph } from '../src/graph/graphAnalysisEngine.js';
import type { GraphAnalysisReport, InfraNodeAttrs } from '../src/graph/types.js';
import { NodeType } from '../src/graph/types.js';

function createGraph() {
  return new (Graph as any)({
    type: 'directed',
    multi: false,
    allowSelfLoops: false,
  }) as any;
}

function addNode(
  graph: any,
  input: {
    id: string;
    name: string;
    type: string;
    sourceType?: string;
    region?: string | null;
    availabilityZone?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const metadata = {
    source: 'aws',
    sourceType: input.sourceType || input.type,
    ...(input.metadata || {}),
  };

  graph.addNode(input.id, {
    id: input.id,
    name: input.name,
    type: input.type,
    provider: 'aws',
    region: input.region ?? 'us-east-1',
    availabilityZone: input.availabilityZone ?? null,
    tags: {},
    metadata,
  } satisfies InfraNodeAttrs);
}

function emptyAnalysis(graph: any): GraphAnalysisReport {
  return {
    timestamp: new Date(),
    totalNodes: graph.order,
    totalEdges: graph.size,
    spofs: [],
    criticalityScores: new Map<string, number>(),
    redundancyIssues: [],
    regionalRisks: [],
    circularDeps: [],
    cascadeChains: [],
    resilienceScore: 0,
  };
}

test('BIA identifies all non-infra AWS resources as analyzable services', () => {
  const graph = createGraph();

  addNode(graph, { id: 'ec2-api', name: 'api-server', type: NodeType.VM, sourceType: 'EC2' });
  addNode(graph, { id: 'rds-main', name: 'postgres-main', type: NodeType.DATABASE, sourceType: 'RDS' });
  addNode(graph, { id: 'cache-main', name: 'redis-main', type: NodeType.CACHE, sourceType: 'ELASTICACHE' });
  addNode(graph, { id: 'lambda-order', name: 'order-processor', type: NodeType.SERVERLESS, sourceType: 'LAMBDA' });
  addNode(graph, { id: 'ddb-orders', name: 'orders-table', type: NodeType.DATABASE, sourceType: 'DYNAMODB' });
  addNode(graph, { id: 's3-assets', name: 'assets-bucket', type: NodeType.OBJECT_STORAGE, sourceType: 'S3' });
  addNode(graph, { id: 'sqs-orders', name: 'orders-queue', type: NodeType.MESSAGE_QUEUE, sourceType: 'SQS' });
  addNode(graph, { id: 'sns-events', name: 'order-events', type: NodeType.MESSAGE_QUEUE, sourceType: 'SNS' });

  addNode(graph, { id: 'vpc-main', name: 'main-vpc', type: NodeType.VPC, sourceType: 'VPC' });
  addNode(graph, { id: 'subnet-a', name: 'subnet-a', type: NodeType.SUBNET, sourceType: 'SUBNET' });
  addNode(graph, { id: 'sg-app', name: 'sg-app', type: NodeType.FIREWALL, sourceType: 'SECURITY_GROUP' });
  addNode(graph, { id: 'igw-main', name: 'igw-main', type: NodeType.NETWORK_DEVICE, sourceType: 'INTERNET_GATEWAY' });
  addNode(graph, { id: 'rt-main', name: 'rt-main', type: NodeType.NETWORK_DEVICE, sourceType: 'ROUTE_TABLE' });

  const report = generateBIA(graph, emptyAnalysis(graph));
  const serviceNames = new Set(report.processes.map((process) => process.serviceName));

  assert.equal(serviceNames.has('api-server'), true);
  assert.equal(serviceNames.has('postgres-main'), true);
  assert.equal(serviceNames.has('redis-main'), true);
  assert.equal(serviceNames.has('order-processor'), true);
  assert.equal(serviceNames.has('orders-table'), true);
  assert.equal(serviceNames.has('assets-bucket'), true);
  assert.equal(serviceNames.has('orders-queue'), true);
  assert.equal(serviceNames.has('order-events'), true);

  assert.equal(serviceNames.has('main-vpc'), false);
  assert.equal(serviceNames.has('subnet-a'), false);
  assert.equal(serviceNames.has('sg-app'), false);
  assert.equal(serviceNames.has('igw-main'), false);
  assert.equal(serviceNames.has('rt-main'), false);
});

test('Graph analysis detects explicit EC2/RDS/ElastiCache SPOFs while excluding managed services', async () => {
  const graph = createGraph();

  addNode(graph, {
    id: 'ec2-api',
    name: 'api-server',
    type: NodeType.VM,
    sourceType: 'EC2',
    availabilityZone: 'us-east-1a',
  });
  addNode(graph, {
    id: 'ec2-worker',
    name: 'worker',
    type: NodeType.VM,
    sourceType: 'EC2',
    availabilityZone: 'us-east-1a',
  });
  addNode(graph, {
    id: 'rds-main',
    name: 'postgres-main',
    type: NodeType.DATABASE,
    sourceType: 'RDS',
    metadata: {
      multiAZ: false,
      multi_az: false,
      isMultiAZ: false,
      readReplicaCount: 0,
      replicaCount: 0,
    },
  });
  addNode(graph, {
    id: 'cache-main',
    name: 'redis-main',
    type: NodeType.CACHE,
    sourceType: 'ELASTICACHE',
    metadata: {
      numCacheNodes: 1,
      num_cache_nodes: 1,
      replicaCount: 0,
    },
  });

  addNode(graph, {
    id: 'lambda-order',
    name: 'order-processor',
    type: NodeType.SERVERLESS,
    sourceType: 'LAMBDA',
  });
  addNode(graph, {
    id: 'ddb-orders',
    name: 'orders-table',
    type: NodeType.DATABASE,
    sourceType: 'DYNAMODB',
    metadata: { engine: 'dynamodb' },
  });
  addNode(graph, {
    id: 's3-assets',
    name: 'assets-bucket',
    type: NodeType.OBJECT_STORAGE,
    sourceType: 'S3',
  });
  addNode(graph, {
    id: 'sqs-orders',
    name: 'orders-queue',
    type: NodeType.MESSAGE_QUEUE,
    sourceType: 'SQS',
  });

  graph.addEdgeWithKey('api->db', 'ec2-api', 'rds-main', { type: 'DEPENDS_ON' });
  graph.addEdgeWithKey('worker->cache', 'ec2-worker', 'cache-main', { type: 'DEPENDS_ON' });
  graph.addEdgeWithKey('lambda->queue', 'lambda-order', 'sqs-orders', { type: 'PUBLISHES_TO' });

  const report = await analyzeFullGraph(graph);
  const spofNames = new Set(report.spofs.map((spof) => spof.nodeName));

  assert.equal(spofNames.has('postgres-main'), true);
  assert.equal(spofNames.has('redis-main'), true);
  assert.ok(report.spofs.some((spof) => spof.nodeName === 'api-server' || spof.nodeName === 'worker'));

  assert.equal(spofNames.has('order-processor'), false);
  assert.equal(spofNames.has('orders-table'), false);
  assert.equal(spofNames.has('assets-bucket'), false);
  assert.equal(spofNames.has('orders-queue'), false);

  const queueIssue = report.redundancyIssues.find((issue) => issue.nodeName === 'orders-queue');
  assert.ok(queueIssue);
  assert.ok(queueIssue.failedChecks.some((check) => check.check === 'dlq'));

  const storageIssue = report.redundancyIssues.find((issue) => issue.nodeName === 'assets-bucket');
  assert.equal(storageIssue?.failedChecks.some((check) => check.check === 'backup') ?? false, false);
});

test('BIA keeps tier=1 for regenerate flows when previous tiers exist', () => {
  const graph = createGraph();

  addNode(graph, {
    id: 'svc-checkout',
    name: 'checkout',
    type: NodeType.APPLICATION,
    sourceType: 'ECS_SERVICE',
  });

  const baseline = generateBIA(graph, emptyAnalysis(graph));
  const baselineProcess = baseline.processes.find((process) => process.serviceNodeId === 'svc-checkout');
  assert.ok(baselineProcess);
  assert.equal(baselineProcess.recoveryTier, 2);

  const preserved = generateBIA(graph, emptyAnalysis(graph), {
    preservedTierByServiceNodeId: new Map([['svc-checkout', 1]]),
  });
  const preservedProcess = preserved.processes.find((process) => process.serviceNodeId === 'svc-checkout');
  assert.ok(preservedProcess);
  assert.equal(preservedProcess.recoveryTier, 1);
  assert.equal(preservedProcess.impactCategory, 'critical');
});

test('BIA uses explicit tier metadata when provided on node', () => {
  const graph = createGraph();

  addNode(graph, {
    id: 'svc-identity',
    name: 'identity',
    type: NodeType.APPLICATION,
    sourceType: 'ECS_SERVICE',
    metadata: {
      tier: 1,
    },
  });

  const report = generateBIA(graph, emptyAnalysis(graph));
  const process = report.processes.find((entry) => entry.serviceNodeId === 'svc-identity');
  assert.ok(process);
  assert.equal(process.recoveryTier, 1);
  assert.equal(process.impactCategory, 'critical');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { inferDependencies } from '../src/graph/dependencyInferenceEngine.js';
import { calculateBlastRadius } from '../src/graph/blastRadiusEngine.js';
import { calculateServiceDowntimeCosts } from '../src/services/pricing/downtimeDistribution.js';
import { EdgeType, NodeType } from '../src/graph/types.js';

test('infers SG chain, event mappings, env references, redrive and SNS subscriptions', () => {
  const nodes = [
    {
      id: 'sg-app',
      externalId: 'sg-app',
      name: 'sg-app',
      type: NodeType.FIREWALL,
      provider: 'aws',
      tags: {},
      metadata: {},
    },
    {
      id: 'sg-db',
      externalId: 'sg-db',
      name: 'sg-db',
      type: NodeType.FIREWALL,
      provider: 'aws',
      tags: {},
      metadata: {
        inboundRules: [
          {
            protocol: 'tcp',
            fromPort: 5432,
            toPort: 5432,
            sources: ['sg-app'],
          },
        ],
      },
    },
    {
      id: 'sg-cache',
      externalId: 'sg-cache',
      name: 'sg-cache',
      type: NodeType.FIREWALL,
      provider: 'aws',
      tags: {},
      metadata: {
        inboundRules: [
          {
            protocol: 'tcp',
            fromPort: 6379,
            toPort: 6379,
            sources: ['sg-app'],
          },
        ],
      },
    },
    {
      id: 'ec2-api',
      name: 'api-server',
      type: NodeType.VM,
      provider: 'aws',
      tags: {},
      metadata: { sourceType: 'EC2', securityGroups: ['sg-app'] },
    },
    {
      id: 'ec2-worker',
      name: 'worker',
      type: NodeType.VM,
      provider: 'aws',
      tags: {},
      metadata: { sourceType: 'EC2', securityGroups: ['sg-app'] },
    },
    {
      id: 'rds-main',
      name: 'postgres-main',
      type: NodeType.DATABASE,
      provider: 'aws',
      tags: {},
      metadata: {
        sourceType: 'RDS',
        securityGroups: ['sg-db'],
        endpointAddress: 'db.main.eu-west-1.rds.amazonaws.com',
      },
    },
    {
      id: 'cache-main',
      name: 'cache-main',
      type: NodeType.CACHE,
      provider: 'aws',
      tags: {},
      metadata: {
        sourceType: 'ELASTICACHE',
        securityGroups: ['sg-cache'],
        configurationEndpoint: 'cache.main.0001.cache.amazonaws.com',
      },
    },
    {
      id: 'arn:aws:sqs:eu-west-1:123456789012:orders',
      name: 'orders',
      type: NodeType.MESSAGE_QUEUE,
      provider: 'aws',
      tags: {},
      metadata: {
        sourceType: 'SQS_QUEUE',
        queueArn: 'arn:aws:sqs:eu-west-1:123456789012:orders',
        queueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/orders',
        deadLetterTargetArn: 'arn:aws:sqs:eu-west-1:123456789012:orders-dlq',
        redrivePolicy: JSON.stringify({
          deadLetterTargetArn: 'arn:aws:sqs:eu-west-1:123456789012:orders-dlq',
          maxReceiveCount: 5,
        }),
      },
    },
    {
      id: 'arn:aws:sqs:eu-west-1:123456789012:orders-dlq',
      name: 'orders-dlq',
      type: NodeType.MESSAGE_QUEUE,
      provider: 'aws',
      tags: {},
      metadata: {
        sourceType: 'SQS_QUEUE',
        queueArn: 'arn:aws:sqs:eu-west-1:123456789012:orders-dlq',
      },
    },
    {
      id: 'arn:aws:sns:eu-west-1:123456789012:alerts',
      name: 'alerts',
      type: NodeType.MESSAGE_QUEUE,
      provider: 'aws',
      tags: {},
      metadata: {
        sourceType: 'SNS_TOPIC',
        topicArn: 'arn:aws:sns:eu-west-1:123456789012:alerts',
        subscriptions: [
          {
            protocol: 'lambda',
            endpoint: 'arn:aws:lambda:eu-west-1:123456789012:function:notify',
          },
        ],
      },
    },
    {
      id: 'arn:aws:lambda:eu-west-1:123456789012:function:order-processor',
      name: 'order-processor',
      type: NodeType.SERVERLESS,
      provider: 'aws',
      tags: {},
      metadata: {
        sourceType: 'LAMBDA',
        eventSourceMappings: [
          {
            eventSourceArn: 'arn:aws:sqs:eu-west-1:123456789012:orders',
            batchSize: 10,
            enabled: true,
          },
        ],
        environmentReferences: [
          {
            varName: 'SNS_TOPIC_ARN',
            referenceType: 'arn',
            value: 'arn:aws:sns:eu-west-1:123456789012:alerts',
          },
        ],
      },
    },
    {
      id: 'arn:aws:lambda:eu-west-1:123456789012:function:notify',
      name: 'notify',
      type: NodeType.SERVERLESS,
      provider: 'aws',
      tags: {},
      metadata: { sourceType: 'LAMBDA' },
    },
  ];

  const inferred = inferDependencies(nodes as any, []);
  const edgeKeySet = new Set(inferred.map((edge) => `${edge.source}->${edge.target}:${edge.type}`));

  assert.equal(edgeKeySet.has(`ec2-api->rds-main:${EdgeType.NETWORK_ACCESS}`), true);
  assert.equal(edgeKeySet.has(`ec2-worker->rds-main:${EdgeType.NETWORK_ACCESS}`), true);
  assert.equal(edgeKeySet.has(`ec2-api->cache-main:${EdgeType.NETWORK_ACCESS}`), true);
  assert.equal(edgeKeySet.has(`ec2-worker->cache-main:${EdgeType.NETWORK_ACCESS}`), true);
  assert.equal(
    edgeKeySet.has(
      `arn:aws:sqs:eu-west-1:123456789012:orders->arn:aws:lambda:eu-west-1:123456789012:function:order-processor:${EdgeType.TRIGGERS}`,
    ),
    true,
  );
  assert.equal(
    edgeKeySet.has(
      `arn:aws:lambda:eu-west-1:123456789012:function:order-processor->arn:aws:sns:eu-west-1:123456789012:alerts:${EdgeType.USES}`,
    ),
    true,
  );
  assert.equal(
    edgeKeySet.has(
      `arn:aws:sqs:eu-west-1:123456789012:orders->arn:aws:sqs:eu-west-1:123456789012:orders-dlq:${EdgeType.DEAD_LETTER}`,
    ),
    true,
  );
  assert.equal(
    edgeKeySet.has(
      `arn:aws:sns:eu-west-1:123456789012:alerts->arn:aws:lambda:eu-west-1:123456789012:function:notify:${EdgeType.PUBLISHES_TO_APPLICATIVE}`,
    ),
    true,
  );
});

test('deduplicates identical edges and preserves metadata', () => {
  const nodes = [
    {
      id: 'arn:aws:sns:eu-west-1:123456789012:alerts',
      name: 'alerts',
      type: NodeType.MESSAGE_QUEUE,
      provider: 'aws',
      tags: {},
      metadata: {
        sourceType: 'SNS_TOPIC',
        topicArn: 'arn:aws:sns:eu-west-1:123456789012:alerts',
      },
    },
    {
      id: 'arn:aws:lambda:eu-west-1:123456789012:function:notify',
      name: 'notify',
      type: NodeType.SERVERLESS,
      provider: 'aws',
      tags: {},
      metadata: {
        sourceType: 'LAMBDA',
        environmentReferences: [
          {
            varName: 'SNS_TOPIC_ARN',
            referenceType: 'arn',
            value: 'arn:aws:sns:eu-west-1:123456789012:alerts',
          },
          {
            varName: 'SNS_TOPIC_ARN',
            referenceType: 'arn',
            value: 'arn:aws:sns:eu-west-1:123456789012:alerts',
          },
        ],
      },
    },
  ];

  const inferred = inferDependencies(nodes as any, []);
  const usesEdges = inferred.filter((edge) => edge.type === EdgeType.USES);
  assert.equal(usesEdges.length, 1);
  const detectedBy = Array.isArray(usesEdges[0]?.metadata?.detectedBy)
    ? usesEdges[0].metadata.detectedBy
    : [];
  assert.equal(detectedBy.includes('environment_reference'), true);
});

test('computes blast radius and distributes downtime with override and fallback', () => {
  const nodes = [
    { id: 'db', name: 'postgres', type: NodeType.DATABASE, provider: 'aws', tags: {}, metadata: { sourceType: 'RDS' } },
    { id: 'cache', name: 'redis', type: NodeType.CACHE, provider: 'aws', tags: {}, metadata: { sourceType: 'ELASTICACHE' } },
    { id: 'api', name: 'api', type: NodeType.VM, provider: 'aws', tags: {}, metadata: { sourceType: 'EC2' } },
    { id: 'worker', name: 'worker', type: NodeType.VM, provider: 'aws', tags: {}, metadata: { sourceType: 'EC2' } },
    { id: 'queue', name: 'orders', type: NodeType.MESSAGE_QUEUE, provider: 'aws', tags: {}, metadata: { sourceType: 'SQS_QUEUE' } },
    { id: 'lambda', name: 'processor', type: NodeType.SERVERLESS, provider: 'aws', tags: {}, metadata: { sourceType: 'LAMBDA' } },
  ];

  const edges = [
    { sourceId: 'api', targetId: 'db', type: EdgeType.NETWORK_ACCESS },
    { sourceId: 'worker', targetId: 'db', type: EdgeType.NETWORK_ACCESS },
    { sourceId: 'lambda', targetId: 'db', type: EdgeType.USES },
    { sourceId: 'api', targetId: 'cache', type: EdgeType.NETWORK_ACCESS },
    { sourceId: 'queue', targetId: 'lambda', type: EdgeType.TRIGGERS },
  ];

  const blast = calculateBlastRadius(nodes as any, edges as any);
  const blastByNodeId = new Map(blast.map((entry) => [entry.nodeId, entry]));
  assert.ok((blastByNodeId.get('db')?.transitiveDependents || 0) > (blastByNodeId.get('cache')?.transitiveDependents || 0));

  const costs = calculateServiceDowntimeCosts(
    blast,
    [
      { nodeId: 'db', name: 'postgres', criticality: 'critical' },
      { nodeId: 'cache', name: 'redis', criticality: 'high' },
      { nodeId: 'api', name: 'api', criticality: 'critical' },
    ],
    {
      estimatedDowntimeCostPerHour: 10000,
      serviceOverrides: [{ nodeId: 'api', customDowntimeCostPerHour: 3200 }],
    },
  );
  const byId = new Map(costs.map((entry) => [entry.serviceNodeId, entry]));
  assert.equal(byId.get('api')?.source, 'override');
  assert.ok((byId.get('db')?.downtimeCostPerHour || 0) > (byId.get('cache')?.downtimeCostPerHour || 0));

  const fallbackCosts = calculateServiceDowntimeCosts(
    calculateBlastRadius(nodes as any, []),
    [{ nodeId: 'db', name: 'postgres', criticality: 'critical' }],
    { estimatedDowntimeCostPerHour: 10000, serviceOverrides: [] },
  );
  assert.equal(fallbackCosts[0]?.source, 'fallback_criticality');
});


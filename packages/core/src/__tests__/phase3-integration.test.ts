import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import { CrossAccountDetector } from '../cross-account/index.js';
import { createMultiAccountScanResult } from '../cross-account/test-helpers.js';
import { generateDRPlan, generateRunbook } from '../drp/index.js';
import { renderGraphAsHtml } from '../graph/graph-html-renderer.js';
import type { GraphInstance } from '../graph/graph-instance.js';
import { calculateProofOfRecovery } from '../scoring/index.js';
import {
  buildServicePosture,
  detectServices,
  scoreServices,
} from '../services/index.js';
import { EdgeType, NodeType, type ScanEdge } from '../types/infrastructure.js';
import type { GraphAnalysisReport } from '../types/index.js';
import {
  allValidationRules,
  runValidation,
  type InfraNode,
  type ValidationEdge,
} from '../validation/index.js';

type GraphRecord = Record<string, unknown>;
type TestGraph = DirectedGraph<GraphRecord, GraphRecord>;

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../__fixtures__');
const REGION = 'eu-west-3';
const ACCOUNT_ID = '123456789012';
const OTHER_ACCOUNT_ID = '210987654321';

const ECS_SERVICE_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/payments/api`;
const ECS_TASK_A_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:task/payments/task-a`;
const ECS_TASK_B_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:task/payments/task-b`;
const LAMBDA_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:payments-worker`;
const EVENTBRIDGE_RULE_ARN = `arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/payments-events`;
const EVENTBRIDGE_TARGET_ARN =
  `arn:aws:events:${REGION}:${ACCOUNT_ID}:target/payments-events/lambda`;
const SFN_ARN = `arn:aws:states:${REGION}:${ACCOUNT_ID}:stateMachine:payments-flow`;
const AURORA_ARN = `arn:aws:rds:${REGION}:${ACCOUNT_ID}:cluster:payments-db`;
const SQS_ARN = `arn:aws:sqs:${REGION}:${ACCOUNT_ID}:payments-events`;
const S3_ARN = 'arn:aws:s3:::payments-artifacts';
const EVENT_BUS_ARN = `arn:aws:events:${REGION}:${ACCOUNT_ID}:event-bus/shared-payments`;

describe('Phase 3 Pipeline Integration', () => {
  describe('Service Detection', () => {
    it('detects ECS services via CloudFormation tags', () => {
      const result = detectServices([
        createNode(ECS_SERVICE_ARN, 'api', NodeType.CONTAINER, 'ECS_SERVICE', {
          tags: { 'aws:cloudformation:stack-name': 'payments-stack' },
        }),
      ], []);

      expect(result.detectionSummary.cloudformation).toBe(1);
      expect(result.services[0]?.resources.map((resource) => resource.nodeId)).toContain(
        ECS_SERVICE_ARN,
      );
    });

    it('detects ECS services via application tags', () => {
      const result = detectServices([
        createNode(ECS_SERVICE_ARN, 'api', NodeType.CONTAINER, 'ECS_SERVICE', {
          tags: { service: 'payments' },
        }),
      ], []);

      expect(result.detectionSummary.tag).toBe(1);
      expect(result.services[0]?.id).toBe('payments');
    });

    it('includes Lambda functions in service via topology', () => {
      const result = detectServices(
        [
          createNode(SQS_ARN, 'payments-events', NodeType.MESSAGE_QUEUE, 'SQS_QUEUE'),
          createNode(LAMBDA_ARN, 'payments-worker', NodeType.SERVERLESS, 'LAMBDA'),
        ],
        [createEdge(SQS_ARN, LAMBDA_ARN, EdgeType.TRIGGERS)],
      );

      expect(result.detectionSummary.topology).toBe(1);
      expect(result.services[0]?.resources.map((resource) => resource.nodeId)).toEqual([
        SQS_ARN,
        LAMBDA_ARN,
      ]);
    });

    it('includes EventBridge rules in service via topology', () => {
      const result = detectServices(
        [
          createNode(EVENTBRIDGE_RULE_ARN, 'payments-events', NodeType.MESSAGE_QUEUE, 'EVENTBRIDGE_RULE'),
          createNode(LAMBDA_ARN, 'payments-worker', NodeType.SERVERLESS, 'LAMBDA'),
        ],
        [createEdge(EVENTBRIDGE_RULE_ARN, LAMBDA_ARN, EdgeType.TRIGGERS)],
      );

      expect(result.services[0]?.resources.map((resource) => resource.nodeId)).toContain(
        EVENTBRIDGE_RULE_ARN,
      );
    });

    it('includes Step Functions in service via topology', () => {
      const result = detectServices(
        [
          createNode(SFN_ARN, 'payments-flow', NodeType.SERVERLESS, 'SFN_STATE_MACHINE'),
          createNode(LAMBDA_ARN, 'payments-worker', NodeType.SERVERLESS, 'LAMBDA'),
        ],
        [createEdge(SFN_ARN, LAMBDA_ARN, EdgeType.TRIGGERS)],
      );

      expect(result.services[0]?.resources.map((resource) => resource.nodeId)).toContain(SFN_ARN);
    });
  });

  describe('Scoring Integration', () => {
    it('Phase 3 rules contribute findings and severity ceilings to service scoring', () => {
      const nodes = createPhase3Nodes();
      const edges = createPhase3Edges();
      const services = detectServices(nodes, edges).services;
      const validationReport = runValidation(nodes, edges, allValidationRules, undefined, {
        timestamp: '2026-05-27T00:00:00.000Z',
      });
      const serviceScore = scoreServices(services, validationReport, nodes).services.find(
        (service) => service.serviceId === 'payments',
      );
      const ruleIds = new Set(validationReport.results.map((result) => result.ruleId));

      expect(ruleIds.has('ECS_MULTI_AZ_DEPLOYMENT')).toBe(true);
      expect(ruleIds.has('LAMBDA_NO_DLQ')).toBe(true);
      expect(ruleIds.has('EVENTBRIDGE_TARGET_NO_DLQ')).toBe(true);
      expect(ruleIds.has('SFN_TASK_NO_TIMEOUT')).toBe(true);
      expect(ruleIds.has('AURORA_SERVERLESS_V1_AUTOPAUSE')).toBe(true);
      expect(serviceScore?.score).toBeLessThanOrEqual(60);
      expect(serviceScore?.findings.some((finding) => finding.ruleId === 'LAMBDA_NO_DLQ')).toBe(
        true,
      );
    });
  });

  describe('Proof of Recovery', () => {
    it('new service types contribute observed coverage while findings reduce service score', () => {
      const nodes = createPhase3Nodes();
      const edges = createPhase3Edges();
      const validationReport = runValidation(nodes, edges, allValidationRules, undefined, {
        timestamp: '2026-05-27T00:00:00.000Z',
      });
      const posture = buildServicePosture({ nodes, edges, validationReport });
      const proof = calculateProofOfRecovery({ servicePosture: posture, validationReport });
      const payments = posture.services.find((service) => service.service.id === 'payments');

      expect(proof.observedCoverage).toBeGreaterThan(0);
      expect(payments?.score.score).toBeLessThan(100);
      expect(payments?.score.findingsCount.high).toBeGreaterThan(0);
    });
  });

  describe('Cross-Account Detection', () => {
    it('detects Phase 3 service references and EventBridge bus policies', () => {
      const graph = buildGraph(
        [
          createNode(ECS_SERVICE_ARN, 'api', NodeType.CONTAINER, 'ECS_SERVICE', {
            metadata: {
              taskRoleArn: `arn:aws:iam::${OTHER_ACCOUNT_ID}:role/shared-task-role`,
            },
          }),
          createNode(LAMBDA_ARN, 'worker', NodeType.SERVERLESS, 'LAMBDA', {
            metadata: {
              deadLetterTargetArn: `arn:aws:sqs:${REGION}:${OTHER_ACCOUNT_ID}:payments-dlq`,
            },
          }),
          createNode(EVENT_BUS_ARN, 'shared-payments', NodeType.MESSAGE_QUEUE, 'EVENTBRIDGE_BUS', {
            metadata: {
              policy: JSON.stringify({
                Version: '2012-10-17',
                Statement: {
                  Effect: 'Allow',
                  Action: 'events:PutEvents',
                  Principal: { AWS: `arn:aws:iam::${OTHER_ACCOUNT_ID}:root` },
                },
              }),
            },
          }),
        ],
        [],
      );

      const result = new CrossAccountDetector({
        enabledKinds: ['service_reference', 'eventbridge_bus_policy'],
      }).detect(graph, createMultiAccountScanResult(graph, [ACCOUNT_ID, OTHER_ACCOUNT_ID]));

      expect(result.summary.byKind.get('service_reference')).toBe(2);
      expect(result.summary.byKind.get('eventbridge_bus_policy')).toBe(1);
    });
  });

  describe('Recovery Chain', () => {
    it('ECS, Lambda, Aurora, and S3 components receive recovery steps', () => {
      const nodes = [
        createNode(AURORA_ARN, 'payments-db', NodeType.DATABASE, 'AURORA_CLUSTER', {
          criticalityScore: 90,
          tags: { Service: 'payments' },
          metadata: { backupRetentionPeriod: 7, replicaCount: 1 },
        }),
        createNode(ECS_SERVICE_ARN, 'payments-api', NodeType.CONTAINER, 'ECS_SERVICE', {
          criticalityScore: 80,
          tags: { Service: 'payments' },
        }),
        createNode(LAMBDA_ARN, 'payments-worker', NodeType.SERVERLESS, 'LAMBDA', {
          criticalityScore: 70,
          tags: { Service: 'payments' },
          metadata: {
            functionName: 'payments-worker',
            eventSourceMappings: [{ eventSourceArn: SQS_ARN, state: 'Enabled' }],
          },
        }),
        createNode(S3_ARN, 'payments-artifacts', NodeType.OBJECT_STORAGE, 'S3_BUCKET', {
          criticalityScore: 40,
          tags: { Service: 'payments' },
          metadata: { versioningStatus: 'Enabled' },
        }),
      ];
      const graph = buildGraph(nodes, [
        createEdge(ECS_SERVICE_ARN, AURORA_ARN, EdgeType.DEPENDS_ON),
        createEdge(LAMBDA_ARN, SQS_ARN, EdgeType.TRIGGERS),
      ]);
      const plan = generateDRPlan({
        graph,
        analysis: createAnalysis(graph),
        provider: 'aws',
        generatedAt: new Date('2026-05-27T00:00:00.000Z'),
      });
      const runbook = generateRunbook(plan, nodes);
      const service = plan.services.find((entry) => entry.name === 'payments');
      const lambdaRunbook = runbook.componentRunbooks.find(
        (component) => component.componentId === LAMBDA_ARN,
      );

      expect(service?.components.find((component) => component.resourceId === ECS_SERVICE_ARN)?.recoverySteps.length).toBeGreaterThan(0);
      expect(service?.components.find((component) => component.resourceId === LAMBDA_ARN)?.recoverySteps.length).toBeGreaterThan(0);
      expect(lambdaRunbook?.steps.some((step) => step.title === 'Reconnect event source mappings')).toBe(
        true,
      );
      expect(service?.recoveryOrder.indexOf(AURORA_ARN)).toBeLessThan(
        service?.recoveryOrder.indexOf(ECS_SERVICE_ARN) ?? Number.POSITIVE_INFINITY,
      );
    });
  });

  describe('Graph HTML', () => {
    it('renders new resource types and cross-account edges without error', () => {
      const nodes = createPhase3Nodes();
      const graph = buildGraph(nodes, createPhase3Edges());
      const html = renderGraphAsHtml({
        graph,
        crossAccountEdges: [
          {
            sourceArn: `arn:aws:iam::${OTHER_ACCOUNT_ID}:root`,
            sourceAccountId: OTHER_ACCOUNT_ID,
            targetArn: EVENT_BUS_ARN,
            targetAccountId: ACCOUNT_ID,
            kind: 'eventbridge_bus_policy',
            direction: 'unidirectional',
            drImpact: 'critical',
            completeness: 'partial',
            missingAccountId: OTHER_ACCOUNT_ID,
            metadata: {
              kind: 'eventbridge_bus_policy',
              eventBusArn: EVENT_BUS_ARN,
              trustedPrincipal: `arn:aws:iam::${OTHER_ACCOUNT_ID}:root`,
              actions: ['events:PutEvents'],
              statementId: '0',
              conditionKeys: [],
            },
          },
        ],
        title: 'Phase 3 Graph',
      });

      expect(html).toContain(ECS_SERVICE_ARN);
      expect(html).toContain(LAMBDA_ARN);
      expect(html).toContain(EVENTBRIDGE_RULE_ARN);
      expect(html).toContain(SFN_ARN);
      expect(html).toContain('cross-account');
      expect(html).toContain(EVENT_BUS_ARN);
    });
  });

  describe('Non-regression', () => {
    it('demo minimal fixture has no Phase 3 findings when Phase 3 resources are absent', () => {
      const fixture = loadFixture('demo-minimal.json');
      const report = runValidation(fixture.nodes, fixture.edges, allValidationRules, undefined, {
        timestamp: '2026-05-27T00:00:00.000Z',
      });
      const phase3Failures = report.results.filter(
        (result) =>
          ['fail', 'warn', 'error'].includes(result.status) &&
          /^(ECS_|EVENTBRIDGE_|SFN_|AURORA_SERVERLESS_V1_|LAMBDA_NO_DLQ)/.test(result.ruleId),
      );

      expect(phase3Failures).toEqual([]);
    });
  });
});

function createPhase3Nodes(): readonly InfraNode[] {
  return [
    createNode(ECS_SERVICE_ARN, 'payments-api', NodeType.CONTAINER, 'ECS_SERVICE', {
      tags: { service: 'payments' },
      metadata: {
        serviceArn: ECS_SERVICE_ARN,
        serviceName: 'api',
        desiredCount: 2,
        runningCount: 2,
        deploymentConfiguration: {
          deploymentCircuitBreaker: { enable: true, rollback: true },
        },
        capacityProviderStrategy: [{ capacityProvider: 'FARGATE', weight: 1 }],
      },
    }),
    createNode(ECS_TASK_A_ARN, 'task-a', NodeType.CONTAINER, 'ECS_TASK', {
      tags: { service: 'payments' },
      availabilityZone: 'eu-west-3a',
      metadata: {
        serviceArn: ECS_SERVICE_ARN,
        serviceName: 'api',
        availabilityZone: 'eu-west-3a',
      },
    }),
    createNode(ECS_TASK_B_ARN, 'task-b', NodeType.CONTAINER, 'ECS_TASK', {
      tags: { service: 'payments' },
      availabilityZone: 'eu-west-3a',
      metadata: {
        serviceArn: ECS_SERVICE_ARN,
        serviceName: 'api',
        availabilityZone: 'eu-west-3a',
      },
    }),
    createNode(LAMBDA_ARN, 'payments-worker', NodeType.SERVERLESS, 'LAMBDA', {
      tags: { service: 'payments' },
      metadata: {
        functionName: 'payments-worker',
        timeout: 30,
        eventSourceMappings: [
          {
            uuid: 'esm-payments',
            eventSourceArn: SQS_ARN,
            state: 'Enabled',
            batchSize: 10,
            functionResponseTypes: [],
          },
        ],
      },
    }),
    createNode(EVENTBRIDGE_RULE_ARN, 'payments-events', NodeType.MESSAGE_QUEUE, 'EVENTBRIDGE_RULE', {
      tags: { service: 'payments' },
      metadata: {
        ruleArn: EVENTBRIDGE_RULE_ARN,
        ruleName: 'payments-events',
        state: 'ENABLED',
      },
    }),
    createNode(EVENTBRIDGE_TARGET_ARN, 'payments-events:lambda', NodeType.MESSAGE_QUEUE, 'EVENTBRIDGE_TARGET', {
      tags: { service: 'payments' },
      metadata: {
        targetId: 'lambda',
        id: 'lambda',
        ruleArn: EVENTBRIDGE_RULE_ARN,
        ruleName: 'payments-events',
        targetArn: LAMBDA_ARN,
        deadLetterConfig: null,
        retryPolicy: null,
      },
    }),
    createNode(SFN_ARN, 'payments-flow', NodeType.SERVERLESS, 'SFN_STATE_MACHINE', {
      tags: { service: 'payments' },
      metadata: {
        stateMachineName: 'payments-flow',
        type: 'STANDARD',
        loggingConfiguration: null,
        parsedDefinition: {
          totalStates: 1,
          waitStates: 0,
          parallelStates: 0,
          hasTimeout: false,
          taskStates: [
            {
              name: 'InvokeWorker',
              resource: LAMBDA_ARN,
              service: 'Lambda',
              timeoutSeconds: null,
              heartbeatSeconds: null,
              retry: null,
              catch: null,
              next: null,
              end: true,
              isTerminal: true,
            },
          ],
        },
      },
    }),
    createNode(AURORA_ARN, 'payments-db', NodeType.DATABASE, 'AURORA_CLUSTER', {
      tags: { service: 'payments' },
      metadata: {
        dbClusterIdentifier: 'payments-db',
        availabilityZones: ['eu-west-3a', 'eu-west-3b'],
        backupRetentionPeriod: 7,
        deletionProtection: true,
        replicaCount: 1,
        serverlessVersion: 'v1',
        engineMode: 'serverless',
        scalingConfigurationV1: {
          minCapacity: 2,
          maxCapacity: 4,
          autoPause: true,
          secondsUntilAutoPause: 300,
        },
      },
    }),
    createNode(SQS_ARN, 'payments-events', NodeType.MESSAGE_QUEUE, 'SQS_QUEUE', {
      tags: { service: 'payments' },
      metadata: { queueName: 'payments-events' },
    }),
  ];
}

function createPhase3Edges(): readonly ValidationEdge[] {
  return [
    createEdge(ECS_TASK_A_ARN, ECS_SERVICE_ARN, EdgeType.DEPENDS_ON),
    createEdge(ECS_TASK_B_ARN, ECS_SERVICE_ARN, EdgeType.DEPENDS_ON),
    createEdge(SQS_ARN, LAMBDA_ARN, EdgeType.TRIGGERS),
    createEdge(EVENTBRIDGE_RULE_ARN, EVENTBRIDGE_TARGET_ARN, EdgeType.TRIGGERS),
    createEdge(EVENTBRIDGE_TARGET_ARN, LAMBDA_ARN, EdgeType.TRIGGERS),
    createEdge(SFN_ARN, LAMBDA_ARN, EdgeType.TRIGGERS),
    createEdge(ECS_SERVICE_ARN, AURORA_ARN, EdgeType.DEPENDS_ON),
  ];
}

function createNode(
  id: string,
  name: string,
  type: string,
  sourceType: string,
  options: {
    readonly accountId?: string;
    readonly tags?: Record<string, string>;
    readonly metadata?: Record<string, unknown>;
    readonly availabilityZone?: string | null;
    readonly criticalityScore?: number;
  } = {},
): InfraNode {
  const accountId = options.accountId ?? ACCOUNT_ID;
  return {
    id,
    accountId,
    partition: 'aws',
    name,
    type,
    provider: 'aws',
    region: REGION,
    availabilityZone: options.availabilityZone ?? null,
    tags: options.tags ?? {},
    ...(typeof options.criticalityScore === 'number'
      ? { criticalityScore: options.criticalityScore }
      : {}),
    metadata: {
      ...(options.metadata ?? {}),
      sourceType,
      accountId,
      region: REGION,
    },
  };
}

function createEdge(source: string, target: string, type: string): ValidationEdge {
  return { source, target, type };
}

function buildGraph(nodes: readonly InfraNode[], edges: readonly ValidationEdge[]): GraphInstance {
  const graph: TestGraph = new DirectedGraph<GraphRecord, GraphRecord>();
  for (const node of nodes) {
    graph.addNode(node.id, node as unknown as GraphRecord);
  }
  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    graph.addEdgeWithKey(`${edge.source}->${edge.target}:${edge.type}`, edge.source, edge.target, {
      type: edge.type,
      confidence: 1,
      confirmed: true,
    });
  }
  return graph as unknown as GraphInstance;
}

function createAnalysis(graph: GraphInstance): GraphAnalysisReport {
  return {
    timestamp: new Date('2026-05-27T00:00:00.000Z'),
    totalNodes: graph.order,
    totalEdges: graph.size,
    spofs: [],
    criticalityScores: new Map(),
    redundancyIssues: [],
    regionalRisks: [],
    circularDeps: [],
    cascadeChains: [],
    resilienceScore: 75,
  };
}

function loadFixture(fileName: string): {
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ScanEdge>;
} {
  const fixturePath = path.join(FIXTURE_DIR, fileName);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    readonly nodes: readonly InfraNode[];
    readonly edges: ReadonlyArray<ScanEdge>;
  };
}

import {
  EdgeType,
  NodeType,
  type InfraNode,
  type InfraNodeAttrs,
  type ScanEdge,
} from '@stronghold-dr/core';

import { runScanPipeline } from '../../services/scan-pipeline.js';

export interface DemoScenario {
  readonly provider: 'aws';
  readonly regions: readonly ['eu-west-1'];
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ScanEdge>;
}

const FIXED_TIMESTAMP = new Date('2026-03-27T15:00:00.000Z');

export function createTestUuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`;
}

export function createDemoScenario(): DemoScenario {
  const database = createNode({
    id: 'orders-db',
    name: 'orders-db',
    type: NodeType.DATABASE,
    tags: { Service: 'orders' },
    metadata: {
      sourceType: 'RDS',
      dbIdentifier: 'orders-db',
      multiAZ: false,
      backupRetentionPeriod: 0,
      backupRetentionDays: 0,
      readReplicaDBInstanceIdentifiers: [],
    },
  });
  const application = createNode({
    id: 'orders-api',
    name: 'orders-api',
    type: NodeType.APPLICATION,
    tags: { Service: 'orders' },
    metadata: { sourceType: 'orders_service' },
  });
  const bucket = createNode({
    id: 'arn:aws:s3:::orders-backups',
    name: 'orders-backups',
    type: NodeType.OBJECT_STORAGE,
    tags: { Service: 'orders' },
    metadata: {
      sourceType: 'S3_BUCKET',
      bucketName: 'orders-backups',
      versioningStatus: 'Suspended',
      replicationRules: [],
    },
  });

  return {
    provider: 'aws',
    regions: ['eu-west-1'],
    nodes: [database, application, bucket],
    edges: [
      createEdge('orders-api', 'orders-db', EdgeType.DEPENDS_ON),
      createEdge('orders-api', 'arn:aws:s3:::orders-backups', EdgeType.DEPENDS_ON),
    ],
  };
}

export function createDriftedScenario(): DemoScenario {
  const base = createDemoScenario();
  const database = base.nodes.find((node) => node.id === 'orders-db');
  const application = base.nodes.find((node) => node.id === 'orders-api');
  if (!database || !application) {
    throw new Error('Demo scenario is missing required nodes.');
  }

  return {
    provider: 'aws',
    regions: base.regions,
    nodes: [
      {
        ...database,
        metadata: {
          ...database.metadata,
          multiAZ: true,
          backupRetentionPeriod: 7,
          backupRetentionDays: 7,
        },
      },
      application,
    ],
    edges: [createEdge('orders-api', 'orders-db', EdgeType.DEPENDS_ON)],
  };
}

export async function buildDemoArtifacts(scenario: DemoScenario = createDemoScenario()) {
  return runScanPipeline({
    provider: scenario.provider,
    regions: scenario.regions,
    nodes: scenario.nodes,
    edges: scenario.edges,
    timestamp: FIXED_TIMESTAMP,
  });
}

function createNode(
  overrides: Partial<InfraNodeAttrs> & Pick<InfraNodeAttrs, 'id' | 'name' | 'type'>,
): InfraNode {
  return {
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: null,
    tags: {},
    metadata: {},
    ...overrides,
  };
}

function createEdge(source: string, target: string, type: EdgeType): ScanEdge {
  return { source, target, type };
}

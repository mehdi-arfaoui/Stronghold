import { RDSClient } from '@aws-sdk/client-rds';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthProvider } from '../../../../auth/index.js';
import { createAccountContext } from '../../../../identity/index.js';
import { createScanContext } from '../../../../model/scan-context.js';
import { scanAuroraClusters } from '../aurora-scanner.js';

const REGION = 'eu-west-3';
const ACCOUNT_ID = '123456789012';
const CLUSTER_ARN = `arn:aws:rds:${REGION}:${ACCOUNT_ID}:cluster:payments`;
const INSTANCE_ARN = `arn:aws:rds:${REGION}:${ACCOUNT_ID}:db:payments-1`;

interface MockAuroraScenario {
  readonly clusters: readonly Record<string, unknown>[];
  readonly instances: readonly Record<string, unknown>[];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function commandName(command: unknown): string {
  if (!command || typeof command !== 'object') return '';
  return (command as { readonly constructor?: { readonly name?: string } }).constructor?.name ?? '';
}

function createAuthProvider(): AuthProvider {
  return {
    kind: 'profile',
    getCredentials: async () => ({
      accessKeyId: 'test',
      secretAccessKey: 'test',
    }),
    canHandle: async () => true,
    describeAuthMethod: () => 'test',
  };
}

function createTestScanContext() {
  return createScanContext({
    account: createAccountContext({ accountId: ACCOUNT_ID }),
    region: REGION,
    authProvider: createAuthProvider(),
  });
}

function createCluster(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DBClusterIdentifier: 'payments',
    DBClusterArn: CLUSTER_ARN,
    Engine: 'aurora-postgresql',
    EngineVersion: '15.4',
    EngineMode: 'provisioned',
    Endpoint: 'payments.cluster.local',
    ReaderEndpoint: 'payments-ro.cluster.local',
    AvailabilityZones: ['eu-west-3a', 'eu-west-3b'],
    BackupRetentionPeriod: 7,
    DBClusterMembers: [
      {
        DBInstanceIdentifier: 'payments-1',
        IsClusterWriter: true,
      },
    ],
    ...overrides,
  };
}

function createInstance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DBInstanceIdentifier: 'payments-1',
    DBInstanceArn: INSTANCE_ARN,
    Engine: 'aurora-postgresql',
    DBInstanceClass: 'db.r6g.large',
    DBInstanceStatus: 'available',
    AvailabilityZone: 'eu-west-3a',
    ...overrides,
  };
}

function installRdsMock(scenario: MockAuroraScenario) {
  const implementation = ((command: unknown) => {
    const name = commandName(command);
    void readRecord((command as { readonly input?: unknown }).input);

    if (name === 'DescribeDBClustersCommand') {
      return Promise.resolve({ DBClusters: scenario.clusters });
    }

    if (name === 'DescribeDBInstancesCommand') {
      return Promise.resolve({ DBInstances: scenario.instances });
    }

    if (name === 'DescribeGlobalClustersCommand') {
      return Promise.resolve({ GlobalClusters: [] });
    }

    if (name === 'ListTagsForResourceCommand') {
      return Promise.resolve({ TagList: [] });
    }

    return Promise.reject(new Error(`Unexpected RDS command ${name}`));
  }) as unknown as RDSClient['send'];

  return vi.spyOn(RDSClient.prototype, 'send').mockImplementation(implementation);
}

async function scanScenario(scenario: MockAuroraScenario) {
  installRdsMock(scenario);
  return scanAuroraClusters({
    region: REGION,
    maxAttempts: 1,
    scanContext: createTestScanContext(),
  });
}

function clusterMetadata(
  result: Awaited<ReturnType<typeof scanAuroraClusters>>,
): Record<string, unknown> {
  const cluster = result.resources.find((resource) => resource.type === 'AURORA_CLUSTER');
  expect(cluster).toBeDefined();
  return cluster?.metadata ?? {};
}

function readMetadataObject(value: unknown): Record<string, unknown> {
  return readRecord(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Aurora Scanner (v1 enrichment)', () => {
  it('detects Aurora Serverless v1 via EngineMode', async () => {
    const result = await scanScenario({
      clusters: [
        createCluster({
          EngineMode: 'serverless',
          ScalingConfigurationInfo: {
            MinCapacity: 2,
            MaxCapacity: 32,
            AutoPause: true,
            SecondsUntilAutoPause: 600,
          },
        }),
      ],
      instances: [],
    });

    const metadata = clusterMetadata(result);
    expect(metadata.engineMode).toBe('serverless');
    expect(metadata.serverlessVersion).toBe('v1');
    expect(metadata.scalingConfigurationV1).toEqual({
      minCapacity: 2,
      maxCapacity: 32,
      autoPause: true,
      secondsUntilAutoPause: 600,
    });
  });

  it('detects Aurora Serverless v2 via ServerlessV2ScalingConfiguration', async () => {
    const result = await scanScenario({
      clusters: [
        createCluster({
          ServerlessV2ScalingConfiguration: {
            MinCapacity: 0.5,
            MaxCapacity: 16,
          },
        }),
      ],
      instances: [],
    });

    const metadata = clusterMetadata(result);
    expect(metadata.serverlessVersion).toBe('v2');
    expect(metadata.scalingConfigurationV1).toBeNull();
  });

  it('detects Aurora Serverless v2 via db.serverless instance class', async () => {
    const result = await scanScenario({
      clusters: [createCluster()],
      instances: [createInstance({ DBInstanceClass: 'db.serverless' })],
    });

    expect(clusterMetadata(result).serverlessVersion).toBe('v2');
  });

  it('detects standard Aurora as not serverless', async () => {
    const result = await scanScenario({
      clusters: [createCluster()],
      instances: [createInstance()],
    });

    const metadata = clusterMetadata(result);
    expect(metadata.engineMode).toBe('provisioned');
    expect(metadata.serverlessVersion).toBeNull();
    expect(metadata.scalingConfigurationV1).toBeNull();
  });

  it('reads Data API enabled flag', async () => {
    const result = await scanScenario({
      clusters: [createCluster({ HttpEndpointEnabled: true })],
      instances: [createInstance()],
    });

    expect(clusterMetadata(result).httpEndpointEnabled).toBe(true);
  });

  it('reads v1 scaling configuration', async () => {
    const result = await scanScenario({
      clusters: [
        createCluster({
          EngineMode: 'serverless',
          ScalingConfigurationInfo: {
            MinCapacity: 1,
            MaxCapacity: 8,
            AutoPause: false,
            SecondsUntilAutoPause: 300,
          },
        }),
      ],
      instances: [],
    });

    const scaling = readMetadataObject(clusterMetadata(result).scalingConfigurationV1);
    expect(scaling.minCapacity).toBe(1);
    expect(scaling.maxCapacity).toBe(8);
    expect(scaling.autoPause).toBe(false);
    expect(scaling.secondsUntilAutoPause).toBe(300);
  });
});

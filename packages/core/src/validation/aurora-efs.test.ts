import { describe, expect, it } from 'vitest';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import { allValidationRules } from './validation-rules.js';
import { runValidation } from './validation-engine.js';
import type { ValidationEdge, ValidationResult } from './validation-types.js';

function createNode(
  overrides: Partial<InfraNodeAttrs> & {
    readonly id: string;
    readonly type: string;
    readonly metadata: Record<string, unknown>;
  },
): InfraNodeAttrs {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    type: overrides.type,
    provider: 'aws',
    region: overrides.region ?? 'eu-west-1',
    availabilityZone: overrides.availabilityZone ?? null,
    tags: {},
    metadata: overrides.metadata,
    ...overrides,
  };
}

function createEdge(source: string, target: string, type: string): ValidationEdge {
  return { source, target, type };
}

function findRule(ruleId: string) {
  const rule = allValidationRules.find((candidate) => candidate.id === ruleId);
  if (!rule) throw new Error(`Validation rule ${ruleId} was not found.`);
  return rule;
}

function executeRule(
  ruleId: string,
  targetNodeId: string,
  nodes: readonly InfraNodeAttrs[],
  edges: ReadonlyArray<ValidationEdge> = [],
): ValidationResult {
  const report = runValidation(nodes, edges, [findRule(ruleId)]);
  const result = report.results.find((entry) => entry.ruleId === ruleId && entry.nodeId === targetNodeId);
  if (!result) throw new Error(`Validation result for ${ruleId}/${targetNodeId} was not produced.`);
  return result;
}

function createAuroraClusterNode(
  id = 'aurora-cluster-1',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    type: 'DATABASE',
    metadata: {
      sourceType: 'AURORA_CLUSTER',
      dbClusterIdentifier: id,
      availabilityZones: ['eu-west-1a', 'eu-west-1b'],
      backupRetentionPeriod: 7,
      deletionProtection: true,
      globalClusterIdentifier: 'global-cluster-1',
      replicaCount: 1,
      ...metadata,
    },
  });
}

function createAuroraInstanceNode(
  id: string,
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    type: 'DATABASE',
    availabilityZone:
      typeof metadata.availabilityZone === 'string' ? metadata.availabilityZone : 'eu-west-1a',
    metadata: {
      sourceType: 'AURORA_INSTANCE',
      dbInstanceIdentifier: id,
      availabilityZone: 'eu-west-1a',
      isClusterWriter: false,
      promotionTier: 0,
      ...metadata,
    },
  });
}

function createEfsFilesystemNode(
  id = 'fs-12345678',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    type: 'FILE_STORAGE',
    metadata: {
      sourceType: 'EFS_FILESYSTEM',
      fileSystemId: id,
      automaticBackups: true,
      backupPolicy: { status: 'ENABLED' },
      replicationConfigurations: [
        {
          destinationFileSystemId: 'fs-dr',
          destinationRegion: 'us-east-1',
          status: 'ENABLED',
        },
      ],
      availabilityZoneName: null,
      ...metadata,
    },
  });
}

function createEfsMountTargetNode(
  id: string,
  availabilityZone: string,
): InfraNodeAttrs {
  return createNode({
    id,
    type: 'FILE_STORAGE',
    availabilityZone,
    metadata: {
      sourceType: 'EFS_MOUNT_TARGET',
      mountTargetId: id,
      fileSystemId: 'fs-12345678',
      availabilityZone,
      availabilityZoneName: availabilityZone,
      subnetId: `subnet-${availabilityZone}`,
    },
  });
}

describe('Aurora and EFS validation rules', () => {
  it('aurora_multi_az passes when the cluster spans multiple availability zones', () => {
    expect(executeRule('aurora_multi_az', 'aurora-cluster-1', [createAuroraClusterNode()]).status).toBe('pass');
  });

  it('aurora_multi_az fails when the cluster only spans one availability zone', () => {
    expect(
      executeRule(
        'aurora_multi_az',
        'aurora-cluster-1',
        [createAuroraClusterNode('aurora-cluster-1', { availabilityZones: ['eu-west-1a'] })],
      ).status,
    ).toBe('fail');
  });

  it('aurora_replica_exists passes when a reader instance exists', () => {
    const nodes = [
      createAuroraClusterNode(),
      createAuroraInstanceNode('aurora-writer', { isClusterWriter: true }),
      createAuroraInstanceNode('aurora-reader', { isClusterWriter: false, promotionTier: 0 }),
    ];
    const edges = [
      createEdge('aurora-cluster-1', 'aurora-writer', 'CONTAINS'),
      createEdge('aurora-cluster-1', 'aurora-reader', 'CONTAINS'),
    ];
    expect(executeRule('aurora_replica_exists', 'aurora-cluster-1', nodes, edges).status).toBe('pass');
  });

  it('aurora_replica_exists fails when only the writer exists', () => {
    const nodes = [
      createAuroraClusterNode('aurora-cluster-1', { replicaCount: 0 }),
      createAuroraInstanceNode('aurora-writer', { isClusterWriter: true }),
    ];
    const edges = [createEdge('aurora-cluster-1', 'aurora-writer', 'CONTAINS')];
    expect(executeRule('aurora_replica_exists', 'aurora-cluster-1', nodes, edges).status).toBe('fail');
  });

  it('aurora_backup_configured passes when retention is greater than zero', () => {
    expect(
      executeRule('aurora_backup_configured', 'aurora-cluster-1', [createAuroraClusterNode()]).status,
    ).toBe('pass');
  });

  it('aurora_backup_configured fails when retention is zero', () => {
    expect(
      executeRule(
        'aurora_backup_configured',
        'aurora-cluster-1',
        [createAuroraClusterNode('aurora-cluster-1', { backupRetentionPeriod: 0 })],
      ).status,
    ).toBe('fail');
  });

  it('aurora_backup_retention_adequate passes when retention is at least seven days', () => {
    expect(
      executeRule(
        'aurora_backup_retention_adequate',
        'aurora-cluster-1',
        [createAuroraClusterNode()],
      ).status,
    ).toBe('pass');
  });

  it('aurora_backup_retention_adequate warns when retention is shorter than seven days', () => {
    expect(
      executeRule(
        'aurora_backup_retention_adequate',
        'aurora-cluster-1',
        [createAuroraClusterNode('aurora-cluster-1', { backupRetentionPeriod: 3 })],
      ).status,
    ).toBe('warn');
  });

  it('aurora_deletion_protection passes when protection is enabled', () => {
    expect(
      executeRule('aurora_deletion_protection', 'aurora-cluster-1', [createAuroraClusterNode()]).status,
    ).toBe('pass');
  });

  it('aurora_deletion_protection fails when protection is disabled', () => {
    expect(
      executeRule(
        'aurora_deletion_protection',
        'aurora-cluster-1',
        [createAuroraClusterNode('aurora-cluster-1', { deletionProtection: false })],
      ).status,
    ).toBe('fail');
  });

  it('aurora_global_database passes when the cluster belongs to a global database', () => {
    expect(
      executeRule('aurora_global_database', 'aurora-cluster-1', [createAuroraClusterNode()]).status,
    ).toBe('pass');
  });

  it('aurora_global_database skips when the cluster is not part of a global database', () => {
    expect(
      executeRule(
        'aurora_global_database',
        'aurora-cluster-1',
        [createAuroraClusterNode('aurora-cluster-1', { globalClusterIdentifier: null })],
      ).status,
    ).toBe('skip');
  });

  it('aurora_promotion_tier passes when a replica has tier zero or one', () => {
    const nodes = [
      createAuroraClusterNode(),
      createAuroraInstanceNode('aurora-reader', { promotionTier: 0 }),
    ];
    const edges = [createEdge('aurora-cluster-1', 'aurora-reader', 'CONTAINS')];
    expect(executeRule('aurora_promotion_tier', 'aurora-cluster-1', nodes, edges).status).toBe('pass');
  });

  it('aurora_promotion_tier warns when all replicas have a low failover priority', () => {
    const nodes = [
      createAuroraClusterNode(),
      createAuroraInstanceNode('aurora-reader', { promotionTier: 10 }),
    ];
    const edges = [createEdge('aurora-cluster-1', 'aurora-reader', 'CONTAINS')];
    expect(executeRule('aurora_promotion_tier', 'aurora-cluster-1', nodes, edges).status).toBe('warn');
  });

  it('efs_backup_enabled passes when automatic backups are enabled', () => {
    expect(executeRule('efs_backup_enabled', 'fs-12345678', [createEfsFilesystemNode()]).status).toBe('pass');
  });

  it('efs_backup_enabled fails when automatic backups are disabled', () => {
    expect(
      executeRule(
        'efs_backup_enabled',
        'fs-12345678',
        [
          createEfsFilesystemNode('fs-12345678', {
            automaticBackups: false,
            backupPolicy: { status: 'DISABLED' },
          }),
        ],
      ).status,
    ).toBe('fail');
  });

  it('efs_replication_configured passes when replication is enabled', () => {
    expect(
      executeRule('efs_replication_configured', 'fs-12345678', [createEfsFilesystemNode()]).status,
    ).toBe('pass');
  });

  it('efs_replication_configured fails when no replication is configured', () => {
    expect(
      executeRule(
        'efs_replication_configured',
        'fs-12345678',
        [createEfsFilesystemNode('fs-12345678', { replicationConfigurations: [] })],
      ).status,
    ).toBe('fail');
  });

  it('efs_multi_az passes when the filesystem is regional', () => {
    expect(executeRule('efs_multi_az', 'fs-12345678', [createEfsFilesystemNode()]).status).toBe('pass');
  });

  it('efs_multi_az fails when the filesystem is One Zone', () => {
    expect(
      executeRule(
        'efs_multi_az',
        'fs-12345678',
        [createEfsFilesystemNode('fs-12345678', { availabilityZoneName: 'eu-west-1a' })],
      ).status,
    ).toBe('fail');
  });

  it('efs_mount_target_multi_az passes when mount targets span multiple availability zones', () => {
    const nodes = [
      createEfsFilesystemNode(),
      createEfsMountTargetNode('mt-a', 'eu-west-1a'),
      createEfsMountTargetNode('mt-b', 'eu-west-1b'),
      createEfsMountTargetNode('mt-c', 'eu-west-1c'),
    ];
    const edges = [
      createEdge('fs-12345678', 'mt-a', 'CONTAINS'),
      createEdge('fs-12345678', 'mt-b', 'CONTAINS'),
      createEdge('fs-12345678', 'mt-c', 'CONTAINS'),
    ];
    expect(executeRule('efs_mount_target_multi_az', 'fs-12345678', nodes, edges).status).toBe('pass');
  });

  it('efs_mount_target_multi_az fails when mount targets exist in only one availability zone', () => {
    const nodes = [
      createEfsFilesystemNode(),
      createEfsMountTargetNode('mt-a', 'eu-west-1a'),
    ];
    const edges = [createEdge('fs-12345678', 'mt-a', 'CONTAINS')];
    expect(executeRule('efs_mount_target_multi_az', 'fs-12345678', nodes, edges).status).toBe('fail');
  });
});

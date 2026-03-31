import { hasElasticScaling } from '../graph/spof-detection.js';
import {
  getMetadata,
  getReplicaCount,
  isMultiAzEnabled,
  readBoolean,
  readNumber,
  readString,
} from '../graph/analysis-helpers.js';
import { NodeType } from '../types/index.js';
import type {
  InfrastructureNode,
  RecoveryAction,
  RecoveryStrategy,
  RecoveryValidation,
} from './drp-types.js';

/** Determines the recovery strategy for a node from real infrastructure metadata. */
export function determineRecoveryStrategy(node: InfrastructureNode): RecoveryStrategy {
  const metadata = getMetadata(node);
  const sourceType = readSourceType(node);

  if (isDnsLike(node, sourceType)) return hasDnsFailover(metadata) ? 'dns_failover' : 'manual';
  if (isLambdaLike(node, sourceType)) return 'auto_scaling';
  if (isAutoScalingLike(sourceType)) return 'auto_scaling';
  if (isEc2Like(node, sourceType)) return hasElasticScaling(node) ? 'auto_scaling' : 'rebuild';
  if (isAuroraClusterLike(sourceType)) {
    if (hasAuroraGlobalDatabase(metadata)) return 'aurora_global_failover';
    if (hasAuroraReplica(metadata)) return 'aurora_failover';
    return hasBackup(node) ? 'restore_from_backup' : 'rebuild';
  }
  if (isRdsLike(node, sourceType)) {
    if (isMultiAzEnabled(metadata)) return 'failover';
    if (
      (Array.isArray(metadata.readReplicaDBInstanceIdentifiers) &&
        metadata.readReplicaDBInstanceIdentifiers.length > 0) ||
      getReplicaCount(metadata) > 0
    ) {
      return 'failover';
    }
    return hasBackup(node) ? 'restore_from_backup' : 'rebuild';
  }
  if (isDynamoLike(node, sourceType)) {
    if (hasGlobalReplication(metadata)) return 'failover';
    return hasPointInTimeRecovery(metadata) ? 'restore_from_backup' : 'rebuild';
  }
  if (isS3Like(node, sourceType)) {
    if (hasCrossRegionReplication(metadata)) return 'failover';
    return hasVersioning(metadata) ? 'restore_from_backup' : 'manual';
  }
  if (isEfsLike(node, sourceType)) {
    if (hasEfsReplication(metadata)) return 'manual';
    return hasBackup(node) ? 'restore_from_backup' : 'none';
  }
  if (isElastiCacheLike(node, sourceType)) {
    if (hasCacheFailover(metadata)) return 'failover';
    return hasBackup(node) ? 'restore_from_backup' : 'rebuild';
  }
  if (isEksNodegroupLike(sourceType)) {
    return hasNodegroupScaling(metadata) ? 'auto_scaling' : 'rebuild';
  }
  if (isEksClusterLike(sourceType)) return 'rebuild';
  if (isLoadBalancerLike(node, sourceType)) return 'rebuild';
  if (isMessagingLike(node, sourceType)) return 'manual';
  if (isNetworkLike(node)) return 'rebuild';
  if (node.type === NodeType.SERVERLESS) return 'auto_scaling';
  return 'none';
}

/** Backward-compatible alias for recovery strategy inference. */
export function inferRecoveryStrategy(node: InfrastructureNode): RecoveryStrategy {
  return determineRecoveryStrategy(node);
}

/** Generates recovery actions for a node and its chosen strategy. */
export function generateRecoverySteps(
  node: InfrastructureNode,
  strategy: RecoveryStrategy,
): readonly RecoveryAction[] {
  const target = resolveTarget(node);
  const validation = createValidation(node);

  switch (strategy) {
    case 'aurora_failover':
      return [
        createAction(
          'verify_status',
          target,
          `Confirm Aurora replicas are healthy for ${node.name}.`,
          '30s',
          validation,
        ),
        createAction(
          'promote_replica',
          target,
          `Initiate Aurora cluster failover for ${node.name}.`,
          '60s',
        ),
        createAction(
          'verify_connectivity',
          target,
          `Verify writer endpoint connectivity for ${node.name}.`,
          '2m',
          validation,
        ),
        createAction(
          'verify_data_integrity',
          target,
          `Confirm ${node.name} resumed with no data loss after failover.`,
          '5m',
        ),
      ];
    case 'aurora_global_failover':
      return [
        createAction(
          'verify_status',
          target,
          `Verify global secondary cluster readiness for ${node.name}.`,
          '30s',
          validation,
        ),
        createAction(
          'promote_replica',
          target,
          `Promote the Aurora global secondary for ${node.name}.`,
          '2m',
        ),
        createAction(
          'update_dns',
          target,
          `Update application endpoints for ${node.name} after global failover.`,
          '2m',
        ),
        createAction(
          'verify_connectivity',
          target,
          `Verify clients reconnect to the promoted Aurora cluster for ${node.name}.`,
          '3m',
          validation,
        ),
        createAction(
          'verify_data_integrity',
          target,
          `Validate replicated data consistency for ${node.name}.`,
          '5m',
        ),
      ];
    case 'failover':
      return isCacheLike(node)
        ? [
            createAction(
              'verify_status',
              target,
              `Check replica health for ${node.name}.`,
              '30s',
              validation,
            ),
            createAction(
              'failover_cache',
              target,
              `Trigger cache failover for ${node.name}.`,
              '60s',
            ),
            createAction(
              'verify_connectivity',
              target,
              `Verify clients can reconnect to ${node.name}.`,
              '2m',
              validation,
            ),
          ]
        : [
            createAction(
              'verify_status',
              target,
              `Check standby readiness for ${node.name}.`,
              '30s',
              validation,
            ),
            createAction(
              'promote_replica',
              target,
              `Promote the standby path for ${node.name}.`,
              '2m',
            ),
            createAction(
              'verify_connectivity',
              target,
              `Verify application connectivity to ${node.name}.`,
              '2m',
              validation,
            ),
            createAction(
              'verify_data_integrity',
              target,
              `Confirm ${node.name} data is current after failover.`,
              '5m',
            ),
          ];
    case 'restore_from_backup':
      return [
        createAction(
          'verify_status',
          target,
          `Confirm ${node.name} is unavailable before restore.`,
          '30s',
          validation,
        ),
        createAction(
          'restore_snapshot',
          target,
          `Restore ${node.name} from the latest valid backup or snapshot.`,
          '30m',
        ),
        ...(isStateful(node)
          ? [
              createAction(
                'rotate_secrets',
                target,
                `Rotate credentials and endpoints for restored ${node.name}.`,
                '5m',
              ),
            ]
          : []),
        createAction(
          'verify_connectivity',
          target,
          `Verify connectivity to restored ${node.name}.`,
          '5m',
          validation,
        ),
        createAction(
          'verify_data_integrity',
          target,
          `Validate restored data for ${node.name}.`,
          '10m',
        ),
      ];
    case 'dns_failover':
      return [
        createAction(
          'verify_status',
          target,
          `Validate target endpoint health for ${node.name}.`,
          '30s',
          validation,
        ),
        createAction(
          'update_dns',
          target,
          `Update DNS to route traffic away from the failed target for ${node.name}.`,
          '60s',
        ),
        createAction(
          'verify_connectivity',
          target,
          `Confirm DNS resolution and traffic flow for ${node.name}.`,
          '2m',
          validation,
        ),
      ];
    case 'auto_scaling':
      return [
        createAction(
          'verify_status',
          target,
          `Review scaling group health for ${node.name}.`,
          '30s',
          validation,
        ),
        createAction('scale_up', target, `Increase healthy capacity for ${node.name}.`, '5m'),
        createAction(
          'verify_connectivity',
          target,
          `Confirm ${node.name} is serving traffic after scale-out.`,
          '2m',
          validation,
        ),
      ];
    case 'rebuild':
      return [
        createAction(
          'manual_intervention',
          target,
          `Rebuild ${node.name} from infrastructure templates and current configuration.`,
          '30m',
        ),
        createAction(
          'verify_status',
          target,
          `Verify rebuilt ${node.name} reaches a healthy state.`,
          '5m',
          validation,
        ),
        createAction(
          'verify_connectivity',
          target,
          `Confirm dependencies can reach rebuilt ${node.name}.`,
          '5m',
          validation,
        ),
      ];
    case 'manual':
      return [
        createAction(
          'manual_intervention',
          target,
          `Manual operator recovery is required for ${node.name}.`,
          '1h',
        ),
        createAction(
          'verify_status',
          target,
          `Verify ${node.name} once manual recovery is complete.`,
          '5m',
          validation,
        ),
      ];
    case 'none':
      return [
        createAction(
          'manual_intervention',
          target,
          `No deterministic recovery path was identified for ${node.name}.`,
          '1h',
        ),
      ];
  }
}

function createAction(
  action: RecoveryAction['action'],
  target: string,
  description: string,
  timeout: string,
  validation?: RecoveryValidation,
): RecoveryAction {
  return {
    action,
    target,
    description,
    timeout,
    ...(action === 'restore_snapshot'
      ? { rollbackAction: `Discard partial restore for ${target}` }
      : {}),
    ...(validation ? { validation } : {}),
  };
}

function resolveTarget(node: InfrastructureNode): string {
  const metadata = getMetadata(node);
  return (
    readString(metadata.clusterEndpoint) ??
    readString(metadata.readerEndpoint) ??
    readString(metadata.endpointAddress) ??
    readString(metadata.configurationEndpoint) ??
    readString(metadata.primaryEndpoint) ??
    readString(metadata.bucketName) ??
    readString(metadata.tableName) ??
    readString(metadata.queueName) ??
    readString(metadata.topicName) ??
    readString(metadata.functionName) ??
    readString(metadata.dbIdentifier) ??
    node.id
  );
}

function createValidation(node: InfrastructureNode): RecoveryValidation | undefined {
  const metadata = getMetadata(node);
  const endpoint =
    readString(metadata.clusterEndpoint) ??
    readString(metadata.readerEndpoint) ??
    readString(metadata.endpointAddress) ??
    readString(metadata.configurationEndpoint) ??
    readString(metadata.primaryEndpoint) ??
    readString(metadata.hostname) ??
    readString(metadata.ip);

  if (endpoint) return { endpoint, expectedStatus: 200 };
  if (isDnsLike(node, readSourceType(node))) return { command: `nslookup ${node.name}` };
  return undefined;
}

function readSourceType(node: InfrastructureNode): string {
  return (readString(getMetadata(node).sourceType) ?? '').toLowerCase();
}

function hasBackup(node: InfrastructureNode): boolean {
  const metadata = getMetadata(node);
  const backupPolicy =
    metadata.backupPolicy && typeof metadata.backupPolicy === 'object' && !Array.isArray(metadata.backupPolicy)
      ? (metadata.backupPolicy as Record<string, unknown>)
      : null;
  return (
    readBoolean(metadata.automaticBackups) === true ||
    readString(backupPolicy?.status)?.toUpperCase() === 'ENABLED' ||
    readBoolean(metadata.backupEnabled) === true ||
    readBoolean(metadata.snapshotEnabled) === true ||
    readNumber(metadata.backupRetentionPeriod) !== null ||
    readNumber(metadata.backupRetentionDays) !== null ||
    readNumber(metadata.snapshotCount) !== null ||
    hasPointInTimeRecovery(metadata) ||
    hasVersioning(metadata) ||
    Object.keys(node.tags).some((key) => ['backup', 'snapshot'].includes(key.toLowerCase()))
  );
}

function hasPointInTimeRecovery(metadata: Record<string, unknown>): boolean {
  return readBoolean(metadata.pointInTimeRecovery) === true;
}

function hasVersioning(metadata: Record<string, unknown>): boolean {
  return (readString(metadata.versioningStatus) ?? '').toLowerCase() === 'enabled';
}

function hasCrossRegionReplication(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.hasCrossRegionReplication) === true ||
    (readNumber(metadata.replicationRules) ?? 0) > 0
  );
}

function hasEfsReplication(metadata: Record<string, unknown>): boolean {
  return (
    Array.isArray(metadata.replicationConfigurations) &&
    metadata.replicationConfigurations.some((value) => value && typeof value === 'object')
  );
}

function hasAuroraGlobalDatabase(metadata: Record<string, unknown>): boolean {
  return readString(metadata.globalClusterIdentifier) !== null;
}

function hasAuroraReplica(metadata: Record<string, unknown>): boolean {
  return (readNumber(metadata.replicaCount) ?? 0) > 0;
}

function hasCacheFailover(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.automaticFailover) === true ||
    readBoolean(metadata.multiAZEnabled) === true ||
    readBoolean(metadata.clusterEnabled) === true ||
    (readNumber(metadata.memberClusters) ?? 0) > 1 ||
    getReplicaCount(metadata) > 0
  );
}

function hasGlobalReplication(metadata: Record<string, unknown>): boolean {
  return readBoolean(metadata.globalTable) === true || getReplicaCount(metadata) > 0;
}

function hasNodegroupScaling(metadata: Record<string, unknown>): boolean {
  return (readNumber(metadata.maxSize) ?? 0) > 1 || (readNumber(metadata.desiredSize) ?? 0) > 1;
}

function hasDnsFailover(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.healthCheckEnabled) === true ||
    readString(metadata.healthCheckId) !== null ||
    (Array.isArray(metadata.healthChecks) && metadata.healthChecks.length > 0)
  );
}

function isRdsLike(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.DATABASE && sourceType.includes('rds');
}

function isAuroraClusterLike(sourceType: string): boolean {
  return sourceType.includes('aurora_cluster');
}

function isDynamoLike(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.DATABASE && sourceType.includes('dynamodb');
}

function isEc2Like(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.VM && sourceType.includes('ec2');
}

function isLambdaLike(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.SERVERLESS || sourceType.includes('lambda');
}

function isS3Like(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.OBJECT_STORAGE && sourceType.includes('s3');
}

function isEfsLike(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.FILE_STORAGE && sourceType.includes('efs');
}

function isElastiCacheLike(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.CACHE && sourceType.includes('elasticache');
}

function isMessagingLike(node: InfrastructureNode, sourceType: string): boolean {
  return (
    node.type === NodeType.MESSAGE_QUEUE || sourceType.includes('sqs') || sourceType.includes('sns')
  );
}

function isLoadBalancerLike(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.LOAD_BALANCER || sourceType.includes('elb');
}

function isEksClusterLike(sourceType: string): boolean {
  return sourceType === 'eks';
}

function isEksNodegroupLike(sourceType: string): boolean {
  return sourceType === 'eks_nodegroup';
}

function isAutoScalingLike(sourceType: string): boolean {
  return sourceType.includes('asg') || sourceType.includes('auto_scaling');
}

function isDnsLike(node: InfrastructureNode, sourceType: string): boolean {
  return node.type === NodeType.DNS || sourceType.includes('route53') || sourceType.includes('dns');
}

function isNetworkLike(node: InfrastructureNode): boolean {
  return [NodeType.VPC, NodeType.SUBNET, NodeType.FIREWALL].includes(node.type as NodeType);
}

function isCacheLike(node: InfrastructureNode): boolean {
  return node.type === NodeType.CACHE;
}

function isStateful(node: InfrastructureNode): boolean {
  return [
    NodeType.DATABASE,
    NodeType.CACHE,
    NodeType.OBJECT_STORAGE,
    NodeType.MESSAGE_QUEUE,
  ].includes(node.type as NodeType);
}

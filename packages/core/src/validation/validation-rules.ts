import {
  getAvailabilityZone,
  getMetadata,
  hasDeadLetterQueue,
  readBoolean,
  readNumber,
  readString,
} from '../graph/analysis-helpers.js';
import type {
  InfraNode,
  ValidationContext,
  ValidationResult,
  ValidationRule,
} from './validation-types.js';
import { collectNodeReferences, hasNodeKind } from './validation-node-utils.js';
import { ecsValidationRules } from './rules/ecs-rules.js';

const MINIMUM_BACKUP_RETENTION_DAYS = 7;
const ROUTE53_WARN_TTL_SECONDS = 60;
const ROUTE53_FAIL_TTL_SECONDS = 300;
const BACKUP_WARN_THRESHOLD_HOURS = 13;
const BACKUP_FAIL_THRESHOLD_HOURS = 25;
const REQUIRED_MULTI_AZ_COUNT = 2;

function createResult(
  ruleId: string,
  node: InfraNode,
  status: ValidationResult['status'],
  message: string,
  details?: Record<string, unknown>,
  remediation?: string,
): ValidationResult {
  return {
    ruleId,
    nodeId: node.id,
    status,
    message,
    ...(details ? { details } : {}),
    ...(remediation ? { remediation } : {}),
  };
}

function normalizeReference(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

function addReference(target: Set<string>, value: string | null): void {
  if (!value) return;
  const normalized = normalizeReference(value);
  if (!normalized) return;
  target.add(normalized);

  if (normalized.startsWith('arn:')) {
    const lastColon = normalized.split(':').pop();
    const lastSlash = normalized.split('/').pop();
    if (lastColon) target.add(lastColon);
    if (lastSlash) target.add(lastSlash);
    const loadBalancerMarker = 'loadbalancer/';
    const loadBalancerIndex = normalized.indexOf(loadBalancerMarker);
    if (loadBalancerIndex >= 0) {
      target.add(normalized.slice(loadBalancerIndex + loadBalancerMarker.length));
    }
  }

  if (normalized.includes('.')) {
    target.add(normalized.replace(/^dualstack\./, ''));
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readObjectArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readString(entry)).filter((entry): entry is string => entry !== null);
}

function matchesNodeReferences(nodeReferences: ReadonlySet<string>, value: unknown): boolean {
  const raw = readString(value);
  if (!raw) return false;
  const candidates = new Set<string>();
  addReference(candidates, raw);
  return Array.from(candidates).some((candidate) => nodeReferences.has(candidate));
}

function findNodeByReference(reference: string, context: ValidationContext): InfraNode | undefined {
  const normalized = normalizeReference(reference);
  return context.allNodes.find((node) => collectNodeReferences(node).has(normalized));
}

function findNodesByEdge(
  nodeId: string,
  context: ValidationContext,
  direction: 'incoming' | 'outgoing',
  edgeType?: string,
): readonly InfraNode[] {
  return context.edges
    .filter((edge) => {
      const directionMatch = direction === 'incoming' ? edge.target === nodeId : edge.source === nodeId;
      return directionMatch && (!edgeType || edge.type.toLowerCase() === edgeType.toLowerCase());
    })
    .map((edge) =>
      context.allNodes.find(
        (node) => node.id === (direction === 'incoming' ? edge.source : edge.target),
      ),
    )
    .filter((node): node is InfraNode => Boolean(node));
}

function readReplicaIds(node: InfraNode): readonly string[] {
  const metadata = getMetadata(node);
  const direct = readStringArray(metadata.readReplicaDBInstanceIdentifiers);
  if (direct.length > 0) return direct;
  return readStringArray(metadata.replicaNames);
}

function findLinkedNodes(node: InfraNode, context: ValidationContext): readonly InfraNode[] {
  const replicaNodes = readReplicaIds(node)
    .map((replicaId) => findNodeByReference(replicaId, context))
    .filter((candidate): candidate is InfraNode => Boolean(candidate));
  const edgeLinkedNodes = context.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) =>
      context.allNodes.find(
        (candidate) => candidate.id === (edge.source === node.id ? edge.target : edge.source),
      ),
    )
    .filter((candidate): candidate is InfraNode => Boolean(candidate));

  return Array.from(
    new Map([...replicaNodes, ...edgeLinkedNodes].map((candidate) => [candidate.id, candidate])).values(),
  );
}

function findAsgNode(node: InfraNode, context: ValidationContext): InfraNode | undefined {
  const incoming = findNodesByEdge(node.id, context, 'incoming').find((candidate) =>
    hasNodeKind(candidate, ['asg', 'auto-scaling']),
  );
  if (incoming) return incoming;

  const asgName = readString(getMetadata(node).autoScalingGroupName);
  return asgName
    ? context.allNodes.find(
        (candidate) =>
          hasNodeKind(candidate, ['asg', 'auto-scaling']) &&
          (candidate.name === asgName || candidate.id.includes(asgName)),
      )
    : undefined;
}

function readNodeRegion(node: InfraNode): string | null {
  return readString(node.region) ?? readString(getMetadata(node).region);
}

function isEnabledFlag(value: unknown): boolean | null {
  const booleanValue = readBoolean(value);
  if (booleanValue != null) return booleanValue;
  const stringValue = readString(value)?.toLowerCase();
  if (!stringValue) return null;
  if (['enabled', 'enabling', 'active', 'true'].includes(stringValue)) return true;
  if (['disabled', 'disabling', 'inactive', 'false'].includes(stringValue)) return false;
  return null;
}

function findBackupPlanNode(node: InfraNode, context: ValidationContext): InfraNode | undefined {
  const backupCoverage = context.backupCoverage;
  if (!backupCoverage) return undefined;

  for (const reference of collectNodeReferences(node)) {
    const backupPlanId = backupCoverage.get(reference);
    if (!backupPlanId) continue;
    const backupPlanNode = context.allNodes.find(
      (candidate) => candidate.id === backupPlanId && hasNodeKind(candidate, ['backup-plan']),
    );
    if (backupPlanNode) return backupPlanNode;
  }

  return undefined;
}

function findProtectedResourceSummary(
  node: InfraNode,
  context: ValidationContext,
): Record<string, unknown> | undefined {
  const backupPlanNode = findBackupPlanNode(node, context);
  if (!backupPlanNode) return undefined;
  const nodeReferences = collectNodeReferences(node);
  return readObjectArray(getMetadata(backupPlanNode).protectedResources).find(
    (resource) =>
      matchesNodeReferences(nodeReferences, resource.resourceArn) ||
      matchesNodeReferences(nodeReferences, resource.resourceName),
  );
}

function calculateBackupAgeHours(lastBackupTime: string): number | null {
  const timestamp = Date.parse(lastBackupTime);
  if (Number.isNaN(timestamp)) return null;
  return (Date.now() - timestamp) / (60 * 60 * 1000);
}

function hasLifecycleConfigured(lifecycle: Record<string, unknown> | null): boolean {
  if (!lifecycle) return false;
  return (
    readNumber(lifecycle.MoveToColdStorageAfterDays) !== null ||
    readNumber(lifecycle.DeleteAfterDays) !== null ||
    readString(lifecycle.DeleteAfterEvent) !== null
  );
}

function findAuroraReplicaNodes(
  node: InfraNode,
  context: ValidationContext,
): readonly InfraNode[] {
  return findNodesByEdge(node.id, context, 'outgoing', 'CONTAINS').filter(
    (candidate) =>
      hasNodeKind(candidate, ['aurora-instance']) &&
      readBoolean(getMetadata(candidate).isClusterWriter) !== true,
  );
}

function findEfsMountTargetNodes(
  node: InfraNode,
  context: ValidationContext,
): readonly InfraNode[] {
  const direct = findNodesByEdge(node.id, context, 'outgoing', 'CONTAINS').filter((candidate) =>
    hasNodeKind(candidate, ['efs-mount-target']),
  );
  if (direct.length > 0) return direct;

  const fileSystemId = readString(getMetadata(node).fileSystemId) ?? node.id;
  return context.allNodes.filter(
    (candidate) =>
      hasNodeKind(candidate, ['efs-mount-target']) &&
      readString(getMetadata(candidate).fileSystemId) === fileSystemId,
  );
}

function readBackupPolicyStatus(node: InfraNode): string | null {
  const backupPolicy = readObject(getMetadata(node).backupPolicy);
  return readString(backupPolicy?.status)?.toUpperCase() ?? null;
}

const rdsReplicaHealthyRule: ValidationRule = {
  id: 'rds_replica_healthy',
  name: 'RDS Read Replica Health',
  description: 'Confirms the primary RDS instance declares replicas that are present in the graph.',
  category: 'replication',
  severity: 'critical',
  appliesToTypes: ['rds', 'rds-instance'],
  validate: (node, context) => {
    const metadata = getMetadata(node);
    if (readString(metadata.readReplicaSourceDBInstanceIdentifier)) {
      return createResult(rdsReplicaHealthyRule.id, node, 'skip', 'Node is itself a read replica.');
    }

    const replicaIds = readReplicaIds(node);
    if (replicaIds.length === 0) {
      return createResult(
        rdsReplicaHealthyRule.id,
        node,
        'fail',
        'No read replicas found.',
        undefined,
        'Create at least one healthy read replica for the primary instance.',
      );
    }

    const missingReplicas = replicaIds.filter((replicaId) => !findNodeByReference(replicaId, context));
    return missingReplicas.length === 0
      ? createResult(
          rdsReplicaHealthyRule.id,
          node,
          'pass',
          `${replicaIds.length} read replica(s) found.`,
          { replicaIds },
        )
      : createResult(
          rdsReplicaHealthyRule.id,
          node,
          'fail',
          `Replica nodes missing from graph: ${missingReplicas.join(', ')}.`,
          { replicaIds, missingReplicas },
          'Ensure replica instances are discoverable and healthy in the latest scan.',
        );
  },
};

const rdsMultiAzActiveRule: ValidationRule = {
  id: 'rds_multi_az_active',
  name: 'RDS Multi-AZ Active',
  description: 'Checks whether Multi-AZ is enabled on the RDS instance.',
  category: 'failover',
  severity: 'high',
  appliesToTypes: ['rds', 'rds-instance'],
  observedKeys: ['multiAZ', 'multiAz', 'multi_az', 'isMultiAZ'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const enabled =
      readBoolean(metadata.multiAZ) ??
      readBoolean(metadata.multiAz) ??
      readBoolean(metadata.multi_az) ??
      readBoolean(metadata.isMultiAZ);
    return enabled === true
      ? createResult(rdsMultiAzActiveRule.id, node, 'pass', 'Multi-AZ is enabled.')
      : createResult(
          rdsMultiAzActiveRule.id,
          node,
          'fail',
          'Multi-AZ is disabled.',
          { multiAZ: enabled },
          'Enable Multi-AZ to reduce zonal failure impact.',
        );
  },
};

const rdsBackupConfiguredRule: ValidationRule = {
  id: 'rds_backup_configured',
  name: 'RDS Backup Config',
  description: 'Checks whether automated backups are configured on the RDS instance.',
  category: 'backup',
  severity: 'high',
  appliesToTypes: ['rds', 'rds-instance'],
  observedKeys: ['backupRetentionPeriod', 'backupRetentionDays'],
  validate: (node) => {
    const retentionDays =
      readNumber(getMetadata(node).backupRetentionPeriod) ??
      readNumber(getMetadata(node).backupRetentionDays);
    return retentionDays !== null && retentionDays > 0
      ? createResult(
          rdsBackupConfiguredRule.id,
          node,
          'pass',
          `Automated backups retained for ${retentionDays} day(s).`,
          { retentionDays },
        )
      : createResult(
          rdsBackupConfiguredRule.id,
          node,
          'fail',
          'Automated backups are not configured.',
          { retentionDays },
          'Set a backup retention period greater than zero.',
        );
  },
};

const auroraMultiAzRule: ValidationRule = {
  id: 'aurora_multi_az',
  name: 'Aurora Multi-AZ',
  description: 'Checks whether the Aurora cluster spans at least two availability zones.',
  category: 'redundancy',
  severity: 'critical',
  appliesToTypes: ['aurora-cluster'],
  validate: (node) => {
    const availabilityZones = readStringArray(getMetadata(node).availabilityZones);
    return availabilityZones.length >= REQUIRED_MULTI_AZ_COUNT
      ? createResult(
          auroraMultiAzRule.id,
          node,
          'pass',
          `Aurora cluster spans ${availabilityZones.length} availability zones.`,
          { availabilityZones },
        )
      : createResult(
          auroraMultiAzRule.id,
          node,
          'fail',
          'Aurora cluster is not distributed across multiple availability zones.',
          { availabilityZones },
          'Deploy Aurora instances across at least two availability zones.',
        );
  },
};

const auroraReplicaExistsRule: ValidationRule = {
  id: 'aurora_replica_exists',
  name: 'Aurora Replica Presence',
  description: 'Checks whether the Aurora cluster has at least one readable replica for failover.',
  category: 'failover',
  severity: 'critical',
  appliesToTypes: ['aurora-cluster'],
  validate: (node, context) => {
    const replicas = findAuroraReplicaNodes(node, context);
    const replicaIds = replicas.map((replica) => replica.id);
    return replicas.length > 0
      ? createResult(
          auroraReplicaExistsRule.id,
          node,
          'pass',
          `${replicas.length} Aurora replica(s) available for failover.`,
          { replicaCount: replicas.length, replicaIds },
        )
      : createResult(
          auroraReplicaExistsRule.id,
          node,
          'fail',
          'No Aurora replicas were found for the cluster.',
          { replicaCount: 0, replicaIds },
          'Add at least one Aurora reader instance so failover does not depend on a single writer.',
        );
  },
};

const auroraBackupConfiguredRule: ValidationRule = {
  id: 'aurora_backup_configured',
  name: 'Aurora Backup Config',
  description: 'Checks whether Aurora automated backups are configured.',
  category: 'backup',
  severity: 'critical',
  appliesToTypes: ['aurora-cluster'],
  validate: (node) => {
    const retentionDays = readNumber(getMetadata(node).backupRetentionPeriod) ?? 0;
    return retentionDays > 0
      ? createResult(
          auroraBackupConfiguredRule.id,
          node,
          'pass',
          `Aurora backups retained for ${retentionDays} day(s).`,
          { retentionDays },
        )
      : createResult(
          auroraBackupConfiguredRule.id,
          node,
          'fail',
          'Aurora automated backups are disabled.',
          { retentionDays },
          'Set Aurora backup retention to a value greater than zero.',
        );
  },
};

const auroraBackupRetentionAdequateRule: ValidationRule = {
  id: 'aurora_backup_retention_adequate',
  name: 'Aurora Backup Retention',
  description: 'Checks whether Aurora backup retention meets the minimum DR threshold.',
  category: 'backup',
  severity: 'medium',
  appliesToTypes: ['aurora-cluster'],
  validate: (node) => {
    const retentionDays = readNumber(getMetadata(node).backupRetentionPeriod) ?? 0;
    if (retentionDays >= MINIMUM_BACKUP_RETENTION_DAYS) {
      return createResult(
        auroraBackupRetentionAdequateRule.id,
        node,
        'pass',
        `Aurora retention is ${retentionDays} day(s).`,
        { retentionDays },
      );
    }
    if (retentionDays > 0) {
      return createResult(
        auroraBackupRetentionAdequateRule.id,
        node,
        'warn',
        `Aurora retention is ${retentionDays} day(s) (< ${MINIMUM_BACKUP_RETENTION_DAYS}).`,
        { retentionDays },
        `Increase Aurora retention to at least ${MINIMUM_BACKUP_RETENTION_DAYS} days.`,
      );
    }
    return createResult(
      auroraBackupRetentionAdequateRule.id,
      node,
      'fail',
      'Aurora backup retention is disabled.',
      { retentionDays },
      `Set Aurora retention to at least ${MINIMUM_BACKUP_RETENTION_DAYS} days.`,
    );
  },
};

const auroraDeletionProtectionRule: ValidationRule = {
  id: 'aurora_deletion_protection',
  name: 'Aurora Deletion Protection',
  description: 'Checks whether Aurora deletion protection is enabled.',
  category: 'backup',
  severity: 'high',
  appliesToTypes: ['aurora-cluster'],
  validate: (node) =>
    readBoolean(getMetadata(node).deletionProtection) === true
      ? createResult(
          auroraDeletionProtectionRule.id,
          node,
          'pass',
          'Aurora deletion protection is enabled.',
        )
      : createResult(
          auroraDeletionProtectionRule.id,
          node,
          'fail',
          'Aurora deletion protection is disabled.',
          undefined,
          'Enable deletion protection to reduce accidental cluster deletion risk.',
        ),
};

const auroraGlobalDatabaseRule: ValidationRule = {
  id: 'aurora_global_database',
  name: 'Aurora Global Database',
  description: 'Reports whether the Aurora cluster participates in a global database.',
  category: 'replication',
  severity: 'low',
  appliesToTypes: ['aurora-cluster'],
  validate: (node) => {
    const globalClusterIdentifier = readString(getMetadata(node).globalClusterIdentifier);
    return globalClusterIdentifier
      ? createResult(
          auroraGlobalDatabaseRule.id,
          node,
          'pass',
          `Cluster belongs to Aurora global database ${globalClusterIdentifier}.`,
          { globalClusterIdentifier },
        )
      : createResult(
          auroraGlobalDatabaseRule.id,
          node,
          'skip',
          'Cluster is not part of an Aurora global database.',
        );
  },
};

const auroraPromotionTierRule: ValidationRule = {
  id: 'aurora_promotion_tier',
  name: 'Aurora Promotion Tier',
  description: 'Checks whether at least one Aurora replica has a top failover promotion tier.',
  category: 'failover',
  severity: 'medium',
  appliesToTypes: ['aurora-cluster'],
  validate: (node, context) => {
    const replicas = findAuroraReplicaNodes(node, context);
    if (replicas.length === 0) {
      return createResult(
        auroraPromotionTierRule.id,
        node,
        'skip',
        'No Aurora replicas are available to evaluate promotion tier.',
      );
    }

    const promotionTiers = replicas
      .map((replica) => readNumber(getMetadata(replica).promotionTier))
      .filter((tier): tier is number => tier !== null);
    const bestTier = promotionTiers.length > 0 ? Math.min(...promotionTiers) : null;
    return bestTier !== null && bestTier <= 1
      ? createResult(
          auroraPromotionTierRule.id,
          node,
          'pass',
          `Aurora replica promotion tier is ${bestTier}.`,
          { promotionTiers },
        )
      : createResult(
          auroraPromotionTierRule.id,
          node,
          'warn',
          'Aurora replicas have no top-priority promotion tier configured.',
          { promotionTiers },
          'Lower at least one Aurora replica promotion tier to 0 or 1.',
        );
  },
};

const efsBackupEnabledRule: ValidationRule = {
  id: 'efs_backup_enabled',
  name: 'EFS Backup Enabled',
  description: 'Checks whether EFS automatic backups are enabled.',
  category: 'backup',
  severity: 'critical',
  appliesToTypes: ['efs', 'efs-filesystem'],
  validate: (node) => {
    const backupPolicyStatus = readBackupPolicyStatus(node);
    const automaticBackups = readBoolean(getMetadata(node).automaticBackups) === true;
    return automaticBackups || backupPolicyStatus === 'ENABLED'
      ? createResult(
          efsBackupEnabledRule.id,
          node,
          'pass',
          'EFS automatic backups are enabled.',
          { backupPolicyStatus },
        )
      : createResult(
          efsBackupEnabledRule.id,
          node,
          'fail',
          'EFS automatic backups are disabled.',
          { backupPolicyStatus, automaticBackups },
          'Enable EFS automatic backups or protect the filesystem with AWS Backup.',
        );
  },
};

const efsReplicationConfiguredRule: ValidationRule = {
  id: 'efs_replication_configured',
  name: 'EFS Replication',
  description: 'Checks whether EFS replication is configured and enabled.',
  category: 'replication',
  severity: 'high',
  appliesToTypes: ['efs', 'efs-filesystem'],
  validate: (node) => {
    const configurations = readObjectArray(getMetadata(node).replicationConfigurations);
    const enabled = configurations.filter(
      (configuration) => readString(configuration.status)?.toUpperCase() === 'ENABLED',
    );
    return enabled.length > 0
      ? createResult(
          efsReplicationConfiguredRule.id,
          node,
          'pass',
          `${enabled.length} EFS replication destination(s) enabled.`,
        )
      : createResult(
          efsReplicationConfiguredRule.id,
          node,
          'fail',
          'EFS replication is not configured or not enabled.',
          { replicationConfigurations: configurations },
          'Configure EFS replication to a DR filesystem in another region or account.',
        );
  },
};

const efsMultiAzRule: ValidationRule = {
  id: 'efs_multi_az',
  name: 'EFS Regional Mode',
  description: 'Checks whether EFS uses Regional storage instead of One Zone.',
  category: 'redundancy',
  severity: 'critical',
  appliesToTypes: ['efs', 'efs-filesystem'],
  validate: (node) => {
    const availabilityZoneName = readString(getMetadata(node).availabilityZoneName);
    return availabilityZoneName === null
      ? createResult(efsMultiAzRule.id, node, 'pass', 'EFS is deployed in Regional mode.')
      : createResult(
          efsMultiAzRule.id,
          node,
          'fail',
          `EFS is deployed in One Zone (${availabilityZoneName}).`,
          { availabilityZoneName },
          'Use Regional EFS for native multi-AZ durability.',
        );
  },
};

const efsMountTargetMultiAzRule: ValidationRule = {
  id: 'efs_mount_target_multi_az',
  name: 'EFS Mount Target Multi-AZ',
  description: 'Checks whether EFS mount targets provide access paths across multiple AZs.',
  category: 'redundancy',
  severity: 'high',
  appliesToTypes: ['efs', 'efs-filesystem'],
  validate: (node, context) => {
    const mountTargets = findEfsMountTargetNodes(node, context);
    const availabilityZones = Array.from(
      new Set(
        mountTargets
          .map((mountTarget) => getAvailabilityZone(mountTarget))
          .filter((zone): zone is string => zone !== null),
      ),
    ).sort();

    return availabilityZones.length >= REQUIRED_MULTI_AZ_COUNT
      ? createResult(
          efsMountTargetMultiAzRule.id,
          node,
          'pass',
          `EFS mount targets span ${availabilityZones.length} availability zones.`,
          { availabilityZones },
        )
      : createResult(
          efsMountTargetMultiAzRule.id,
          node,
          'fail',
          'EFS mount targets do not span multiple availability zones.',
          { availabilityZones, mountTargetCount: mountTargets.length },
          'Create mount targets in at least two availability zones used by clients.',
        );
  },
};

const s3VersioningEnabledRule: ValidationRule = {
  id: 's3_versioning_enabled',
  name: 'S3 Versioning',
  description: 'Checks whether object versioning is enabled for the bucket.',
  category: 'backup',
  severity: 'high',
  appliesToTypes: ['s3', 's3-bucket'],
  observedKeys: ['versioningStatus'],
  validate: (node) => {
    const status = readString(getMetadata(node).versioningStatus);
    return status?.toLowerCase() === 'enabled'
      ? createResult(s3VersioningEnabledRule.id, node, 'pass', 'Bucket versioning is enabled.')
      : createResult(
          s3VersioningEnabledRule.id,
          node,
          'fail',
          'Bucket versioning is disabled.',
          { versioningStatus: status },
          'Enable S3 versioning to support rollback and restore workflows.',
        );
  },
};

const s3ReplicationActiveRule: ValidationRule = {
  id: 's3_replication_active',
  name: 'S3 Replication',
  description: 'Checks whether at least one replication rule is enabled for the bucket.',
  category: 'replication',
  severity: 'critical',
  appliesToTypes: ['s3', 's3-bucket'],
  observedKeys: ['replicationRules'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const rules = Array.isArray(metadata.replicationRules)
      ? metadata.replicationRules
      : (readNumber(metadata.replicationRules) ?? 0) > 0
        ? [
            {
              status:
                readBoolean(metadata.hasCrossRegionReplication) === false ? 'Disabled' : 'Enabled',
            },
          ]
        : [];
    const enabledRules = rules.filter(
      (rule) =>
        rule &&
        typeof rule === 'object' &&
        readString((rule as Record<string, unknown>).status)?.toLowerCase() === 'enabled',
    );
    return enabledRules.length > 0
      ? createResult(
          s3ReplicationActiveRule.id,
          node,
          'pass',
          `${enabledRules.length} replication rule(s) enabled.`,
        )
      : createResult(
          s3ReplicationActiveRule.id,
          node,
          'fail',
          'Replication is disabled or missing.',
          { replicationRules: metadata.replicationRules },
          'Enable at least one active replication rule for the bucket.',
        );
  },
};

const ec2InAsgRule: ValidationRule = {
  id: 'ec2_in_asg',
  name: 'EC2 Auto-Scaling',
  description: 'Checks whether the EC2 instance belongs to an Auto Scaling group.',
  category: 'recovery',
  severity: 'high',
  appliesToTypes: ['ec2', 'ec2-instance'],
  validate: (node, context) => {
    const asgNode = findAsgNode(node, context);
    return asgNode
      ? createResult(ec2InAsgRule.id, node, 'pass', `Instance is managed by ASG ${asgNode.name}.`, {
          asgId: asgNode.id,
          asgName: asgNode.name,
        })
      : createResult(
          ec2InAsgRule.id,
          node,
          'fail',
          'Instance is not attached to an Auto Scaling group.',
          {
            asgId: null,
            asgName: null,
          },
          'Place the instance behind an Auto Scaling group or equivalent replacement mechanism.',
        );
  },
};

const ec2MultiAzRule: ValidationRule = {
  id: 'ec2_multi_az',
  name: 'EC2 Multi-AZ',
  description: 'Checks whether instances in the same Auto Scaling group span at least two AZs.',
  category: 'redundancy',
  severity: 'high',
  appliesToTypes: ['ec2', 'ec2-instance'],
  validate: (node, context) => {
    const asgNode = findAsgNode(node, context);
    if (!asgNode) {
      return createResult(ec2MultiAzRule.id, node, 'skip', 'No Auto Scaling group found for this instance.');
    }

    const siblingNodes = context.allNodes.filter(
      (candidate) =>
        candidate.id === node.id ||
        (hasNodeKind(candidate, ['ec2', 'ec2-instance']) &&
          findAsgNode(candidate, context)?.id === asgNode.id),
    );
    const availabilityZones = Array.from(
      new Set(
        siblingNodes
          .map((candidate) => getAvailabilityZone(candidate))
          .filter((zone): zone is string => zone !== null),
      ),
    ).sort();

    return availabilityZones.length >= REQUIRED_MULTI_AZ_COUNT
      ? createResult(
          ec2MultiAzRule.id,
          node,
          'pass',
          `ASG spans ${availabilityZones.length} availability zones.`,
          { asgId: asgNode.id, availabilityZones },
        )
      : createResult(
          ec2MultiAzRule.id,
          node,
          'fail',
          'ASG instances are not distributed across multiple availability zones.',
          { asgId: asgNode.id, availabilityZones },
          'Distribute Auto Scaling instances across at least two availability zones.',
        );
  },
};

const elasticacheFailoverRule: ValidationRule = {
  id: 'elasticache_failover',
  name: 'ElastiCache Failover',
  description: 'Checks whether automatic failover is enabled for ElastiCache.',
  category: 'failover',
  severity: 'high',
  appliesToTypes: ['elasticache'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const enabled =
      isEnabledFlag(metadata.automaticFailover) ?? isEnabledFlag(metadata.automaticFailoverStatus);
    return enabled === true
      ? createResult(elasticacheFailoverRule.id, node, 'pass', 'Automatic failover is enabled.')
      : createResult(
          elasticacheFailoverRule.id,
          node,
          'fail',
          'Automatic failover is disabled.',
          {
            automaticFailover: metadata.automaticFailover,
            automaticFailoverStatus: metadata.automaticFailoverStatus,
          },
          'Enable automatic failover on the replication group.',
        );
  },
};

const dynamodbPitrEnabledRule: ValidationRule = {
  id: 'dynamodb_pitr_enabled',
  name: 'DynamoDB PITR',
  description: 'Checks whether DynamoDB point-in-time recovery is enabled.',
  category: 'backup',
  severity: 'critical',
  appliesToTypes: ['dynamodb'],
  observedKeys: ['pointInTimeRecoveryEnabled', 'pitrEnabled', 'pointInTimeRecovery'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const enabled =
      readBoolean(metadata.pointInTimeRecoveryEnabled) ??
      readBoolean(metadata.pitrEnabled) ??
      readBoolean(metadata.pointInTimeRecovery);
    return enabled === true
      ? createResult(dynamodbPitrEnabledRule.id, node, 'pass', 'Point-in-time recovery is enabled.')
      : createResult(
          dynamodbPitrEnabledRule.id,
          node,
          'fail',
          'Point-in-time recovery is disabled.',
          undefined,
          'Enable PITR for the table.',
        );
  },
};

const backupRetentionAdequateRule: ValidationRule = {
  id: 'backup_retention_adequate',
  name: 'Backup Retention',
  description: 'Checks whether backup retention satisfies the minimum DR threshold.',
  category: 'backup',
  severity: 'medium',
  appliesToTypes: ['rds', 'rds-instance'],
  validate: (node) => {
    const retentionDays =
      readNumber(getMetadata(node).backupRetentionPeriod) ??
      readNumber(getMetadata(node).backupRetentionDays) ??
      0;
    if (retentionDays >= MINIMUM_BACKUP_RETENTION_DAYS) {
      return createResult(
        backupRetentionAdequateRule.id,
        node,
        'pass',
        `Retention is ${retentionDays} day(s).`,
        { retentionDays },
      );
    }
    if (retentionDays > 0) {
      return createResult(
        backupRetentionAdequateRule.id,
        node,
        'warn',
        `Retention is ${retentionDays} day(s) (< ${MINIMUM_BACKUP_RETENTION_DAYS}).`,
        { retentionDays },
        `Increase retention to at least ${MINIMUM_BACKUP_RETENTION_DAYS} days.`,
      );
    }
    return createResult(
      backupRetentionAdequateRule.id,
      node,
      'fail',
      'Retention is disabled.',
      { retentionDays },
      `Set backup retention to at least ${MINIMUM_BACKUP_RETENTION_DAYS} days.`,
    );
  },
};

const crossRegionExistsRule: ValidationRule = {
  id: 'cross_region_exists',
  name: 'Cross-Region DR',
  description: 'Checks whether the node has at least one linked DR target in another region.',
  category: 'replication',
  severity: 'high',
  appliesToTypes: ['rds', 's3'],
  validate: (node, context) => {
    const currentRegion = readNodeRegion(node);
    const linkedRegions = findLinkedNodes(node, context)
      .map((candidate) => readNodeRegion(candidate))
      .filter((region): region is string => region !== null);
    const hasCrossRegionTarget =
      currentRegion !== null && linkedRegions.some((region) => region !== currentRegion);
    return hasCrossRegionTarget
      ? createResult(
          crossRegionExistsRule.id,
          node,
          'pass',
          'Cross-region recovery target found.',
          { currentRegion, linkedRegions },
        )
      : createResult(
          crossRegionExistsRule.id,
          node,
          'fail',
          'No linked resource found in another region.',
          { currentRegion, linkedRegions },
          'Create or link a replica target in a secondary region.',
        );
  },
};

const route53HealthCheckRule: ValidationRule = {
  id: 'route53_health_check',
  name: 'Route53 Health Check',
  description: 'Checks whether failover, weighted, or latency records use a health check.',
  category: 'failover',
  severity: 'high',
  appliesToTypes: ['route53-record'],
  observedKeys: ['routingPolicy', 'healthCheckId'],
  validate: (node) => {
    const routingPolicy = readString(getMetadata(node).routingPolicy)?.toLowerCase();
    if (!routingPolicy || !['failover', 'weighted', 'latency'].includes(routingPolicy)) {
      return createResult(route53HealthCheckRule.id, node, 'skip', 'Record does not use failover-aware routing.');
    }

    return readString(getMetadata(node).healthCheckId)
      ? createResult(route53HealthCheckRule.id, node, 'pass', 'Route53 health check is configured.')
      : createResult(
          route53HealthCheckRule.id,
          node,
          'fail',
          'Failover-aware record has no Route53 health check.',
          { routingPolicy },
          'Attach a health check to enable automatic DNS failover.',
        );
  },
};

const route53FailoverConfiguredRule: ValidationRule = {
  id: 'route53_failover_configured',
  name: 'Route53 Failover Pair',
  description: 'Checks whether the hosted zone contains a PRIMARY and SECONDARY failover record pair.',
  category: 'failover',
  severity: 'critical',
  appliesToTypes: ['route53-hosted-zone'],
  validate: (node, context) => {
    const zoneRecords = [
      ...findNodesByEdge(node.id, context, 'outgoing', 'CONTAINS'),
      ...context.allNodes.filter(
        (candidate) =>
          hasNodeKind(candidate, ['route53-record']) &&
          readString(getMetadata(candidate).hostedZoneId) === node.id,
      ),
    ].filter((candidate, index, items) => items.findIndex((item) => item.id === candidate.id) === index);
    const failoverGroups = new Map<string, Set<string>>();

    for (const record of zoneRecords) {
      const metadata = getMetadata(record);
      const recordName = readString(metadata.name);
      const recordType = readString(metadata.type);
      const failover = readString(metadata.failover);
      if (!recordName || !recordType || !failover) continue;
      const key = `${recordName}|${recordType}`;
      const group = failoverGroups.get(key) ?? new Set<string>();
      group.add(failover.toUpperCase());
      failoverGroups.set(key, group);
    }

    const hasPair = Array.from(failoverGroups.values()).some(
      (group) => group.has('PRIMARY') && group.has('SECONDARY'),
    );
    const recordSets = Array.from(failoverGroups.entries()).map(
      ([key, group]) => `${key}:${Array.from(group).sort().join('/')}`,
    );
    const failoverPairCount = Array.from(failoverGroups.values()).filter(
      (group) => group.has('PRIMARY') && group.has('SECONDARY'),
    ).length;
    return hasPair
      ? createResult(
          route53FailoverConfiguredRule.id,
          node,
          'pass',
          'Hosted zone contains a PRIMARY/SECONDARY Route53 failover pair.',
          { failoverPairCount, recordSets },
        )
      : createResult(
          route53FailoverConfiguredRule.id,
          node,
          'fail',
          'Hosted zone has no complete Route53 failover pair.',
          { failoverPairCount, recordSets },
          'Create PRIMARY and SECONDARY failover records for the same DNS name.',
        );
  },
};

const route53TtlAppropriateRule: ValidationRule = {
  id: 'route53_ttl_appropriate',
  name: 'Route53 TTL',
  description: 'Checks whether failover records use a low enough TTL for DR failover.',
  category: 'failover',
  severity: 'medium',
  appliesToTypes: ['route53-record'],
  validate: (node) => {
    if (readString(getMetadata(node).routingPolicy)?.toLowerCase() !== 'failover') {
      return createResult(route53TtlAppropriateRule.id, node, 'skip', 'Record does not use failover routing.');
    }

    const ttl = readNumber(getMetadata(node).ttl);
    if (ttl === null) {
      return createResult(route53TtlAppropriateRule.id, node, 'skip', 'TTL is not configurable for this failover record.');
    }
    if (ttl > ROUTE53_FAIL_TTL_SECONDS) {
      return createResult(
        route53TtlAppropriateRule.id,
        node,
        'fail',
        `TTL is ${ttl}s (> ${ROUTE53_FAIL_TTL_SECONDS}s).`,
        { ttl },
        'Reduce Route53 TTL to 60 seconds or less to speed up failover.',
      );
    }
    if (ttl > ROUTE53_WARN_TTL_SECONDS) {
      return createResult(
        route53TtlAppropriateRule.id,
        node,
        'warn',
        `TTL is ${ttl}s (> ${ROUTE53_WARN_TTL_SECONDS}s).`,
        { ttl },
        'Reduce Route53 TTL to 60 seconds or less to improve RTO.',
      );
    }
    return createResult(
      route53TtlAppropriateRule.id,
      node,
      'pass',
      `TTL is ${ttl}s and suitable for failover.`,
      { ttl },
    );
  },
};

const backupPlanExistsRule: ValidationRule = {
  id: 'backup_plan_exists',
  name: 'AWS Backup Plan Coverage',
  description: 'Checks whether the resource is covered by an AWS Backup plan.',
  category: 'backup',
  severity: 'critical',
  appliesToTypes: ['rds', 'ec2', 'dynamodb', 'efs'],
  validate: (node, context) => {
    const backupPlanNode = findBackupPlanNode(node, context);
    return backupPlanNode
      ? createResult(
          backupPlanExistsRule.id,
          node,
          'pass',
          `Resource is protected by backup plan ${backupPlanNode.name}.`,
          { backupPlanId: backupPlanNode.id },
        )
      : createResult(
          backupPlanExistsRule.id,
          node,
          'fail',
          'No AWS Backup plan covers this resource.',
          { backupPlanId: null },
          'Attach the resource to an AWS Backup plan.',
        );
  },
};

const backupRecentRule: ValidationRule = {
  id: 'backup_recent',
  name: 'Recent Backup',
  description: 'Checks whether the latest backup is recent enough for the expected RPO.',
  category: 'backup',
  severity: 'high',
  appliesToTypes: ['rds', 'ec2', 'dynamodb', 'efs', 's3'],
  validate: (node, context) => {
    const protectedResource = findProtectedResourceSummary(node, context);
    if (!protectedResource) {
      return createResult(backupRecentRule.id, node, 'skip', 'No AWS Backup coverage found for this resource.');
    }

    const lastBackupTime = readString(protectedResource.lastBackupTime);
    if (!lastBackupTime) {
      return createResult(
        backupRecentRule.id,
        node,
        'fail',
        'Protected resource has no recorded backup timestamp.',
        undefined,
        'Ensure AWS Backup completes successfully at least once per day.',
      );
    }

    const ageHours = calculateBackupAgeHours(lastBackupTime);
    if (ageHours === null) {
      return createResult(backupRecentRule.id, node, 'error', 'Unable to parse the latest backup timestamp.');
    }
    if (ageHours > BACKUP_FAIL_THRESHOLD_HOURS) {
      return createResult(
        backupRecentRule.id,
        node,
        'fail',
        `Latest backup is ${Math.round(ageHours)} hour(s) old.`,
        { lastBackupTime, ageHours },
        'Investigate failed or missing backup jobs to restore the intended RPO.',
      );
    }
    if (ageHours > BACKUP_WARN_THRESHOLD_HOURS) {
      return createResult(
        backupRecentRule.id,
        node,
        'warn',
        `Latest backup is ${Math.round(ageHours)} hour(s) old.`,
        { lastBackupTime, ageHours },
        'Tighten backup scheduling so the effective RPO stays below 13 hours.',
      );
    }
    return createResult(
      backupRecentRule.id,
      node,
      'pass',
      `Latest backup is ${Math.round(ageHours)} hour(s) old.`,
      { lastBackupTime, ageHours },
    );
  },
};

const backupLifecycleConfiguredRule: ValidationRule = {
  id: 'backup_lifecycle_configured',
  name: 'Backup Lifecycle',
  description: 'Checks whether backup recovery points define a retention lifecycle.',
  category: 'backup',
  severity: 'medium',
  appliesToTypes: ['backup-plan'],
  validate: (node) => {
    const recoveryPoints = readObjectArray(getMetadata(node).recoveryPoints);
    if (recoveryPoints.length === 0) {
      return createResult(backupLifecycleConfiguredRule.id, node, 'skip', 'No recovery points are available for this backup plan yet.');
    }

    const missingLifecycle = recoveryPoints.filter(
      (recoveryPoint) => !hasLifecycleConfigured(readObject(recoveryPoint.lifecycle)),
    );
    return missingLifecycle.length === 0
      ? createResult(
          backupLifecycleConfiguredRule.id,
          node,
          'pass',
          'All recovery points define a backup lifecycle.',
          { recoveryPointCount: recoveryPoints.length },
        )
      : createResult(
          backupLifecycleConfiguredRule.id,
          node,
          'fail',
          `${missingLifecycle.length} recovery point(s) have no lifecycle configuration.`,
          { recoveryPointCount: recoveryPoints.length, missingLifecycle: missingLifecycle.length },
          'Configure lifecycle retention or cold-storage rules for recovery points.',
        );
  },
};

const cloudwatchAlarmExistsRule: ValidationRule = {
  id: 'cloudwatch_alarm_exists',
  name: 'CloudWatch Alarm Coverage',
  description: 'Checks whether at least one CloudWatch alarm monitors the resource.',
  category: 'detection',
  severity: 'high',
  appliesToTypes: ['rds', 'ec2', 'elb', 'lambda'],
  validate: (node, context) => {
    const alarms = findNodesByEdge(node.id, context, 'incoming', 'MONITORS').filter((candidate) =>
      hasNodeKind(candidate, ['cloudwatch-alarm']),
    );
    const alarmIds = alarms.map((alarm) => alarm.id);
    return alarms.length > 0
      ? createResult(
          cloudwatchAlarmExistsRule.id,
          node,
          'pass',
          `${alarms.length} CloudWatch alarm(s) monitor this resource.`,
          { alarmCount: alarms.length, alarmIds },
        )
      : createResult(
          cloudwatchAlarmExistsRule.id,
          node,
          'fail',
          'No CloudWatch alarm targets this resource.',
          { alarmCount: 0, alarmIds },
          'Create at least one CloudWatch alarm to reduce detection time during incidents.',
        );
  },
};

const cloudwatchAlarmActionsRule: ValidationRule = {
  id: 'cloudwatch_alarm_actions',
  name: 'CloudWatch Alarm Actions',
  description: 'Checks whether CloudWatch alarms can notify downstream responders.',
  category: 'detection',
  severity: 'high',
  appliesToTypes: ['cloudwatch-alarm'],
  observedKeys: ['actionsEnabled', 'alarmActions'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const actionsEnabled = readBoolean(metadata.actionsEnabled);
    const alarmActions = readStringArray(metadata.alarmActions);
    return actionsEnabled === true && alarmActions.length > 0
      ? createResult(
          cloudwatchAlarmActionsRule.id,
          node,
          'pass',
          `${alarmActions.length} alarm action(s) are configured.`,
        )
      : createResult(
          cloudwatchAlarmActionsRule.id,
          node,
          'fail',
          'Alarm actions are disabled or no notification target is configured.',
          { actionsEnabled, alarmActions },
          'Enable CloudWatch alarm actions and attach at least one notification target.',
        );
  },
};

const lambdaDlqConfiguredRule: ValidationRule = {
  id: 'lambda_dlq_configured',
  name: 'Lambda Dead-Letter Queue',
  description: 'Checks whether failed Lambda invocations can be recovered from a DLQ.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['lambda'],
  observedKeys: ['deadLetterConfig.targetArn', 'deadLetterTargetArn'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const deadLetterConfig = readObject(metadata.deadLetterConfig);
    const targetArn =
      readString(deadLetterConfig?.targetArn) ?? readString(metadata.deadLetterTargetArn);
    return targetArn
      ? createResult(lambdaDlqConfiguredRule.id, node, 'pass', 'Lambda dead-letter target is configured.')
      : createResult(
          lambdaDlqConfiguredRule.id,
          node,
          'fail',
          'Lambda has no dead-letter queue target.',
          undefined,
          'Configure a dead-letter queue or destination for failed Lambda invocations.',
        );
  },
};

const elbCrossZoneRule: ValidationRule = {
  id: 'elb_cross_zone',
  name: 'ELB Cross-Zone Balancing',
  description: 'Checks whether the load balancer uses cross-zone load balancing.',
  category: 'redundancy',
  severity: 'high',
  appliesToTypes: ['elb'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const enabled =
      readBoolean(metadata.crossZoneLoadBalancing) ??
      readBoolean(metadata.loadBalancingCrossZoneEnabled);
    return enabled === true
      ? createResult(elbCrossZoneRule.id, node, 'pass', 'Cross-zone load balancing is enabled.')
      : createResult(
          elbCrossZoneRule.id,
          node,
          'fail',
          'Cross-zone load balancing is disabled.',
          { crossZoneLoadBalancing: enabled },
          'Enable cross-zone load balancing to preserve capacity during AZ loss.',
        );
  },
};

const elbHealthCheckRule: ValidationRule = {
  id: 'elb_health_check',
  name: 'ELB Health Check',
  description: 'Checks whether the load balancer has a configured health check.',
  category: 'detection',
  severity: 'high',
  appliesToTypes: ['elb'],
  observedKeys: ['healthCheck.healthyThreshold', 'healthCheck.interval'],
  validate: (node) => {
    const healthCheck = readObject(getMetadata(node).healthCheck);
    const healthyThreshold = readNumber(healthCheck?.healthyThreshold);
    const interval = readNumber(healthCheck?.interval);
    return healthyThreshold !== null && interval !== null
      ? createResult(elbHealthCheckRule.id, node, 'pass', 'Load balancer health check is configured.')
      : createResult(
          elbHealthCheckRule.id,
          node,
          'fail',
          'Load balancer health check is incomplete or missing.',
          { healthCheck },
          'Configure a target group health check with interval and threshold values.',
        );
  },
};

const elbMultiAzRule: ValidationRule = {
  id: 'elb_multi_az',
  name: 'ELB Multi-AZ',
  description: 'Checks whether the load balancer spans at least two availability zones.',
  category: 'redundancy',
  severity: 'critical',
  appliesToTypes: ['elb'],
  observedKeys: ['availabilityZones'],
  validate: (node) => {
    const availabilityZones = readStringArray(getMetadata(node).availabilityZones);
    return availabilityZones.length >= REQUIRED_MULTI_AZ_COUNT
      ? createResult(
          elbMultiAzRule.id,
          node,
          'pass',
          `Load balancer spans ${availabilityZones.length} availability zones.`,
          { availabilityZones },
        )
      : createResult(
          elbMultiAzRule.id,
          node,
          'fail',
          'Load balancer is not deployed across multiple availability zones.',
          { availabilityZones },
          'Attach the load balancer to subnets in at least two availability zones.',
        );
  },
};

const sqsDlqConfiguredRule: ValidationRule = {
  id: 'sqs_dlq_configured',
  name: 'SQS Dead-Letter Queue',
  description: 'Checks whether failed SQS messages can be recovered from a DLQ.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['sqs'],
  validate: (node) =>
    hasDeadLetterQueue(getMetadata(node))
      ? createResult(sqsDlqConfiguredRule.id, node, 'pass', 'Queue dead-letter policy is configured.')
      : createResult(
          sqsDlqConfiguredRule.id,
          node,
          'fail',
          'Queue has no dead-letter policy.',
          undefined,
          'Configure an SQS redrive policy with a dead-letter queue.',
        ),
};

const eksMultiAzRule: ValidationRule = {
  id: 'eks_multi_az',
  name: 'EKS Multi-AZ',
  description: 'Checks whether EKS control plane networking spans multiple availability zones.',
  category: 'redundancy',
  severity: 'critical',
  appliesToTypes: ['eks'],
  validate: (node, context) => {
    const subnetIds = readStringArray(getMetadata(node).subnetIds);
    const subnetNodes = subnetIds
      .map((subnetId) =>
        context.allNodes.find(
          (candidate) => candidate.id !== node.id && hasNodeKind(candidate, ['subnet']) && collectNodeReferences(candidate).has(normalizeReference(subnetId)),
        ),
      )
      .filter((candidate): candidate is InfraNode => Boolean(candidate));
    const availabilityZones = Array.from(
      new Set(
        subnetNodes
          .map((subnetNode) => getAvailabilityZone(subnetNode))
          .filter((zone): zone is string => zone !== null),
      ),
    );

    if (availabilityZones.length >= REQUIRED_MULTI_AZ_COUNT) {
      return createResult(
        eksMultiAzRule.id,
        node,
        'pass',
        `EKS cluster spans ${availabilityZones.length} availability zones.`,
        { subnetIds, availabilityZones },
      );
    }
    if (subnetNodes.length === 0 && subnetIds.length >= REQUIRED_MULTI_AZ_COUNT) {
      return createResult(
        eksMultiAzRule.id,
        node,
        'pass',
        'EKS cluster declares multiple subnets; AZ inference was not available.',
        { subnetIds, inferredFromSubnetCount: true },
      );
    }
    return createResult(
      eksMultiAzRule.id,
      node,
      'fail',
      'EKS cluster does not span multiple availability zones.',
      { subnetIds, availabilityZones },
      'Attach the cluster to subnets in at least two distinct availability zones.',
    );
  },
};

const vpcMultiAzSubnetsRule: ValidationRule = {
  id: 'vpc_multi_az_subnets',
  name: 'VPC Multi-AZ Subnets',
  description: 'Checks whether the VPC contains subnets across multiple availability zones.',
  category: 'redundancy',
  severity: 'high',
  appliesToTypes: ['vpc'],
  validate: (node, context) => {
    const subnetNodes = [
      ...findNodesByEdge(node.id, context, 'outgoing', 'CONTAINS'),
      ...context.allNodes.filter(
        (candidate) =>
          hasNodeKind(candidate, ['subnet']) && readString(getMetadata(candidate).vpcId) === node.id,
      ),
    ].filter((candidate, index, items) => items.findIndex((item) => item.id === candidate.id) === index);
    const availabilityZones = Array.from(
      new Set(
        subnetNodes
          .map((subnetNode) => getAvailabilityZone(subnetNode))
          .filter((zone): zone is string => zone !== null),
      ),
    );

    return availabilityZones.length >= REQUIRED_MULTI_AZ_COUNT
      ? createResult(
          vpcMultiAzSubnetsRule.id,
          node,
          'pass',
          `VPC subnets span ${availabilityZones.length} availability zones.`,
          { availabilityZones },
        )
      : createResult(
          vpcMultiAzSubnetsRule.id,
          node,
          'fail',
          'VPC subnets do not span multiple availability zones.',
          { availabilityZones },
          'Create subnets in at least two availability zones for zonal failover.',
        );
  },
};

const vpcNatRedundancyRule: ValidationRule = {
  id: 'vpc_nat_redundancy',
  name: 'VPC NAT Redundancy',
  description: 'Checks whether private egress relies on multiple NAT gateways.',
  category: 'redundancy',
  severity: 'medium',
  appliesToTypes: ['vpc'],
  validate: (node, context) => {
    const natGateways = [
      ...findNodesByEdge(node.id, context, 'outgoing', 'CONTAINS'),
      ...context.allNodes.filter(
        (candidate) =>
          hasNodeKind(candidate, ['nat-gateway']) &&
          readString(getMetadata(candidate).vpcId) === node.id,
      ),
    ].filter((candidate, index, items) => items.findIndex((item) => item.id === candidate.id) === index);
    const natGatewayCount = natGateways.filter((candidate) =>
      hasNodeKind(candidate, ['nat-gateway']),
    ).length;

    if (natGatewayCount >= REQUIRED_MULTI_AZ_COUNT) {
      return createResult(
          vpcNatRedundancyRule.id,
          node,
          'pass',
          `${natGatewayCount} NAT gateways provide redundant private egress.`,
        );
    }
    if (natGatewayCount === 1) {
      return createResult(
        vpcNatRedundancyRule.id,
        node,
        'warn',
        'Only one NAT gateway was found for the VPC.',
        { natGatewayCount },
        'Deploy a NAT gateway per AZ used by private workloads.',
      );
    }
    return createResult(
      vpcNatRedundancyRule.id,
      node,
      'fail',
      'No NAT gateway redundancy was found for the VPC.',
      { natGatewayCount },
      'Add redundant NAT gateways so private workloads retain outbound access during an AZ outage.',
    );
  },
};

const dynamodbGlobalTableRule: ValidationRule = {
  id: 'dynamodb_global_table',
  name: 'DynamoDB Global Table',
  description: 'Checks whether DynamoDB has global table replication configured.',
  category: 'replication',
  severity: 'low',
  appliesToTypes: ['dynamodb'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const replicas = readObjectArray(metadata.replicas);
    const globalTableVersion = readString(metadata.globalTableVersion);
    const enabled =
      globalTableVersion !== null ||
      replicas.length > 0 ||
      readBoolean(metadata.globalTable) === true;
    return enabled
      ? createResult(dynamodbGlobalTableRule.id, node, 'pass', 'Global table replication is configured.')
      : createResult(
          dynamodbGlobalTableRule.id,
          node,
          'fail',
          'Global table replication is not configured.',
          undefined,
          'Add DynamoDB replicas in another region to enable cross-region failover.',
        );
  },
};

export const allValidationRules: readonly ValidationRule[] = [
  rdsReplicaHealthyRule,
  rdsMultiAzActiveRule,
  rdsBackupConfiguredRule,
  auroraMultiAzRule,
  auroraReplicaExistsRule,
  auroraBackupConfiguredRule,
  auroraBackupRetentionAdequateRule,
  auroraDeletionProtectionRule,
  auroraGlobalDatabaseRule,
  auroraPromotionTierRule,
  s3VersioningEnabledRule,
  s3ReplicationActiveRule,
  ec2InAsgRule,
  ec2MultiAzRule,
  elasticacheFailoverRule,
  dynamodbPitrEnabledRule,
  backupRetentionAdequateRule,
  crossRegionExistsRule,
  route53HealthCheckRule,
  route53FailoverConfiguredRule,
  route53TtlAppropriateRule,
  backupPlanExistsRule,
  backupRecentRule,
  efsBackupEnabledRule,
  efsReplicationConfiguredRule,
  efsMultiAzRule,
  efsMountTargetMultiAzRule,
  backupLifecycleConfiguredRule,
  cloudwatchAlarmExistsRule,
  cloudwatchAlarmActionsRule,
  lambdaDlqConfiguredRule,
  elbCrossZoneRule,
  elbHealthCheckRule,
  elbMultiAzRule,
  sqsDlqConfiguredRule,
  ...ecsValidationRules,
  eksMultiAzRule,
  vpcMultiAzSubnetsRule,
  vpcNatRedundancyRule,
  dynamodbGlobalTableRule,
];

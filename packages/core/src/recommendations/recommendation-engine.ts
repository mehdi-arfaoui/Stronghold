import { readString } from '../graph/analysis-helpers.js';
import type { ExecutionRisk } from '../drp/runbook/runbook-types.js';
import type {
  Recommendation,
  RecommendationGenerationInput,
} from './recommendation-types.js';
import { classifyRecommendationRisk } from './risk-classifier.js';
import type {
  InfraNode,
  ValidationSeverity,
  WeightedValidationResult,
} from '../validation/validation-types.js';

interface RecommendationDraft {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly strategyRef: {
    readonly nodeType: string;
    readonly strategy: string;
  };
  readonly remediation: Recommendation['remediation'];
}

interface BuilderContext {
  readonly node: InfraNode;
  readonly result: WeightedValidationResult;
  readonly redact: boolean;
  readonly isDemo: boolean;
}

const SEVERITY_RANK: Readonly<Record<ValidationSeverity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const RISK_RANK: Readonly<Record<ExecutionRisk, number>> = {
  safe: 1,
  caution: 2,
  dangerous: 3,
};

const ACTIONABLE_STATUSES = new Set(['fail', 'warn']);

export function generateRecommendations(
  input: RecommendationGenerationInput,
): readonly Recommendation[] {
  const actionableFindings = input.validationReport.results.filter((result) =>
    ACTIONABLE_STATUSES.has(result.status),
  );
  if (actionableFindings.length === 0) {
    return [];
  }

  const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const));
  const denominator = calculateScoreDenominator(input.validationReport.results);
  const recommendations = new Map<string, Recommendation>();

  for (const result of actionableFindings) {
    const node = nodeById.get(result.nodeId);
    if (!node) {
      continue;
    }

    const draft = buildRecommendation({
      node,
      result,
      redact: input.redact ?? false,
      isDemo: input.isDemo ?? false,
    });
    if (!draft) {
      continue;
    }

    const risk = classifyRecommendationRisk(
      draft.strategyRef.nodeType,
      draft.strategyRef.strategy,
    );
    const scoreDelta = estimateScoreDelta(result, denominator);
    const existing = recommendations.get(draft.id);

    if (existing) {
      recommendations.set(draft.id, mergeRecommendations(existing, result.ruleId, scoreDelta));
      continue;
    }

    recommendations.set(draft.id, {
      id: draft.id,
      title: draft.title,
      description: draft.description,
      category: result.category,
      severity: result.severity,
      targetNode: input.redact ? `<${defaultPlaceholderForNode(node)}>` : result.nodeId,
      targetNodeName: input.redact
        ? `<${defaultPlaceholderForNode(node)}>`
        : result.nodeName,
      impact: {
        scoreDelta,
        affectedRules: [result.ruleId],
      },
      risk: risk.risk,
      riskReason: risk.riskReason,
      remediation: draft.remediation,
    });
  }

  return Array.from(recommendations.values()).sort(compareRecommendations);
}

export function selectTopRecommendations(
  recommendations: readonly Recommendation[],
  limit = 3,
): readonly Recommendation[] {
  return recommendations.filter((item) => item.risk !== 'dangerous').slice(0, limit);
}

function mergeRecommendations(
  recommendation: Recommendation,
  ruleId: string,
  scoreDelta: number,
): Recommendation {
  const affectedRules = recommendation.impact.affectedRules.includes(ruleId)
    ? recommendation.impact.affectedRules
    : [...recommendation.impact.affectedRules, ruleId];

  return {
    ...recommendation,
    impact: {
      scoreDelta: recommendation.impact.scoreDelta + scoreDelta,
      affectedRules,
    },
  };
}

function compareRecommendations(left: Recommendation, right: Recommendation): number {
  return (
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    right.impact.scoreDelta - left.impact.scoreDelta ||
    RISK_RANK[left.risk] - RISK_RANK[right.risk] ||
    left.title.localeCompare(right.title)
  );
}

function calculateScoreDenominator(
  results: readonly WeightedValidationResult[],
): number {
  return results
    .filter(
      (result) =>
        result.status === 'pass' || result.status === 'fail' || result.status === 'warn',
    )
    .reduce((sum, result) => sum + result.weight, 0);
}

function estimateScoreDelta(
  result: WeightedValidationResult,
  denominator: number,
): number {
  if (denominator === 0) {
    return 0;
  }

  const recoveryFactor = result.status === 'warn' ? 0.5 : 1;
  return Math.max(1, Math.round((result.weight * recoveryFactor * 100) / denominator));
}

function buildRecommendation(context: BuilderContext): RecommendationDraft | null {
  switch (context.result.ruleId) {
    case 'rds_replica_healthy':
      return buildRdsReplicaRecommendation(context.node, context.redact);
    case 'rds_multi_az_active':
      return buildRdsMultiAzRecommendation(context.node, context.redact);
    case 'rds_backup_configured':
    case 'backup_retention_adequate':
      return buildRdsRetentionRecommendation(context.node, context.redact, 7);
    case 'aurora_multi_az':
    case 'aurora_replica_exists':
      return buildAuroraReplicaRecommendation(context.node, context.redact);
    case 'aurora_backup_configured':
    case 'aurora_backup_retention_adequate':
      return buildAuroraBackupRecommendation(context.node, context.redact, 7);
    case 'aurora_deletion_protection':
      return buildAuroraDeletionProtectionRecommendation(context.node, context.redact);
    case 'aurora_global_database':
      return buildAuroraGlobalDatabaseRecommendation(context.node, context.redact, context.isDemo);
    case 'aurora_promotion_tier':
      return buildAuroraPromotionTierRecommendation(context.node, context.redact);
    case 'efs_backup_enabled':
      return buildEfsBackupRecommendation(context.node, context.redact);
    case 'efs_replication_configured':
      return buildEfsReplicationRecommendation(context.node, context.redact);
    case 'efs_multi_az':
    case 'efs_mount_target_multi_az':
      return buildEfsMountTargetRecommendation(context.node, context.redact);
    case 's3_versioning_enabled':
      return buildS3VersioningRecommendation(context.node, context.redact);
    case 's3_replication_active':
      return buildS3ReplicationRecommendation(context.node, context.redact);
    case 'cross_region_exists':
      return isS3Node(context.node)
        ? buildS3ReplicationRecommendation(context.node, context.redact)
        : buildRdsCrossRegionReplicaRecommendation(context.node, context.redact);
    case 'ec2_in_asg':
      return buildEc2AutoScalingRecommendation(context.node, context.redact);
    case 'ec2_multi_az':
      return buildEc2MultiAzRecommendation(context.node, context.redact);
    case 'elasticache_failover':
      return buildElastiCacheRecommendation(context.node, context.redact);
    case 'dynamodb_pitr_enabled':
      return buildDynamoPitrRecommendation(context.node, context.redact);
    case 'route53_health_check':
      return buildRoute53HealthCheckRecommendation(context.node, context.redact);
    case 'route53_failover_configured':
      return buildRoute53FailoverRecommendation(context.node, context.redact);
    case 'route53_ttl_appropriate':
      return buildRoute53TtlRecommendation(context.node, context.redact);
    case 'backup_plan_exists':
      return buildBackupPlanRecommendation(context.node, context.redact, context.isDemo);
    case 'backup_recent':
      return buildRecentBackupRecommendation(context.node, context.redact, context.isDemo);
    case 'backup_lifecycle_configured':
      return buildBackupLifecycleRecommendation(context.node);
    case 'cloudwatch_alarm_exists':
      return buildCloudWatchAlarmRecommendation(context.node, context.redact, context.isDemo);
    case 'cloudwatch_alarm_actions':
      return buildCloudWatchAlarmActionsRecommendation(context.node, context.redact);
    case 'lambda_dlq_configured':
      return buildLambdaDlqRecommendation(context.node, context.redact);
    case 'elb_cross_zone':
      return buildElbCrossZoneRecommendation(context.node, context.redact, context.isDemo);
    case 'elb_health_check':
      return buildElbHealthCheckRecommendation(context.node, context.redact, context.isDemo);
    case 'elb_multi_az':
      return buildElbMultiAzRecommendation(context.node, context.redact, context.isDemo);
    case 'sqs_dlq_configured':
      return buildSqsDlqRecommendation(context.node, context.redact);
    case 'eks_multi_az':
      return buildEksMultiAzRecommendation(context.node, context.redact);
    case 'vpc_multi_az_subnets':
      return buildVpcSubnetRecommendation(context.node, context.redact);
    case 'vpc_nat_redundancy':
      return buildVpcNatRecommendation(context.node, context.redact);
    case 'dynamodb_global_table':
      return buildDynamoGlobalTableRecommendation(context.node, context.redact);
    default:
      return null;
  }
}

function buildRdsReplicaRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const dbId = resolveRdsIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  return {
    id: `rds-read-replica:${node.id}`,
    title: `Add a read replica for RDS "${resolveDisplayName(node, redact, 'your-rds-instance')}"`,
    description: 'A healthy read replica improves failover options and reduces single-instance risk.',
    strategyRef: {
      nodeType: 'rds-instance',
      strategy: 'hot_standby',
    },
    remediation: {
      command:
        `aws rds create-db-instance-read-replica --db-instance-identifier ${appendSuffix(dbId, redact, '-replica', '<your-rds-replica>')} ` +
        `--source-db-instance-identifier ${dbId} --region ${region}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '10-20 minutes',
      prerequisites: ['Review replica sizing and the added replica cost before creating it.'],
    },
  };
}

function buildRdsMultiAzRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const dbId = resolveRdsIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  return {
    id: `rds-multi-az:${node.id}`,
    title: `Enable Multi-AZ for RDS "${resolveDisplayName(node, redact, 'your-rds-instance')}"`,
    description: 'Multi-AZ keeps a standby ready for zonal failure and improves recovery confidence.',
    strategyRef: {
      nodeType: 'rds-instance',
      strategy: 'hot_standby',
    },
    remediation: {
      command:
        `aws rds modify-db-instance --db-instance-identifier ${dbId} ` +
        `--multi-az --apply-immediately --region ${region}`,
      requiresDowntime: true,
      requiresMaintenanceWindow: true,
      estimatedDuration: '5-15 minutes',
      prerequisites: ['Plan for a brief failover while RDS enables the standby path.'],
    },
  };
}

function buildRdsRetentionRecommendation(
  node: InfraNode,
  redact: boolean,
  retentionDays: number,
): RecommendationDraft {
  const dbId = resolveRdsIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  return {
    id: `rds-backup-retention:${node.id}`,
    title: `Increase backup retention for RDS "${resolveDisplayName(node, redact, 'your-rds-instance')}"`,
    description: 'Longer retention keeps a valid restore point available when the latest instance state is unusable.',
    strategyRef: {
      nodeType: 'rds-instance',
      strategy: 'backup_restore',
    },
    remediation: {
      command:
        `aws rds modify-db-instance --db-instance-identifier ${dbId} ` +
        `--backup-retention-period ${retentionDays} --apply-immediately --region ${region}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: [`Set retention to at least ${retentionDays} days for this instance.`],
    },
  };
}

function buildAuroraReplicaRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const clusterId = resolveAuroraClusterIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  return {
    id: `aurora-replica:${node.id}`,
    title: `Add an Aurora reader for "${resolveDisplayName(node, redact, 'your-aurora-cluster')}"`,
    description: 'A reader in another AZ gives Aurora a healthier failover path when the writer is lost.',
    strategyRef: {
      nodeType: 'aurora-cluster',
      strategy: 'aurora_failover',
    },
    remediation: {
      command:
        `aws rds create-db-instance --db-instance-identifier ${appendSuffix(clusterId, redact, '-reader', '<your-aurora-reader>')} ` +
        `--db-cluster-identifier ${clusterId} --engine aurora-postgresql ` +
        '--db-instance-class <instance-class> --availability-zone <secondary-az> ' +
        `--region ${region}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '10-20 minutes',
      prerequisites: ['Choose an instance class and an alternate availability zone for the new reader.'],
    },
  };
}

function buildAuroraBackupRecommendation(
  node: InfraNode,
  redact: boolean,
  retentionDays: number,
): RecommendationDraft {
  const clusterId = resolveAuroraClusterIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  return {
    id: `aurora-backup-retention:${node.id}`,
    title: `Increase backup retention for Aurora "${resolveDisplayName(node, redact, 'your-aurora-cluster')}"`,
    description: 'Aurora backup retention keeps an earlier restore point available during data-loss events.',
    strategyRef: {
      nodeType: 'aurora-cluster',
      strategy: 'aurora_failover',
    },
    remediation: {
      command:
        `aws rds modify-db-cluster --db-cluster-identifier ${clusterId} ` +
        `--backup-retention-period ${retentionDays} --apply-immediately --region ${region}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: [`Set retention to at least ${retentionDays} days for this cluster.`],
    },
  };
}

function buildAuroraDeletionProtectionRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const clusterId = resolveAuroraClusterIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  return {
    id: `aurora-deletion-protection:${node.id}`,
    title: `Enable deletion protection on Aurora "${resolveDisplayName(node, redact, 'your-aurora-cluster')}"`,
    description: 'Deletion protection reduces accidental loss during operational mistakes or rushed incident response.',
    strategyRef: {
      nodeType: 'aurora-cluster',
      strategy: 'aurora_failover',
    },
    remediation: {
      command:
        `aws rds modify-db-cluster --db-cluster-identifier ${clusterId} ` +
        `--deletion-protection --apply-immediately --region ${region}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: ['Confirm the cluster is managed through an approved change path.'],
    },
  };
}

function buildAuroraGlobalDatabaseRecommendation(
  node: InfraNode,
  redact: boolean,
  isDemo: boolean,
): RecommendationDraft {
  const clusterId = resolveAuroraClusterIdentifier(node, redact);
  const sourceArn = redact || isDemo
    ? '<your-aurora-cluster-arn>'
    : resolveArn(node, '<your-aurora-cluster-arn>');
  return {
    id: `aurora-global-database:${node.id}`,
    title: `Add a global database path for Aurora "${resolveDisplayName(node, redact, 'your-aurora-cluster')}"`,
    description: 'A secondary-region Aurora topology improves regional failover options for critical databases.',
    strategyRef: {
      nodeType: 'aurora-cluster',
      strategy: 'aurora_global_failover',
    },
    remediation: {
      command:
        `aws rds create-global-cluster --global-cluster-identifier ${appendSuffix(clusterId, redact, '-global', '<your-global-cluster>')} ` +
        `--source-db-cluster-identifier ${sourceArn}`,
      requiresDowntime: true,
      requiresMaintenanceWindow: true,
      estimatedDuration: '30-90 minutes',
      prerequisites: ['Review migration sequencing, cross-region replication lag, and application cutover requirements.'],
    },
  };
}

function buildAuroraPromotionTierRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const clusterId = resolveAuroraClusterIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  return {
    id: `aurora-promotion-tier:${node.id}`,
    title: `Set a top promotion tier for Aurora "${resolveDisplayName(node, redact, 'your-aurora-cluster')}"`,
    description: 'A preferred replica makes Aurora failover more predictable when the writer is lost.',
    strategyRef: {
      nodeType: 'aurora-cluster',
      strategy: 'aurora_failover',
    },
    remediation: {
      command:
        `aws rds modify-db-instance --db-instance-identifier <preferred-reader-instance> ` +
        `--promotion-tier 0 --apply-immediately --region ${region}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: [`Replace <preferred-reader-instance> with a reader attached to ${clusterId}.`],
    },
  };
}

function buildEfsBackupRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const fileSystemId = resolveEfsIdentifier(node, redact);
  return {
    id: `efs-backup:${node.id}`,
    title: `Enable backups for EFS "${resolveDisplayName(node, redact, 'your-efs-file-system')}"`,
    description: 'Automatic backups preserve a restore point when the primary file system is damaged or deleted.',
    strategyRef: {
      nodeType: 'efs-filesystem',
      strategy: '*',
    },
    remediation: {
      command:
        `aws efs put-backup-policy --file-system-id ${fileSystemId} ` +
        '--backup-policy Status=ENABLED',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: ['Confirm the backup retention policy you want EFS to use.'],
    },
  };
}

function buildEfsReplicationRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const fileSystemId = resolveEfsIdentifier(node, redact);
  const secondaryRegion = resolveSecondaryRegion(node, redact);
  return {
    id: `efs-replication:${node.id}`,
    title: `Enable EFS replication for "${resolveDisplayName(node, redact, 'your-efs-file-system')}"`,
    description: 'A replicated file system preserves a second recovery path in another region.',
    strategyRef: {
      nodeType: 'efs-filesystem',
      strategy: '*',
    },
    remediation: {
      command:
        `aws efs create-replication-configuration --source-file-system-id ${fileSystemId} ` +
        `--destinations Region=${secondaryRegion}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '10-20 minutes',
      prerequisites: ['Choose the secondary region and validate application access paths there.'],
    },
  };
}

function buildEfsMountTargetRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const fileSystemId = resolveEfsIdentifier(node, redact);
  return {
    id: `efs-mount-target:${node.id}`,
    title: `Add another EFS mount target for "${resolveDisplayName(node, redact, 'your-efs-file-system')}"`,
    description: 'Mount targets in multiple AZs keep clients closer to a healthy file-system endpoint during zonal loss.',
    strategyRef: {
      nodeType: 'efs-filesystem',
      strategy: '*',
    },
    remediation: {
      command:
        `aws efs create-mount-target --file-system-id ${fileSystemId} ` +
        '--subnet-id <subnet-in-secondary-az> --security-groups <security-group-id>',
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '5-10 minutes',
      prerequisites: ['Select a subnet and security group in another availability zone first.'],
    },
  };
}

function buildS3VersioningRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const bucketName = resolveS3BucketName(node, redact);
  return {
    id: `s3-versioning:${node.id}`,
    title: `Enable S3 versioning on "${resolveDisplayName(node, redact, 'your-bucket')}"`,
    description: 'Versioning preserves prior object versions so accidental overwrite or deletion stays recoverable.',
    strategyRef: {
      nodeType: 's3-bucket',
      strategy: '*',
    },
    remediation: {
      command:
        `aws s3api put-bucket-versioning --bucket ${bucketName} ` +
        '--versioning-configuration Status=Enabled',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: ['Review lifecycle rules if version growth needs to be controlled.'],
    },
  };
}

function buildS3ReplicationRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const bucketName = resolveS3BucketName(node, redact);
  return {
    id: `s3-replication:${node.id}`,
    title: `Enable S3 replication for "${resolveDisplayName(node, redact, 'your-bucket')}"`,
    description: 'Cross-region replication keeps a secondary copy available when the primary region is impaired.',
    strategyRef: {
      nodeType: 's3-bucket',
      strategy: '*',
    },
    remediation: {
      command:
        `aws s3api put-bucket-replication --bucket ${bucketName} ` +
        `--replication-configuration '{"Role":"<replication-role-arn>","Rules":[{"ID":"stronghold-dr","Status":"Enabled","Priority":1,"DeleteMarkerReplication":{"Status":"Disabled"},"Filter":{"Prefix":""},"Destination":{"Bucket":"<secondary-bucket-arn>","StorageClass":"STANDARD"}}]}'`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '5-10 minutes',
      prerequisites: ['Enable versioning on both buckets and create the IAM replication role first.'],
    },
  };
}

function buildRdsCrossRegionReplicaRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const dbId = resolveRdsIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  const secondaryRegion = resolveSecondaryRegion(node, redact);
  return {
    id: `rds-cross-region:${node.id}`,
    title: `Add a secondary-region RDS replica for "${resolveDisplayName(node, redact, 'your-rds-instance')}"`,
    description: 'A replica in another region gives the service a regional recovery target instead of a single-region dependency.',
    strategyRef: {
      nodeType: 'rds-instance',
      strategy: 'hot_standby',
    },
    remediation: {
      command:
        `aws rds create-db-instance-read-replica --db-instance-identifier ${appendSuffix(dbId, redact, '-dr', '<your-dr-replica>')} ` +
        `--source-db-instance-identifier ${dbId} --source-region ${region} --region ${secondaryRegion}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '15-30 minutes',
      prerequisites: ['Confirm the target region, KMS settings, and added replica cost before creating it.'],
    },
  };
}

function buildEc2AutoScalingRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const instanceId = resolveEc2Identifier(node, redact);
  return {
    id: `ec2-autoscaling:${node.id}`,
    title: `Place EC2 "${resolveDisplayName(node, redact, 'your-ec2-instance')}" in an Auto Scaling group`,
    description: 'Auto Scaling gives Stronghold a repeatable way to replace lost capacity during an outage.',
    strategyRef: {
      nodeType: 'ec2-instance',
      strategy: '*',
    },
    remediation: {
      command:
        'aws autoscaling create-auto-scaling-group --auto-scaling-group-name <your-asg-name> ' +
        '--launch-template LaunchTemplateName=<launch-template>,Version=<version> ' +
        '--min-size 2 --max-size 4 --desired-capacity 2 --vpc-zone-identifier <subnet-a>,<subnet-b>',
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '10-20 minutes',
      prerequisites: [`Capture a launch template for ${instanceId} before migrating traffic into the group.`],
    },
  };
}

function buildEc2MultiAzRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const asgName = resolveAutoScalingGroupName(node, redact);
  return {
    id: `ec2-multi-az:${node.id}`,
    title: `Spread EC2 capacity for "${resolveDisplayName(node, redact, 'your-ec2-instance')}" across multiple AZs`,
    description: 'Multi-AZ capacity reduces the chance that a single-zone event removes all compute.',
    strategyRef: {
      nodeType: 'ec2-instance',
      strategy: '*',
    },
    remediation: {
      command:
        `aws autoscaling update-auto-scaling-group --auto-scaling-group-name ${asgName} ` +
        '--vpc-zone-identifier <subnet-in-az-a>,<subnet-in-az-b>',
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '5-15 minutes',
      prerequisites: ['Confirm the launch template, security groups, and routing work in the second subnet.'],
    },
  };
}

function buildElastiCacheRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const replicationGroupId = resolveElastiCacheIdentifier(node, redact);
  const region = resolveRegion(node, redact);
  return {
    id: `elasticache-failover:${node.id}`,
    title: `Enable ElastiCache failover for "${resolveDisplayName(node, redact, 'your-cache-cluster')}"`,
    description: 'Automatic failover preserves cache availability when the primary node is lost.',
    strategyRef: {
      nodeType: 'elasticache',
      strategy: '*',
    },
    remediation: {
      command:
        `aws elasticache modify-replication-group --replication-group-id ${replicationGroupId} ` +
        '--automatic-failover-enabled --multi-az-enabled --apply-immediately ' +
        `--region ${region}`,
      requiresDowntime: true,
      requiresMaintenanceWindow: true,
      estimatedDuration: '5-15 minutes',
      prerequisites: ['Confirm the replication group already has a replica target or add one first.'],
    },
  };
}

function buildDynamoPitrRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const tableName = resolveDynamoTableName(node, redact);
  return {
    id: `dynamodb-pitr:${node.id}`,
    title: `Enable DynamoDB PITR on "${resolveDisplayName(node, redact, 'your-dynamodb-table')}"`,
    description: 'Point-in-time recovery preserves recent restore points for accidental data loss and corruption.',
    strategyRef: {
      nodeType: 'dynamodb-table',
      strategy: '*',
    },
    remediation: {
      command:
        `aws dynamodb update-continuous-backups --table-name ${tableName} ` +
        '--point-in-time-recovery-specification PointInTimeRecoveryEnabled=true',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: ['Verify the retention and compliance expectations for this table.'],
    },
  };
}

function buildRoute53HealthCheckRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const recordName = resolveRoute53RecordName(node, redact);
  return {
    id: `route53-health-check:${node.id}`,
    title: `Add a Route53 health check for "${resolveDisplayName(node, redact, 'your-record')}"`,
    description: 'Health checks make DNS failover responsive when the primary target is unhealthy.',
    strategyRef: {
      nodeType: 'route53-record',
      strategy: '*',
    },
    remediation: {
      command:
        'aws route53 create-health-check --caller-reference <unique-reference> ' +
        `--health-check-config Type=HTTPS,FullyQualifiedDomainName=${recordName},ResourcePath=/,Port=443,RequestInterval=30,FailureThreshold=3`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '2-5 minutes',
      prerequisites: ['Attach the returned health-check ID to the primary and secondary record set after creation.'],
    },
  };
}

function buildRoute53FailoverRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const hostedZoneId = resolveRoute53HostedZoneId(node, redact);
  const recordName = resolveRoute53RecordName(node, redact);
  return {
    id: `route53-failover:${node.id}`,
    title: `Create a Route53 failover pair for "${resolveDisplayName(node, redact, 'your-record')}"`,
    description: 'Primary and secondary records let DNS switch traffic to a healthy backup target.',
    strategyRef: {
      nodeType: 'route53-record',
      strategy: '*',
    },
    remediation: {
      command:
        `aws route53 change-resource-record-sets --hosted-zone-id ${hostedZoneId} ` +
        `--change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"${recordName}","Type":"A","SetIdentifier":"primary","Failover":"PRIMARY","TTL":60,"ResourceRecords":[{"Value":"<primary-target>"}],"HealthCheckId":"<health-check-id>"}},{"Action":"UPSERT","ResourceRecordSet":{"Name":"${recordName}","Type":"A","SetIdentifier":"secondary","Failover":"SECONDARY","TTL":60,"ResourceRecords":[{"Value":"<secondary-target>"}]}}]}'`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '5-10 minutes',
      prerequisites: ['Prepare healthy primary and secondary targets and a Route53 health check first.'],
    },
  };
}

function buildRoute53TtlRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const hostedZoneId = resolveRoute53HostedZoneId(node, redact);
  const recordName = resolveRoute53RecordName(node, redact);
  return {
    id: `route53-ttl:${node.id}`,
    title: `Reduce TTL for Route53 record "${resolveDisplayName(node, redact, 'your-record')}"`,
    description: 'A shorter TTL helps clients honor failover changes faster during an incident.',
    strategyRef: {
      nodeType: 'route53-record',
      strategy: '*',
    },
    remediation: {
      command:
        `aws route53 change-resource-record-sets --hosted-zone-id ${hostedZoneId} ` +
        `--change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"${recordName}","Type":"A","TTL":60,"ResourceRecords":[{"Value":"<current-target>"}]}}]}'`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '2-5 minutes',
      prerequisites: ['Replace <current-target> with the current live record value when applying the change.'],
    },
  };
}

function buildBackupPlanRecommendation(
  node: InfraNode,
  redact: boolean,
  isDemo: boolean,
): RecommendationDraft {
  const resourceArn = redact || isDemo ? '<your-resource-arn>' : resolveArn(node, '<your-resource-arn>');
  return {
    id: `backup-plan:${node.id}`,
    title: `Attach "${resolveDisplayName(node, redact, 'your-resource')}" to AWS Backup`,
    description: 'A backup plan makes recovery repeatable and keeps restore points governed in one place.',
    strategyRef: {
      nodeType: isRdsNode(node) ? 'rds-instance' : 'recommendation-backup-plan',
      strategy: isRdsNode(node) ? 'backup_restore' : '*',
    },
    remediation: {
      command:
        'aws backup create-backup-selection --backup-plan-id <backup-plan-id> ' +
        `--backup-selection '{"SelectionName":"stronghold-dr","IamRoleArn":"<backup-role-arn>","Resources":["${resourceArn}"]}'`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '5-10 minutes',
      prerequisites: ['Create or choose an AWS Backup plan and IAM role before attaching the resource.'],
    },
  };
}

function buildRecentBackupRecommendation(
  node: InfraNode,
  redact: boolean,
  isDemo: boolean,
): RecommendationDraft {
  const resourceArn = redact || isDemo ? '<your-resource-arn>' : resolveArn(node, '<your-resource-arn>');
  return {
    id: `backup-run:${node.id}`,
    title: `Run a fresh backup for "${resolveDisplayName(node, redact, 'your-resource')}"`,
    description: 'A recent backup narrows the gap between the current state and the last recoverable copy.',
    strategyRef: {
      nodeType: isRdsNode(node) ? 'rds-instance' : 'recommendation-backup-plan',
      strategy: isRdsNode(node) ? 'backup_restore' : '*',
    },
    remediation: {
      command:
        'aws backup start-backup-job --backup-vault-name <backup-vault-name> ' +
        `--resource-arn ${resourceArn} --iam-role-arn <backup-role-arn>`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '2-10 minutes',
      prerequisites: ['Investigate why scheduled backups are stale before relying on a one-off job.'],
    },
  };
}

function buildBackupLifecycleRecommendation(node: InfraNode): RecommendationDraft {
  return {
    id: `backup-lifecycle:${node.id}`,
    title: `Add lifecycle retention to backup plan "${node.name}"`,
    description: 'Lifecycle rules keep recovery points retained long enough to meet DR objectives.',
    strategyRef: {
      nodeType: 'recommendation-backup-plan',
      strategy: '*',
    },
    remediation: {
      command:
        'aws backup update-recovery-point-lifecycle --backup-vault-name <backup-vault-name> ' +
        '--recovery-point-arn <recovery-point-arn> --lifecycle DeleteAfterDays=120',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '2-5 minutes',
      prerequisites: ['Choose lifecycle values that match the retention policy for this workload.'],
    },
  };
}

function buildCloudWatchAlarmRecommendation(
  node: InfraNode,
  redact: boolean,
  isDemo: boolean,
): RecommendationDraft {
  const namespace = resolveMetricNamespace(node);
  const metricName = resolveMetricName(node);
  const dimensions = resolveMetricDimensions(node, redact, isDemo);
  const alarmName = redact ? '<your-alarm-name>' : `${node.name.replace(/\s+/g, '-')}-dr-alarm`;
  return {
    id: `cloudwatch-alarm:${node.id}`,
    title: `Create a CloudWatch alarm for "${resolveDisplayName(node, redact, 'your-resource')}"`,
    description: 'An alarm shortens time-to-detect so recovery starts before the outage spreads.',
    strategyRef: {
      nodeType: 'recommendation-cloudwatch-alarm',
      strategy: '*',
    },
    remediation: {
      command:
        `aws cloudwatch put-metric-alarm --alarm-name ${alarmName} ` +
        `--namespace ${namespace} --metric-name ${metricName} --comparison-operator GreaterThanThreshold ` +
        '--threshold 1 --evaluation-periods 1 --period 60 --statistic Average ' +
        `--dimensions ${dimensions} --alarm-actions <sns-topic-arn>`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '2-5 minutes',
      prerequisites: ['Choose the SNS topic or incident target that should receive the alarm.'],
    },
  };
}

function buildCloudWatchAlarmActionsRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const alarmName = redact ? '<your-alarm-name>' : node.name;
  return {
    id: `cloudwatch-alarm-actions:${node.id}`,
    title: `Attach actions to CloudWatch alarm "${alarmName}"`,
    description: 'Alarm actions reduce detection time by notifying responders when a recovery signal trips.',
    strategyRef: {
      nodeType: 'recommendation-cloudwatch-alarm',
      strategy: '*',
    },
    remediation: {
      command:
        `aws cloudwatch put-metric-alarm --alarm-name ${alarmName} --namespace <metric-namespace> ` +
        '--metric-name <metric-name> --comparison-operator GreaterThanThreshold --threshold 1 ' +
        '--evaluation-periods 1 --period 60 --statistic Average --alarm-actions <sns-topic-arn>',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '2-5 minutes',
      prerequisites: ['Provide at least one SNS topic or incident target ARN for the alarm action.'],
    },
  };
}

function buildLambdaDlqRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const functionName = resolveLambdaIdentifier(node, redact);
  return {
    id: `lambda-dlq:${node.id}`,
    title: `Add a dead-letter target for Lambda "${resolveDisplayName(node, redact, 'your-lambda-function')}"`,
    description: 'A DLQ preserves failed events so operators can replay them after recovery.',
    strategyRef: {
      nodeType: 'lambda-function',
      strategy: '*',
    },
    remediation: {
      command:
        `aws lambda update-function-configuration --function-name ${functionName} ` +
        '--dead-letter-config TargetArn=<your-sqs-or-sns-arn>',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: ['Create the SQS queue or SNS topic that should receive failed events first.'],
    },
  };
}

function buildElbCrossZoneRecommendation(
  node: InfraNode,
  redact: boolean,
  isDemo: boolean,
): RecommendationDraft {
  const loadBalancerArn = resolveLoadBalancerArn(node, redact, isDemo);
  return {
    id: `elb-cross-zone:${node.id}`,
    title: `Enable cross-zone balancing for "${resolveDisplayName(node, redact, 'your-load-balancer')}"`,
    description: 'Cross-zone balancing helps preserve capacity when one AZ loses healthy targets.',
    strategyRef: {
      nodeType: 'recommendation-elb-setting',
      strategy: 'cross-zone',
    },
    remediation: {
      command:
        `aws elbv2 modify-load-balancer-attributes --load-balancer-arn ${loadBalancerArn} ` +
        '--attributes Key=load_balancing.cross_zone.enabled,Value=true',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: ['Confirm the load balancer is managed through an approved change path.'],
    },
  };
}

function buildElbHealthCheckRecommendation(
  node: InfraNode,
  redact: boolean,
  isDemo: boolean,
): RecommendationDraft {
  const targetGroupArn = redact || isDemo ? '<your-target-group-arn>' : resolveTargetGroupArn(node);
  return {
    id: `elb-health-check:${node.id}`,
    title: `Tune health checks for "${resolveDisplayName(node, redact, 'your-load-balancer')}"`,
    description: 'Reliable health checks shorten detection time and prevent routing traffic to unhealthy targets.',
    strategyRef: {
      nodeType: 'recommendation-elb-setting',
      strategy: 'health-check',
    },
    remediation: {
      command:
        `aws elbv2 modify-target-group --target-group-arn ${targetGroupArn} ` +
        '--health-check-path /health --health-check-interval-seconds 30 ' +
        '--healthy-threshold-count 2 --unhealthy-threshold-count 2',
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '2-5 minutes',
      prerequisites: ['Confirm the application exposes a dependable health-check endpoint first.'],
    },
  };
}

function buildElbMultiAzRecommendation(
  node: InfraNode,
  redact: boolean,
  isDemo: boolean,
): RecommendationDraft {
  const loadBalancerArn = resolveLoadBalancerArn(node, redact, isDemo);
  return {
    id: `elb-multi-az:${node.id}`,
    title: `Attach "${resolveDisplayName(node, redact, 'your-load-balancer')}" to subnets in another AZ`,
    description: 'A multi-AZ load balancer keeps traffic flowing when one availability zone is impaired.',
    strategyRef: {
      nodeType: 'recommendation-elb-setting',
      strategy: 'multi-az',
    },
    remediation: {
      command:
        `aws elbv2 set-subnets --load-balancer-arn ${loadBalancerArn} ` +
        '--subnets <subnet-in-az-a> <subnet-in-az-b>',
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '5-10 minutes',
      prerequisites: ['Confirm route tables, security groups, and target registration in the added subnet.'],
    },
  };
}

function buildSqsDlqRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const queueUrl = redact ? '<your-queue-url>' : resolveSqsQueueUrl(node);
  return {
    id: `sqs-dlq:${node.id}`,
    title: `Add a dead-letter queue for "${resolveDisplayName(node, redact, 'your-queue')}"`,
    description: 'A DLQ retains poisoned messages so recovery does not lose failed work items.',
    strategyRef: {
      nodeType: 'recommendation-sqs-queue',
      strategy: 'dlq',
    },
    remediation: {
      command:
        `aws sqs set-queue-attributes --queue-url ${queueUrl} ` +
        `--attributes RedrivePolicy='{"deadLetterTargetArn":"<your-dlq-arn>","maxReceiveCount":"5"}'`,
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: ['Create the DLQ and confirm the queue policy allows redrive to it.'],
    },
  };
}

function buildEksMultiAzRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const clusterName = resolveEksIdentifier(node, redact);
  return {
    id: `eks-multi-az:${node.id}`,
    title: `Expand EKS "${resolveDisplayName(node, redact, 'your-eks-cluster')}" across multiple AZs`,
    description: 'Control-plane and worker subnets in multiple zones reduce cluster-wide impact from a zonal event.',
    strategyRef: {
      nodeType: 'eks-cluster',
      strategy: '*',
    },
    remediation: {
      command:
        `aws eks update-cluster-config --name ${clusterName} ` +
        '--resources-vpc-config subnetIds=<subnet-in-az-a>,<subnet-in-az-b>',
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '10-20 minutes',
      prerequisites: ['Validate node groups, CNI configuration, and route tables in the added subnet.'],
    },
  };
}

function buildVpcSubnetRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const vpcId = resolveVpcIdentifier(node, redact);
  return {
    id: `vpc-multi-az:${node.id}`,
    title: `Create a second-AZ subnet for VPC "${resolveDisplayName(node, redact, 'your-vpc')}"`,
    description: 'Multiple availability zones are a prerequisite for zonal failover across the stack.',
    strategyRef: {
      nodeType: 'recommendation-vpc-topology',
      strategy: '*',
    },
    remediation: {
      command:
        `aws ec2 create-subnet --vpc-id ${vpcId} --cidr-block <secondary-cidr-block> ` +
        '--availability-zone <secondary-az>',
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '10-20 minutes',
      prerequisites: ['Review route tables, NAT, NACLs, and IP planning before changing VPC topology.'],
    },
  };
}

function buildVpcNatRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const subnetId = '<public-subnet-id>';
  const allocationId = '<elastic-ip-allocation-id>';
  return {
    id: `vpc-nat:${node.id}`,
    title: `Add NAT redundancy for VPC "${resolveDisplayName(node, redact, 'your-vpc')}"`,
    description: 'A NAT gateway per AZ preserves outbound connectivity when one zone fails.',
    strategyRef: {
      nodeType: 'recommendation-vpc-topology',
      strategy: '*',
    },
    remediation: {
      command:
        `aws ec2 create-nat-gateway --subnet-id ${subnetId} --allocation-id ${allocationId}`,
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '10-20 minutes',
      prerequisites: ['Update private route tables to use the NAT gateway in the same AZ after creation.'],
    },
  };
}

function buildDynamoGlobalTableRecommendation(
  node: InfraNode,
  redact: boolean,
): RecommendationDraft {
  const tableName = resolveDynamoTableName(node, redact);
  const secondaryRegion = resolveSecondaryRegion(node, redact);
  return {
    id: `dynamodb-global-table:${node.id}`,
    title: `Add a second region to DynamoDB table "${resolveDisplayName(node, redact, 'your-dynamodb-table')}"`,
    description: 'A global table keeps a regional failover target warm for critical data.',
    strategyRef: {
      nodeType: 'dynamodb-table',
      strategy: '*',
    },
    remediation: {
      command:
        `aws dynamodb update-table --table-name ${tableName} ` +
        `--replica-updates '[{"Create":{"RegionName":"${secondaryRegion}"}}]'`,
      requiresDowntime: false,
      requiresMaintenanceWindow: true,
      estimatedDuration: '10-20 minutes',
      prerequisites: ['Confirm write pattern, replication cost, and region-specific compliance requirements.'],
    },
  };
}

function resolveDisplayName(
  node: InfraNode,
  redact: boolean,
  placeholder: string,
): string {
  return redact ? `<${placeholder}>` : node.name;
}

function defaultPlaceholderForNode(node: InfraNode): string {
  if (isRdsNode(node)) {
    return 'your-rds-instance';
  }
  if (isS3Node(node)) {
    return 'your-bucket';
  }
  if (isEfsNode(node)) {
    return 'your-efs-file-system';
  }
  if (isDynamoNode(node)) {
    return 'your-dynamodb-table';
  }
  if (isLambdaNode(node)) {
    return 'your-lambda-function';
  }
  if (isElbNode(node)) {
    return 'your-load-balancer';
  }
  return 'your-resource';
}

function resolveRegion(node: InfraNode, redact: boolean): string {
  if (redact) {
    return '<aws-region>';
  }

  return readString(node.region) ?? readString(node.metadata.region) ?? 'us-east-1';
}

function resolveSecondaryRegion(node: InfraNode, redact: boolean): string {
  if (redact) {
    return '<secondary-region>';
  }

  const currentRegion = resolveRegion(node, false);
  return currentRegion === 'us-east-1' ? 'eu-west-1' : 'us-east-1';
}

function resolveArn(node: InfraNode, fallback: string): string {
  return node.id.startsWith('arn:') ? node.id : fallback;
}

function resolveRdsIdentifier(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-rds-instance', ['dbIdentifier', 'dbInstanceIdentifier']);
}

function resolveAuroraClusterIdentifier(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-aurora-cluster', ['dbClusterIdentifier', 'clusterIdentifier']);
}

function resolveEfsIdentifier(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-efs-file-system', ['fileSystemId']);
}

function resolveS3BucketName(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-bucket', ['bucketName']);
}

function resolveEc2Identifier(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-ec2-instance', ['instanceId']);
}

function resolveAutoScalingGroupName(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-asg-name', ['autoScalingGroupName']);
}

function resolveElastiCacheIdentifier(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-replication-group', ['replicationGroupId', 'replicationGroup']);
}

function resolveDynamoTableName(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-dynamodb-table', ['tableName']);
}

function resolveRoute53HostedZoneId(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-hosted-zone-id', ['hostedZoneId']);
}

function resolveRoute53RecordName(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-record-name', ['name'], node.name);
}

function resolveLambdaIdentifier(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-lambda-function', ['functionName']);
}

function resolveLoadBalancerArn(
  node: InfraNode,
  redact: boolean,
  isDemo: boolean,
): string {
  if (redact || isDemo) {
    return '<your-load-balancer-arn>';
  }

  return pickIdentifier(node, false, 'your-load-balancer-arn', ['loadBalancerArn', 'arn'], node.id);
}

function resolveTargetGroupArn(node: InfraNode): string {
  return readString(node.metadata.targetGroupArn) ?? readString(node.metadata.defaultTargetGroupArn) ?? '<your-target-group-arn>';
}

function resolveSqsQueueUrl(node: InfraNode): string {
  return readString(node.metadata.queueUrl) ?? '<your-queue-url>';
}

function resolveEksIdentifier(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-eks-cluster', ['clusterName']);
}

function resolveVpcIdentifier(node: InfraNode, redact: boolean): string {
  return pickIdentifier(node, redact, 'your-vpc-id', ['vpcId'], node.id);
}

function pickIdentifier(
  node: InfraNode,
  redact: boolean,
  placeholder: string,
  keys: readonly string[],
  fallback = node.name,
): string {
  if (redact) {
    return `<${placeholder}>`;
  }

  for (const key of keys) {
    const value = readString(node.metadata[key]);
    if (value) {
      return value;
    }
  }

  return fallback;
}

function appendSuffix(
  value: string,
  redact: boolean,
  suffix: string,
  placeholder: string,
): string {
  return redact ? placeholder : `${value}${suffix}`;
}

function resolveMetricNamespace(node: InfraNode): string {
  if (isRdsNode(node)) {
    return 'AWS/RDS';
  }
  if (isLambdaNode(node)) {
    return 'AWS/Lambda';
  }
  if (isElbNode(node)) {
    return 'AWS/ApplicationELB';
  }
  return 'AWS/EC2';
}

function resolveMetricName(node: InfraNode): string {
  if (isRdsNode(node)) {
    return 'DatabaseConnections';
  }
  if (isLambdaNode(node)) {
    return 'Errors';
  }
  if (isElbNode(node)) {
    return 'UnHealthyHostCount';
  }
  return 'StatusCheckFailed';
}

function resolveMetricDimensions(node: InfraNode, redact: boolean, isDemo: boolean): string {
  if (isRdsNode(node)) {
    return `Name=DBInstanceIdentifier,Value=${resolveRdsIdentifier(node, redact)}`;
  }
  if (isLambdaNode(node)) {
    return `Name=FunctionName,Value=${resolveLambdaIdentifier(node, redact)}`;
  }
  if (isElbNode(node)) {
    return `Name=LoadBalancer,Value=${resolveLoadBalancerArn(node, redact, isDemo)}`;
  }
  return `Name=InstanceId,Value=${resolveEc2Identifier(node, redact)}`;
}

function isRdsNode(node: InfraNode): boolean {
  return readSourceType(node).includes('rds');
}

function isS3Node(node: InfraNode): boolean {
  return readSourceType(node).includes('s3');
}

function isEfsNode(node: InfraNode): boolean {
  return readSourceType(node).includes('efs');
}

function isDynamoNode(node: InfraNode): boolean {
  return readSourceType(node).includes('dynamodb');
}

function isLambdaNode(node: InfraNode): boolean {
  return readSourceType(node).includes('lambda');
}

function isElbNode(node: InfraNode): boolean {
  return readSourceType(node).includes('elb');
}

function readSourceType(node: InfraNode): string {
  return (readString(node.metadata.sourceType) ?? '').toLowerCase();
}

import {
  getMetadata,
  getReplicaCount,
  readBoolean,
  readNumber,
  readString,
} from '../graph/analysis-helpers.js';
import type {
  InfrastructureNode,
  RecoveryStrategy,
  RecoveryStrategyType,
  RTOEstimate,
  RTOFactor,
} from './drp-types.js';

const RDS_MULTI_AZ_URL =
  'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html';
const RDS_READ_REPLICA_URL =
  'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html';
const RDS_SNAPSHOT_RESTORE_URL =
  'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_RestoreFromSnapshot.html';
const RDS_PITR_URL = 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html';
const AURORA_FAILOVER_URL =
  'https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html';
const AURORA_GLOBAL_FAILOVER_URL =
  'https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html';
const DEFAULT_RTO_FALLBACK_MINUTES = 120;
const LEGACY_FULL_REBUILD_FALLBACK_MINUTES = 180;
const DEFAULT_RPO_FALLBACK_MINUTES = 1440;

/** Combined backward-compatible recovery objectives exposed on legacy DRP fields. */
export interface RecoveryObjectives {
  readonly rto: string;
  readonly rpo: string;
}

/** Inputs required by the honest recovery estimator. */
export interface RTOEstimateInput {
  readonly strategy: RecoveryStrategyType;
  readonly serviceType: string;
  readonly metadata: Record<string, unknown>;
  readonly isMultiRegion: boolean;
}

/** Optional input hints when building an RTO estimate from a graph node. */
export interface BuildRTOEstimateInputOptions {
  readonly isMultiRegion?: boolean;
  readonly targetRegion?: string | null;
}

type EstimateRecoveryStrategy = RecoveryStrategy | RecoveryStrategyType | 'full_rebuild';

interface RpoResolution {
  readonly rpoMinMinutes: number | null;
  readonly rpoMaxMinutes: number | null;
  readonly factors: readonly RTOFactor[];
}

/** Builds an estimator input from the current infrastructure node metadata. */
export function buildRTOEstimateInput(
  node: InfrastructureNode,
  strategy: EstimateRecoveryStrategy,
  options: BuildRTOEstimateInputOptions = {},
): RTOEstimateInput {
  const metadata = {
    ...getMetadata(node),
    ...(node.region ? { region: node.region } : {}),
    ...(options.targetRegion ? { targetRegion: options.targetRegion } : {}),
  };

  return {
    strategy: normalizeEstimateStrategy(node, strategy),
    serviceType: resolveServiceType(node, metadata),
    metadata,
    isMultiRegion: options.isMultiRegion ?? hasCrossRegionSignals(metadata),
  };
}

/** Estimates the structured RTO/RPO posture for a component. */
export function estimateRecovery(input: RTOEstimateInput): RTOEstimate {
  if (isAuroraGlobalEstimate(input)) {
    return withCrossRegionFactor(buildAuroraGlobalEstimate(), input);
  }
  if (isAuroraFailoverEstimate(input)) {
    return withCrossRegionFactor(buildAuroraFailoverEstimate(), input);
  }
  if (isAuroraBackupRestoreEstimate(input)) {
    return withCrossRegionFactor(buildBackupRestoreEstimate(input.metadata), input);
  }
  if (isEfsEstimate(input)) {
    return withCrossRegionFactor(buildEfsEstimate(input.metadata), input);
  }

  switch (input.strategy) {
    case 'aurora_failover':
      return withCrossRegionFactor(buildAuroraFailoverEstimate(), input);
    case 'aurora_global_failover':
      return withCrossRegionFactor(buildAuroraGlobalEstimate(), input);
    case 'hot_standby':
      return withCrossRegionFactor(buildHotStandbyEstimate(), input);
    case 'warm_standby':
      return withCrossRegionFactor(buildWarmStandbyEstimate(input.metadata), input);
    case 'backup_restore':
      return withCrossRegionFactor(buildBackupRestoreEstimate(input.metadata), input);
    case 'full_rebuild':
      return withCrossRegionFactor(buildFullRebuildEstimate(input.metadata), input);
    case 'dns_failover':
      return withCrossRegionFactor(buildDnsFailoverEstimate(input.metadata), input);
    case 'auto_scaling':
      return withCrossRegionFactor(buildAutoScalingEstimate(input.serviceType), input);
    case 'manual':
      return withCrossRegionFactor(buildManualEstimate(input.metadata), input);
    case 'failover':
      return withCrossRegionFactor(buildGenericFailoverEstimate(input.serviceType), input);
    case 'none':
      return withCrossRegionFactor(buildNoRecoveryEstimate(input.metadata), input);
  }
}

/** Estimates backward-compatible RTO/RPO strings for legacy DRP fields. */
export function estimateRecoveryObjectives(
  node: InfrastructureNode,
  strategy: RecoveryStrategy,
): RecoveryObjectives {
  return {
    rto: estimateComponentRto(node, strategy),
    rpo: estimateComponentRpo(node, strategy),
  };
}

/** Estimates a backward-compatible RTO duration string. */
export function estimateComponentRto(
  node: InfrastructureNode,
  strategy: EstimateRecoveryStrategy,
): string {
  return formatDurationMinutes(estimateRTO(node, strategy));
}

/** Estimates a backward-compatible RPO duration string. */
export function estimateComponentRpo(
  node: InfrastructureNode,
  strategy: EstimateRecoveryStrategy,
): string {
  return formatDurationMinutes(estimateRPO(node, strategy));
}

/** Parses a duration string used by DRP components and services. */
export function parseDrpDuration(value: string): number {
  if (value === 'total_loss') return Number.POSITIVE_INFINITY;

  const match = /^(\d+)(s|m|h)$/.exec(value.trim().toLowerCase());
  if (!match) return Number.POSITIVE_INFINITY;

  const amount = Number(match[1]);
  if (match[2] === 's') return amount;
  if (match[2] === 'm') return amount * 60;
  return amount * 3600;
}

/** Returns a numeric RTO estimate in minutes for a known recovery strategy. */
export function estimateRTO(node: InfrastructureNode, strategy: EstimateRecoveryStrategy): number {
  const estimate = estimateRecovery(buildRTOEstimateInput(node, strategy));
  if (estimate.rtoMaxMinutes !== null) return estimate.rtoMaxMinutes;

  // The public wrapper keeps a conservative fallback for older numeric callers.
  if (strategy === 'full_rebuild') return LEGACY_FULL_REBUILD_FALLBACK_MINUTES;
  return DEFAULT_RTO_FALLBACK_MINUTES;
}

/** Returns a numeric RPO estimate in minutes for a known recovery strategy. */
export function estimateRPO(node: InfrastructureNode, strategy: EstimateRecoveryStrategy): number {
  const estimate = estimateRecovery(buildRTOEstimateInput(node, strategy));
  if (estimate.rpoMaxMinutes !== null) return estimate.rpoMaxMinutes;

  // The public wrapper keeps a conservative fallback for older numeric callers.
  return DEFAULT_RPO_FALLBACK_MINUTES;
}

function buildHotStandbyEstimate(): RTOEstimate {
  return {
    rtoMinMinutes: 1,
    rtoMaxMinutes: 5,
    rpoMinMinutes: 0,
    rpoMaxMinutes: 0,
    confidence: 'documented',
    method:
      'Multi-AZ automatic failover. AWS documents failover in roughly 60-120 seconds; this range adds room for DNS propagation and application reconnects.',
    factors: [
      {
        name: 'recovery_strategy',
        value: 'multi_az_failover',
        impact: 'Standby capacity is already provisioned, so recovery avoids a full restore.',
        source: { type: 'aws_documentation', url: RDS_MULTI_AZ_URL },
      },
    ],
    limitations: [
      'Does not account for application reconnection time',
      'DNS TTL may extend actual switchover',
    ],
  };
}

function buildAuroraFailoverEstimate(): RTOEstimate {
  return {
    rtoMinMinutes: 0.5,
    rtoMaxMinutes: 2,
    rpoMinMinutes: 0,
    rpoMaxMinutes: 0,
    confidence: 'documented',
    method:
      'Aurora replica failover. AWS documents Aurora failover as typically around 30 seconds; this range adds room for endpoint updates and client reconnects.',
    factors: [
      {
        name: 'recovery_strategy',
        value: 'aurora_replica_failover',
        impact: 'Aurora replicas share cluster storage, so failover avoids restore time and preserves zero data loss inside the cluster.',
        source: { type: 'aws_documentation', url: AURORA_FAILOVER_URL },
      },
    ],
    limitations: [
      'Does not account for application reconnect behavior',
      'Client DNS caching can extend the observed switchover time',
    ],
  };
}

function buildAuroraGlobalEstimate(): RTOEstimate {
  return {
    rtoMinMinutes: 1,
    rtoMaxMinutes: 5,
    rpoMinMinutes: 0,
    rpoMaxMinutes: 1,
    confidence: 'documented',
    method:
      'Aurora global database failover. AWS documents planned global failover under one minute with sub-second replication lag; this range widens for unplanned promotion and endpoint cutover.',
    factors: [
      {
        name: 'recovery_strategy',
        value: 'aurora_global_failover',
        impact: 'Cross-region Aurora replication enables promotion of a secondary cluster with far less data loss than backup-driven recovery.',
        source: { type: 'aws_documentation', url: AURORA_GLOBAL_FAILOVER_URL },
      },
    ],
    limitations: [
      'Unplanned failover can exceed the planned failover path documented by AWS',
      'Application endpoint and DNS updates are not controlled by Aurora itself',
    ],
  };
}

function buildWarmStandbyEstimate(metadata: Record<string, unknown>): RTOEstimate {
  const replicaLagMinutes = resolveReplicaLagMinutes(metadata);
  const lagFactor: RTOFactor =
    replicaLagMinutes !== null
      ? {
          name: 'replica_lag',
          value: `${replicaLagMinutes} min`,
          impact: 'Pending replication lag increases the amount of recent data that can be lost.',
          source: { type: 'configuration', field: 'replicaLag' },
        }
      : {
          name: 'replica_lag',
          value: '0-5 min typical lag assumed',
          impact: 'Asynchronous replication lag determines how much recent data may be missing after promotion.',
          source: {
            type: 'heuristic',
            reasoning:
              'Asynchronous replication lag typically stays below 5 minutes for same-region replicas, but varies with write load.',
          },
        };

  return {
    rtoMinMinutes: 5,
    rtoMaxMinutes: 30,
    rpoMinMinutes: 0,
    rpoMaxMinutes: replicaLagMinutes ?? 5,
    confidence: 'informed',
    method:
      'Read replica promotion. AWS documents promotion taking several minutes, but the final window depends on replica lag and endpoint cutover.',
    factors: [
      {
        name: 'recovery_strategy',
        value: 'read_replica_promotion',
        impact: 'Promotion is faster than restoring from backup because a warm replica already exists.',
        source: { type: 'aws_documentation', url: RDS_READ_REPLICA_URL },
      },
      lagFactor,
    ],
    limitations: [
      'Promotion time varies with pending replication lag',
      'Application endpoint reconfiguration time not included',
      'Actual lag depends on write throughput at time of failure',
    ],
  };
}

function buildBackupRestoreEstimate(metadata: Record<string, unknown>): RTOEstimate {
  const factors: RTOFactor[] = [
    {
      name: 'restore_method',
      value: 'snapshot',
      impact:
        'AWS uses lazy loading: the instance starts before all data is fully loaded, so early queries may be slow.',
      source: { type: 'aws_documentation', url: RDS_SNAPSHOT_RESTORE_URL },
    },
  ];

  const allocatedStorage = readNumber(metadata.allocatedStorage);
  if (allocatedStorage !== null) {
    factors.unshift({
      name: 'data_volume',
      value: `${allocatedStorage} GB`,
      impact: 'Larger volumes generally take longer to restore.',
      source: { type: 'configuration', field: 'allocatedStorage' },
    });
  }

  const storageType = readString(metadata.storageType);
  if (storageType) {
    factors.push({
      name: 'storage_type',
      value: storageType,
      impact: 'Storage type affects restore throughput.',
      source: { type: 'configuration', field: 'storageType' },
    });
  }

  const rpo = resolveBackupRpo(metadata);
  return {
    rtoMinMinutes: null,
    rtoMaxMinutes: null,
    rpoMinMinutes: rpo.rpoMinMinutes,
    rpoMaxMinutes: rpo.rpoMaxMinutes,
    confidence: 'unverified',
    method:
      'Snapshot restore - no reliable time estimate without testing. AWS uses lazy loading: instance starts before all data is loaded, but initial query performance is degraded. Run a restore test to establish your baseline RTO.',
    factors: [...factors, ...rpo.factors],
    limitations: [
      'Actual restore time depends on instance type, storage throughput, and AWS service load',
      'Lazy loading means instance is available but performance is degraded until all data is loaded',
      'Only a tested restore can establish reliable RTO',
    ],
  };
}

function buildFullRebuildEstimate(metadata: Record<string, unknown>): RTOEstimate {
  const factors: RTOFactor[] = hasInfrastructureAsCode(metadata)
    ? [
        {
          name: 'iac_detected',
          value: readString(metadata.cloudformationStackId) ? 'CloudFormation' : 'IaC detected',
          impact: 'Infrastructure-as-code shortens rebuild time compared with manual recreation.',
          source: { type: 'configuration', field: 'cloudformationStackId' },
        },
      ]
    : [
        {
          name: 'no_iac',
          value: 'none detected',
          impact: 'Manual rebuild is required and the elapsed time depends on team procedures.',
          source: {
            type: 'heuristic',
            reasoning: 'No infrastructure-as-code artifacts were detected on this resource.',
          },
        },
      ];
  const rpo = resolveBackupRpo(metadata);

  return {
    rtoMinMinutes: null,
    rtoMaxMinutes: null,
    rpoMinMinutes: rpo.rpoMinMinutes,
    rpoMaxMinutes: rpo.rpoMaxMinutes,
    confidence: 'unverified',
    method:
      'Full rebuild from infrastructure definitions or manual procedures. Recovery time cannot be estimated honestly without a tested rebuild runbook.',
    factors: [...factors, ...rpo.factors],
    limitations: [
      'RTO depends entirely on team procedures and IaC maturity',
      'Cannot be estimated without a tested runbook',
    ],
  };
}

function buildGenericFailoverEstimate(serviceType: string): RTOEstimate {
  return {
    rtoMinMinutes: null,
    rtoMaxMinutes: null,
    rpoMinMinutes: null,
    rpoMaxMinutes: null,
    confidence: 'unverified',
    method: `Automatic failover signals were detected for ${serviceType}, but no reliable provider range is documented for this configuration.`,
    factors: [
      {
        name: 'recovery_strategy',
        value: 'automatic_failover',
        impact: 'A standby or replicated path may reduce downtime compared with a restore, but the real duration is unknown.',
        source: {
          type: 'heuristic',
          reasoning:
            'Provider documentation does not publish a dependable failover time range for this service configuration.',
        },
      },
    ],
    limitations: [
      'Provider documentation does not publish a dependable failover duration for this configuration',
      'Only a tested failover can establish reliable RTO',
    ],
  };
}

function buildDnsFailoverEstimate(metadata: Record<string, unknown>): RTOEstimate {
  const ttlSeconds = readNumber(metadata.ttl) ?? 60;
  const maxMinutes = Math.max(1, Math.ceil(ttlSeconds / 60));
  return {
    rtoMinMinutes: 1,
    rtoMaxMinutes: maxMinutes,
    rpoMinMinutes: 0,
    rpoMaxMinutes: 0,
    confidence: 'informed',
    method:
      'DNS failover based on record TTL and health checks. The lower bound assumes healthy secondary capacity is ready and caches honor the configured TTL.',
    factors: [
      {
        name: 'dns_ttl',
        value: `${ttlSeconds} s`,
        impact: 'Lower TTL values reduce cache persistence during DNS failover.',
        source: { type: 'configuration', field: 'ttl' },
      },
    ],
    limitations: [
      'Resolver caches do not always expire exactly at the configured TTL',
      'Does not account for application-side reconnect behavior',
    ],
  };
}

function buildAutoScalingEstimate(serviceType: string): RTOEstimate {
  return {
    rtoMinMinutes: null,
    rtoMaxMinutes: null,
    rpoMinMinutes: 0,
    rpoMaxMinutes: 0,
    confidence: 'unverified',
    method: `Elastic capacity or replacement was detected for ${serviceType}, but actual recovery time depends on warm capacity, images, and scaling policies.`,
    factors: [
      {
        name: 'recovery_strategy',
        value: 'elastic_capacity',
        impact: 'Predefined scaling policies can reduce operator effort during replacement.',
        source: {
          type: 'heuristic',
          reasoning:
            'Scaling and replacement speed varies with warm capacity, image pull time, and placement conditions.',
        },
      },
    ],
    limitations: [
      'Scaling latency depends on spare capacity, image startup time, and placement constraints',
      'Only a tested failover or scale-out exercise can establish reliable RTO',
    ],
  };
}

function buildManualEstimate(metadata: Record<string, unknown>): RTOEstimate {
  const rpo = resolveBackupRpo(metadata);
  return {
    rtoMinMinutes: null,
    rtoMaxMinutes: null,
    rpoMinMinutes: rpo.rpoMinMinutes,
    rpoMaxMinutes: rpo.rpoMaxMinutes,
    confidence: 'unverified',
    method:
      'Manual recovery only. Actual recovery time depends on operator procedures, access, and runbook quality.',
    factors: [...rpo.factors],
    limitations: [
      'Recovery depends on operator availability and documentation quality',
      'Cannot be estimated without a tested manual runbook',
    ],
  };
}

function buildEfsEstimate(metadata: Record<string, unknown>): RTOEstimate {
  const oneZone = readString(metadata.availabilityZoneName) !== null;
  const rpo = resolveBackupRpo(metadata);

  return {
    rtoMinMinutes: null,
    rtoMaxMinutes: null,
    rpoMinMinutes: rpo.rpoMinMinutes,
    rpoMaxMinutes: rpo.rpoMaxMinutes,
    confidence: 'unverified',
    method: oneZone
      ? 'EFS One Zone recovery depends on backup restore or replication recovery. AWS does not publish a dependable failover time range for this path.'
      : 'Regional EFS survives single-AZ loss natively, so Stronghold does not claim a failover RTO. Recovery timing still depends on clients and any region-level DR procedure.',
    factors: [
      {
        name: 'availability_mode',
        value: oneZone ? 'one_zone' : 'regional',
        impact:
          'One Zone file systems require restore or replication after AZ loss, while Regional file systems keep storage available across AZs.',
        source: { type: 'configuration', field: 'availabilityZoneName' },
      },
      ...rpo.factors,
    ],
    limitations: [
      'AWS does not publish a dependable failover duration for EFS recovery paths',
      'Only a tested restore or replication exercise can establish reliable RTO',
    ],
  };
}

function buildNoRecoveryEstimate(metadata: Record<string, unknown>): RTOEstimate {
  const rpo = resolveBackupRpo(metadata);
  return {
    rtoMinMinutes: null,
    rtoMaxMinutes: null,
    rpoMinMinutes: rpo.rpoMinMinutes,
    rpoMaxMinutes: rpo.rpoMaxMinutes,
    confidence: 'unverified',
    method:
      'No deterministic recovery mechanism was detected. Recovery time cannot be estimated without a tested emergency procedure.',
    factors: [...rpo.factors],
    limitations: [
      'No deterministic recovery path was detected from the current configuration',
      'Only a tested DR procedure can establish reliable recovery objectives',
    ],
  };
}

function resolveBackupRpo(metadata: Record<string, unknown>): RpoResolution {
  if (hasEfsReplicationEnabled(metadata)) {
    return {
      rpoMinMinutes: 0,
      rpoMaxMinutes: null,
      factors: [
        {
          name: 'efs_replication',
          value: 'enabled',
          impact: 'EFS replication keeps a secondary copy current, but AWS does not publish a dependable upper-bound lag for DR calculations.',
          source: {
            type: 'heuristic',
            reasoning:
              'Amazon EFS replication is asynchronous and AWS does not publish a dependable upper-bound RPO for disaster recovery calculations.',
          },
        },
      ],
    };
  }

  if (hasEfsAutomaticBackups(metadata)) {
    return {
      rpoMinMinutes: 0,
      rpoMaxMinutes: 1440,
      factors: [
        {
          name: 'efs_automatic_backups',
          value: 'enabled',
          impact: 'Automatic daily backups cap potential data loss at roughly 24 hours when no fresher replicated copy exists.',
          source: { type: 'configuration', field: 'backupPolicy.status' },
        },
      ],
    };
  }

  if (hasPointInTimeRecovery(metadata)) {
    return {
      rpoMinMinutes: 0,
      rpoMaxMinutes: 5,
      factors: [
        {
          name: 'point_in_time_recovery',
          value: 'enabled',
          impact: 'Continuous transaction-log retention keeps the recoverable data loss window close to zero.',
          source: { type: 'aws_documentation', url: RDS_PITR_URL },
        },
      ],
    };
  }

  const timestampField = resolveBackupTimestampField(metadata);
  const timestampValue = timestampField ? readString(metadata[timestampField]) : null;
  const snapshotAgeMinutes = timestampValue ? minutesSince(timestampValue) : null;
  if (timestampField && timestampValue && snapshotAgeMinutes !== null) {
    return {
      rpoMinMinutes: snapshotAgeMinutes,
      rpoMaxMinutes: snapshotAgeMinutes,
      factors: [
        {
          name: 'backup_timestamp',
          value: timestampValue,
          impact: 'The effective RPO is bounded by the age of the latest known recovery point.',
          source: { type: 'configuration', field: timestampField },
        },
      ],
    };
  }

  if (hasAnyBackupConfigured(metadata)) {
    return {
      rpoMinMinutes: null,
      rpoMaxMinutes: null,
      factors: [
        {
          name: 'no_backup_timestamp',
          value: 'timestamp unavailable',
          impact:
            'Backups may exist, but Stronghold cannot derive the effective RPO without the latest recovery point timestamp.',
          source: {
            type: 'configuration',
            field: timestampField ?? 'latestRestorableTime',
          },
        },
      ],
    };
  }

  return {
    rpoMinMinutes: null,
    rpoMaxMinutes: null,
    factors: [
      {
        name: 'no_backup',
        value: 'none detected',
        impact: 'Complete data loss in case of failure - RPO is infinite.',
        source: { type: 'configuration', field: 'backupRetentionPeriod' },
      },
    ],
  };
}

function withCrossRegionFactor(estimate: RTOEstimate, input: RTOEstimateInput): RTOEstimate {
  if (!input.isMultiRegion) return estimate;
  return {
    ...estimate,
    factors: [...estimate.factors, buildCrossRegionFactor(input.metadata)],
  };
}

function buildCrossRegionFactor(metadata: Record<string, unknown>): RTOFactor {
  return {
    name: 'cross_region_transfer',
    value: formatRegionPair(metadata),
    impact:
      'Cross-region data transfer adds variable time depending on dataset size and network conditions.',
    source: {
      type: 'heuristic',
      reasoning:
        'AWS inter-region bandwidth is not guaranteed and varies by region pair and service load.',
    },
  };
}

function resolveServiceType(
  node: InfrastructureNode,
  metadata: Record<string, unknown>,
): string {
  return (readString(metadata.sourceType) ?? node.type).toLowerCase();
}

function normalizeEstimateStrategy(
  node: InfrastructureNode,
  strategy: EstimateRecoveryStrategy,
): RecoveryStrategyType {
  switch (strategy) {
    case 'aurora_failover':
    case 'aurora_global_failover':
    case 'hot_standby':
    case 'warm_standby':
    case 'backup_restore':
    case 'full_rebuild':
    case 'dns_failover':
    case 'auto_scaling':
    case 'manual':
    case 'none':
      return strategy;
    case 'restore_from_backup':
      return 'backup_restore';
    case 'rebuild':
      return 'full_rebuild';
    case 'failover':
      break;
  }

  const metadata = getMetadata(node);
  if (isWarmStandby(metadata)) return 'warm_standby';
  if (isHotStandby(metadata)) return 'hot_standby';
  return 'failover';
}

function isHotStandby(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.multiAZ) === true ||
    readBoolean(metadata.multiAz) === true ||
    readBoolean(metadata.multi_az) === true ||
    readBoolean(metadata.isMultiAZ) === true
  );
}

function isWarmStandby(metadata: Record<string, unknown>): boolean {
  return (
    (Array.isArray(metadata.readReplicaDBInstanceIdentifiers) &&
      metadata.readReplicaDBInstanceIdentifiers.length > 0) ||
    getReplicaCount(metadata) > 0
  );
}

function resolveReplicaLagMinutes(metadata: Record<string, unknown>): number | null {
  const directMinutes =
    readNumber(metadata.replicaLag) ??
    readNumber(metadata.replicaLagMinutes) ??
    readNumber(metadata.replicationLagMinutes);
  if (directMinutes !== null) return Math.max(0, Math.round(directMinutes));

  const lagSeconds =
    readNumber(metadata.replicaLagSeconds) ?? readNumber(metadata.replicationLagSeconds);
  return lagSeconds === null ? null : Math.max(0, Math.ceil(lagSeconds / 60));
}

function hasPointInTimeRecovery(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.pointInTimeRecoveryEnabled) === true ||
    readBoolean(metadata.pointInTimeRecovery) === true ||
    readBoolean(metadata.pitrEnabled) === true ||
    readString(metadata.latestRestorableTime) !== null
  );
}

function resolveBackupTimestampField(metadata: Record<string, unknown>): string | null {
  if (readString(metadata.latestRestorableTime)) return 'latestRestorableTime';
  if (readString(metadata.lastSnapshotTime)) return 'lastSnapshotTime';
  return null;
}

function hasAnyBackupConfigured(metadata: Record<string, unknown>): boolean {
  return (
    hasPointInTimeRecovery(metadata) ||
    hasEfsAutomaticBackups(metadata) ||
    readBoolean(metadata.backupEnabled) === true ||
    readBoolean(metadata.snapshotEnabled) === true ||
    (readNumber(metadata.backupRetentionPeriod) ?? 0) > 0 ||
    (readNumber(metadata.backupRetentionDays) ?? 0) > 0 ||
    (readNumber(metadata.snapshotCount) ?? 0) > 0 ||
    resolveBackupTimestampField(metadata) !== null
  );
}

function hasInfrastructureAsCode(metadata: Record<string, unknown>): boolean {
  if (readString(metadata.cloudformationStackId)) return true;
  if (readString(metadata.terraformResourceAddress)) return true;

  const tags = metadata.tags;
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return false;
  return Object.keys(tags as Record<string, unknown>).some((key) =>
    ['aws:cloudformation:stack-id', 'terraform', 'pulumi'].includes(key.toLowerCase()),
  );
}

function hasCrossRegionSignals(metadata: Record<string, unknown>): boolean {
  const region = readString(metadata.region);
  const targetRegion = readString(metadata.targetRegion) ?? readString(metadata.secondaryRegion);
  if (region && targetRegion && region !== targetRegion) return true;
  if (readString(metadata.globalClusterIdentifier) !== null) return true;

  if (Array.isArray(metadata.replicaRegions)) {
    return metadata.replicaRegions
      .map((value) => readString(value))
      .some((value): value is string => value !== null && value !== region);
  }

  return readBoolean(metadata.hasCrossRegionReplication) === true;
}

function formatRegionPair(metadata: Record<string, unknown>): string {
  const sourceRegion =
    readString(metadata.sourceRegion) ??
    readString(metadata.primaryRegion) ??
    readString(metadata.region) ??
    'primary';
  const targetRegion =
    readString(metadata.targetRegion) ??
    readString(metadata.secondaryRegion) ??
    firstReplicaRegion(metadata) ??
    'secondary';
  return `${sourceRegion} -> ${targetRegion}`;
}

function firstReplicaRegion(metadata: Record<string, unknown>): string | null {
  if (!Array.isArray(metadata.replicaRegions)) return null;
  for (const value of metadata.replicaRegions) {
    const region = readString(value);
    if (region) return region;
  }
  return null;
}

function isAuroraService(serviceType: string): boolean {
  return serviceType.includes('aurora_cluster');
}

function isAuroraFailoverEstimate(input: RTOEstimateInput): boolean {
  return isAuroraService(input.serviceType) && input.strategy === 'aurora_failover';
}

function isAuroraGlobalEstimate(input: RTOEstimateInput): boolean {
  return isAuroraService(input.serviceType) && input.strategy === 'aurora_global_failover';
}

function isAuroraBackupRestoreEstimate(input: RTOEstimateInput): boolean {
  return (
    isAuroraService(input.serviceType) &&
    !isAuroraFailoverEstimate(input) &&
    !isAuroraGlobalEstimate(input)
  );
}

function isEfsEstimate(input: RTOEstimateInput): boolean {
  return input.serviceType.includes('efs');
}

function hasEfsAutomaticBackups(metadata: Record<string, unknown>): boolean {
  if (readBoolean(metadata.automaticBackups) === true) return true;

  const backupPolicy =
    metadata.backupPolicy && typeof metadata.backupPolicy === 'object' && !Array.isArray(metadata.backupPolicy)
      ? (metadata.backupPolicy as Record<string, unknown>)
      : null;
  return readString(backupPolicy?.status)?.toUpperCase() === 'ENABLED';
}

function hasEfsReplicationEnabled(metadata: Record<string, unknown>): boolean {
  if (!Array.isArray(metadata.replicationConfigurations)) return false;
  return metadata.replicationConfigurations.some((value) => {
    if (!value || typeof value !== 'object') return false;
    return readString((value as Record<string, unknown>).status)?.toUpperCase() === 'ENABLED';
  });
}

function minutesSince(value: string): number | null {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.ceil((Date.now() - timestamp) / 60000));
}

function formatDurationMinutes(minutes: number): string {
  if (minutes <= 0) return '0s';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes % 60 === 0) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes)}m`;
}

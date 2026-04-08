import type { DRCategory } from '../validation/validation-types.js';
import type { DRCapability } from './finding-types.js';
import type { ResourceRole } from './service-types.js';

type CanonicalRuleId =
  | 'backup_configured'
  | 'multi_az'
  | 'replication_configured'
  | 'failover_dns'
  | 'monitoring_configured'
  | 'encryption_at_rest'
  | 'point_in_time_recovery'
  | 'auto_scaling'
  | 'health_check'
  | 'dead_letter_queue';

interface ImpactTemplate {
  readonly summary: string;
  readonly recoveryImplication: string;
  readonly affectedCapability: DRCapability;
}

const SPECIFIC_TEMPLATES: Readonly<Record<CanonicalRuleId, Readonly<Record<'datastore' | 'compute' | 'storage', ImpactTemplate>>>> = {
  backup_configured: {
    datastore: {
      summary: 'No backup configured. Data loss is permanent in a failure scenario.',
      recoveryImplication: 'Database recovery depends on manual reconstruction instead of restore points.',
      affectedCapability: 'backup',
    },
    compute: {
      summary: 'No recoverable image or backup path is configured for this compute layer.',
      recoveryImplication: 'Rebuilding the workload will take longer and configuration drift is more likely.',
      affectedCapability: 'backup',
    },
    storage: {
      summary: 'No backup or versioning is configured. Deleted or corrupted objects are unrecoverable.',
      recoveryImplication: 'The service loses the last known-good copy of its stored content.',
      affectedCapability: 'backup',
    },
  },
  multi_az: {
    datastore: {
      summary: 'Single-AZ deployment. An AZ failure causes downtime until manual restore.',
      recoveryImplication: 'The datastore has no zonal standby and becomes a hard dependency during failover.',
      affectedCapability: 'failover',
    },
    compute: {
      summary: 'Single-AZ deployment. An AZ failure stops this compute workload.',
      recoveryImplication: 'Traffic can only recover after the workload is rebuilt in another zone.',
      affectedCapability: 'redundancy',
    },
    storage: {
      summary: 'Storage capacity is concentrated in one availability zone.',
      recoveryImplication: 'A zonal event can interrupt access to shared files or objects during recovery.',
      affectedCapability: 'redundancy',
    },
  },
  replication_configured: {
    datastore: {
      summary: 'No cross-region or replica path is configured for this datastore.',
      recoveryImplication: 'A regional failure can leave the service without current data in the recovery region.',
      affectedCapability: 'replication',
    },
    compute: {
      summary: 'No replicated standby capacity exists for this compute workload.',
      recoveryImplication: 'Recovery depends on redeploying code and configuration from scratch.',
      affectedCapability: 'replication',
    },
    storage: {
      summary: 'No replicated copy exists for this storage layer.',
      recoveryImplication: 'A regional outage leaves stored content unavailable until manual recovery completes.',
      affectedCapability: 'replication',
    },
  },
  failover_dns: {
    datastore: {
      summary: 'No failover routing is configured for the datastore endpoint.',
      recoveryImplication: 'Clients will continue resolving to a failed primary endpoint during an outage.',
      affectedCapability: 'failover',
    },
    compute: {
      summary: 'No failover DNS routing is configured for the compute entry point.',
      recoveryImplication: 'Users will continue to reach failed endpoints after the primary path is down.',
      affectedCapability: 'failover',
    },
    storage: {
      summary: 'No failover DNS routing is configured for the storage endpoint.',
      recoveryImplication: 'Consumers will continue to resolve the unavailable storage location in a disaster.',
      affectedCapability: 'failover',
    },
  },
  monitoring_configured: {
    datastore: {
      summary: 'No monitoring signal is configured for the datastore.',
      recoveryImplication: 'Replica lag, backup failures, or outages may go unnoticed long enough to extend RTO.',
      affectedCapability: 'detection',
    },
    compute: {
      summary: 'No monitoring signal is configured for this compute workload.',
      recoveryImplication: 'Responders may not detect application failure quickly enough to start recovery.',
      affectedCapability: 'detection',
    },
    storage: {
      summary: 'No monitoring signal is configured for this storage dependency.',
      recoveryImplication: 'Corruption or unavailability may stay invisible until application recovery is already blocked.',
      affectedCapability: 'detection',
    },
  },
  encryption_at_rest: {
    datastore: {
      summary: 'Data is not encrypted at rest on the primary datastore.',
      recoveryImplication: 'Recovery options are constrained because replicas and backups may fail compliance review.',
      affectedCapability: 'recovery',
    },
    compute: {
      summary: 'Compute state is not encrypted at rest.',
      recoveryImplication: 'Recovery images or attached state may be blocked from use in regulated failover paths.',
      affectedCapability: 'recovery',
    },
    storage: {
      summary: 'Stored objects or files are not encrypted at rest.',
      recoveryImplication: 'Restored copies may not be acceptable for production recovery or audit sign-off.',
      affectedCapability: 'recovery',
    },
  },
  point_in_time_recovery: {
    datastore: {
      summary: 'Point-in-time recovery is disabled for this datastore.',
      recoveryImplication: 'Recovery can only return to coarse backup points, increasing data loss exposure.',
      affectedCapability: 'recovery',
    },
    compute: {
      summary: 'Point-in-time rollback is unavailable for this compute state.',
      recoveryImplication: 'Recovery cannot easily rewind to a known-good execution state after corruption.',
      affectedCapability: 'recovery',
    },
    storage: {
      summary: 'Point-in-time restore is unavailable for this storage dependency.',
      recoveryImplication: 'The service cannot recover to a precise pre-incident point when data changes go bad.',
      affectedCapability: 'recovery',
    },
  },
  auto_scaling: {
    datastore: {
      summary: 'This datastore has no elastic recovery capacity path.',
      recoveryImplication: 'Failover and replay can saturate the primary data tier during recovery.',
      affectedCapability: 'redundancy',
    },
    compute: {
      summary: 'Compute is not managed by Auto Scaling or an equivalent replacement pool.',
      recoveryImplication: 'Recovery depends on manually replacing failed instances instead of automatic rescheduling.',
      affectedCapability: 'redundancy',
    },
    storage: {
      summary: 'Storage recovery depends on a fixed capacity footprint.',
      recoveryImplication: 'The service has limited headroom to absorb recovery load or rebuild volume.',
      affectedCapability: 'recovery',
    },
  },
  health_check: {
    datastore: {
      summary: 'No health check is available for the datastore dependency.',
      recoveryImplication: 'Failover tooling cannot quickly distinguish a healthy standby from a broken one.',
      affectedCapability: 'detection',
    },
    compute: {
      summary: 'No health check is configured for the compute path.',
      recoveryImplication: 'Traffic may continue routing to unhealthy instances and delay service restoration.',
      affectedCapability: 'detection',
    },
    storage: {
      summary: 'No health check is configured for the storage endpoint.',
      recoveryImplication: 'Recovery orchestration may not detect storage failures until dependent services time out.',
      affectedCapability: 'detection',
    },
  },
  dead_letter_queue: {
    datastore: {
      summary: 'Failed data-processing events are not retained in a dead-letter path.',
      recoveryImplication: 'Incident recovery can lose failed writes or replay order for critical records.',
      affectedCapability: 'recovery',
    },
    compute: {
      summary: 'Failed workload events have no dead-letter queue.',
      recoveryImplication: 'Messages or invocations can disappear instead of waiting for controlled replay after recovery.',
      affectedCapability: 'recovery',
    },
    storage: {
      summary: 'Storage-processing failures have no dead-letter queue.',
      recoveryImplication: 'Object-processing failures can be lost and leave the service in an inconsistent recovered state.',
      affectedCapability: 'recovery',
    },
  },
};

const GENERIC_FALLBACKS: Readonly<Record<CanonicalRuleId, ImpactTemplate>> = {
  backup_configured: {
    summary: 'Required backup protection is not configured.',
    recoveryImplication: 'The service may not have a restorable copy when a disaster occurs.',
    affectedCapability: 'backup',
  },
  multi_az: {
    summary: 'The workload is not distributed across multiple availability zones.',
    recoveryImplication: 'A zonal event can interrupt the service until manual intervention completes.',
    affectedCapability: 'redundancy',
  },
  replication_configured: {
    summary: 'Required replication is not configured.',
    recoveryImplication: 'The service may not have a warm secondary copy during regional recovery.',
    affectedCapability: 'replication',
  },
  failover_dns: {
    summary: 'Failover DNS routing is incomplete.',
    recoveryImplication: 'Traffic can continue targeting failed endpoints during an outage.',
    affectedCapability: 'failover',
  },
  monitoring_configured: {
    summary: 'Monitoring coverage is incomplete.',
    recoveryImplication: 'Failures may remain undetected long enough to extend downtime.',
    affectedCapability: 'detection',
  },
  encryption_at_rest: {
    summary: 'Encryption-at-rest requirements are not met.',
    recoveryImplication: 'Recovered assets may fail compliance or approval checks when the service is restored.',
    affectedCapability: 'recovery',
  },
  point_in_time_recovery: {
    summary: 'Point-in-time recovery is unavailable.',
    recoveryImplication: 'Recovery can only return to broader restore points with more data loss.',
    affectedCapability: 'recovery',
  },
  auto_scaling: {
    summary: 'Elastic recovery capacity is not configured.',
    recoveryImplication: 'Replacing failed capacity becomes slower and more manual during recovery.',
    affectedCapability: 'redundancy',
  },
  health_check: {
    summary: 'Health-check coverage is incomplete.',
    recoveryImplication: 'Recovery automation may not detect failure conditions in time.',
    affectedCapability: 'detection',
  },
  dead_letter_queue: {
    summary: 'Failed events are not retained for replay.',
    recoveryImplication: 'Recovery can lose failed work items that should be replayed after restoration.',
    affectedCapability: 'recovery',
  },
};

const RULE_ALIASES: Readonly<Record<string, CanonicalRuleId>> = {
  backup_configured: 'backup_configured',
  rds_backup_configured: 'backup_configured',
  aurora_backup_configured: 'backup_configured',
  backup_plan_exists: 'backup_configured',
  backup_retention_adequate: 'backup_configured',
  aurora_backup_retention_adequate: 'backup_configured',
  multi_az: 'multi_az',
  rds_multi_az_active: 'multi_az',
  aurora_multi_az: 'multi_az',
  ec2_multi_az: 'multi_az',
  efs_multi_az: 'multi_az',
  efs_mount_target_multi_az: 'multi_az',
  elb_multi_az: 'multi_az',
  eks_multi_az: 'multi_az',
  vpc_multi_az_subnets: 'multi_az',
  replication_configured: 'replication_configured',
  rds_replica_healthy: 'replication_configured',
  s3_replication_active: 'replication_configured',
  efs_replication_configured: 'replication_configured',
  cross_region_exists: 'replication_configured',
  dynamodb_global_table: 'replication_configured',
  aurora_global_database: 'replication_configured',
  failover_dns: 'failover_dns',
  route53_failover_configured: 'failover_dns',
  route53_ttl_appropriate: 'failover_dns',
  monitoring_configured: 'monitoring_configured',
  cloudwatch_alarm_exists: 'monitoring_configured',
  cloudwatch_alarm_actions: 'monitoring_configured',
  encryption_at_rest: 'encryption_at_rest',
  point_in_time_recovery: 'point_in_time_recovery',
  dynamodb_pitr_enabled: 'point_in_time_recovery',
  auto_scaling: 'auto_scaling',
  ec2_in_asg: 'auto_scaling',
  health_check: 'health_check',
  elb_health_check: 'health_check',
  route53_health_check: 'health_check',
  dead_letter_queue: 'dead_letter_queue',
  lambda_dlq_configured: 'dead_letter_queue',
  sqs_dlq_configured: 'dead_letter_queue',
};

export function resolveImpactTemplate(
  ruleId: string,
  role: ResourceRole,
  ruleName: string,
  category: DRCategory,
): ImpactTemplate {
  const canonicalRule = RULE_ALIASES[ruleId] ?? (ruleId as CanonicalRuleId | undefined);
  const specificRole = role === 'datastore' || role === 'compute' || role === 'storage' ? role : null;

  if (canonicalRule && specificRole && SPECIFIC_TEMPLATES[canonicalRule]?.[specificRole]) {
    return SPECIFIC_TEMPLATES[canonicalRule][specificRole];
  }

  if (canonicalRule && GENERIC_FALLBACKS[canonicalRule]) {
    return GENERIC_FALLBACKS[canonicalRule];
  }

  return {
    summary: `This resource does not meet the ${ruleName} requirement.`,
    recoveryImplication: `This impacts the service's ${category} capability and should be reviewed before a disaster event.`,
    affectedCapability: category as DRCapability,
  };
}

export function humanizeRuleId(ruleId: string): string {
  return ruleId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

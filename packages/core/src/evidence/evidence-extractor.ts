import { randomUUID } from 'node:crypto';

import { getMetadata } from '../graph/analysis-helpers.js';
import type {
  DRCategory,
  InfraNode,
  ValidationResult,
  ValidationRule,
} from '../validation/validation-types.js';
import { EVIDENCE_CONFIDENCE, type Evidence, type EvidenceType } from './evidence-types.js';

interface EvidenceHint {
  readonly key: string;
  readonly expected?: string;
  readonly location?: 'metadata' | 'details';
  readonly evidenceType?: EvidenceType;
}

const KEY_EXPECTATIONS: Readonly<Record<string, string>> = {
  actionsEnabled: 'true',
  alarmActions: 'at least one notification target',
  alarmCount: '> 0',
  asgId: 'managed by an Auto Scaling group',
  asgName: 'managed by an Auto Scaling group',
  automaticBackups: 'true',
  automaticFailover: 'enabled',
  automaticFailoverStatus: 'enabled',
  availabilityZones: 'at least two availability zones',
  backupPlanId: 'covered by an AWS Backup plan',
  backupPolicy: 'configured',
  backupRetentionDays: '> 0',
  backupRetentionPeriod: '> 0',
  crossZoneLoadBalancing: 'true',
  deadLetterConfig: 'configured',
  'deadLetterConfig.targetArn': 'configured',
  deadLetterTargetArn: 'configured',
  failover: 'PRIMARY and SECONDARY record pair',
  globalTable: 'true',
  globalTableVersion: 'configured',
  healthCheck: 'configured',
  'healthCheck.healthyThreshold': 'configured',
  'healthCheck.interval': 'configured',
  healthCheckId: 'configured',
  isMultiAZ: 'true',
  lastBackupTime: '<= 25 hours old',
  loadBalancingCrossZoneEnabled: 'true',
  multiAZ: 'true',
  multiAz: 'true',
  multi_az: 'true',
  natGatewayCount: '>= 2',
  pointInTimeRecovery: 'true',
  pointInTimeRecoveryEnabled: 'true',
  pitrEnabled: 'true',
  promotionTier: '<= 1',
  readReplicaDBInstanceIdentifiers: 'at least one healthy replica',
  readReplicaSourceDBInstanceIdentifier: 'null on primary instances',
  recordSets: 'PRIMARY and SECONDARY failover records',
  redrivePolicy: 'configured',
  replicaCount: '> 0',
  replicaIds: 'at least one replica',
  replicas: 'configured',
  replicationRules: 'at least one enabled replication rule',
  routingPolicy: 'failover-aware routing',
  subnetIds: 'at least two subnets',
  ttl: '<= 300',
  versioningStatus: 'Enabled',
};

const CATEGORY_FALLBACK_HINTS: Readonly<Record<DRCategory, readonly EvidenceHint[]>> = {
  backup: [
    { key: 'backupRetentionPeriod' },
    { key: 'backupRetentionDays' },
    { key: 'lastBackupTime', location: 'details', evidenceType: 'inferred' },
    { key: 'backupPlanId', location: 'details', evidenceType: 'inferred' },
    { key: 'versioningStatus' },
  ],
  redundancy: [
    { key: 'availabilityZones' },
    { key: 'multiAZ' },
    { key: 'natGatewayCount', location: 'details', evidenceType: 'inferred' },
  ],
  failover: [
    { key: 'multiAZ' },
    { key: 'healthCheckId' },
    { key: 'automaticFailover' },
    { key: 'failover', location: 'details', evidenceType: 'inferred' },
    { key: 'ttl' },
  ],
  detection: [
    { key: 'alarmCount', location: 'details', evidenceType: 'inferred' },
    { key: 'actionsEnabled' },
    { key: 'alarmActions' },
    { key: 'healthCheck' },
  ],
  recovery: [
    { key: 'asgId', location: 'details', evidenceType: 'inferred' },
    { key: 'deadLetterConfig.targetArn' },
    { key: 'deadLetterTargetArn' },
    { key: 'redrivePolicy' },
  ],
  replication: [
    { key: 'replicationRules' },
    { key: 'replicaIds', location: 'details', evidenceType: 'inferred' },
    { key: 'replicaCount', location: 'details', evidenceType: 'inferred' },
    { key: 'readReplicaDBInstanceIdentifiers' },
    { key: 'replicas' },
  ],
};

const RULE_HINTS: Readonly<Record<string, readonly EvidenceHint[]>> = {
  aurora_replica_exists: [
    { key: 'replicaCount', location: 'details', evidenceType: 'inferred' },
    { key: 'replicaIds', location: 'details', evidenceType: 'inferred' },
  ],
  backup_plan_exists: [{ key: 'backupPlanId', location: 'details', evidenceType: 'inferred' }],
  backup_recent: [{ key: 'lastBackupTime', location: 'details', evidenceType: 'inferred' }],
  cloudwatch_alarm_exists: [{ key: 'alarmCount', location: 'details', evidenceType: 'inferred' }],
  cross_region_exists: [{ key: 'replicaRegion', location: 'details', evidenceType: 'inferred' }],
  ec2_in_asg: [
    { key: 'asgId', location: 'details', evidenceType: 'inferred' },
    { key: 'asgName', location: 'details', evidenceType: 'inferred' },
  ],
  ec2_multi_az: [{ key: 'availabilityZones', location: 'details', evidenceType: 'inferred' }],
  efs_mount_target_multi_az: [
    { key: 'availabilityZones', location: 'details', evidenceType: 'inferred' },
  ],
  eks_multi_az: [{ key: 'availabilityZones', location: 'details', evidenceType: 'inferred' }],
  route53_failover_configured: [
    { key: 'failoverPairCount', location: 'details', evidenceType: 'inferred' },
    { key: 'recordSets', location: 'details', evidenceType: 'inferred' },
  ],
  vpc_multi_az_subnets: [
    { key: 'availabilityZones', location: 'details', evidenceType: 'inferred' },
  ],
  vpc_nat_redundancy: [{ key: 'natGatewayCount', location: 'details', evidenceType: 'inferred' }],
};

export function extractEvidence(
  rule: ValidationRule,
  node: InfraNode,
  result: ValidationResult,
  scanTimestamp: string,
): readonly Evidence[] {
  const metadata = getMetadata(node);
  const hints = resolveEvidenceHints(rule, result);

  const evidence = hints.map((hint) => {
    const value = resolveHintValue(hint, metadata, result.details);
    const evidenceType = hint.evidenceType ?? inferEvidenceType(hint, metadata);

    return {
      id: randomUUID(),
      type: evidenceType,
      source:
        evidenceType === 'inferred'
          ? {
              origin: 'inference',
              method: `validation-rule:${rule.id}`,
              confidence: EVIDENCE_CONFIDENCE[evidenceType],
            }
          : {
              origin: 'scan',
              scanTimestamp,
            },
      subject: {
        nodeId: node.id,
        ruleId: rule.id,
      },
      observation: {
        key: hint.key,
        value,
        ...(resolveExpectedValue(rule.id, hint.key)
          ? { expected: resolveExpectedValue(rule.id, hint.key) }
          : {}),
        description: buildObservationDescription(rule, result, hint.key, value, evidenceType),
      },
      timestamp: scanTimestamp,
    } satisfies Evidence;
  });

  return evidence.length > 0 ? evidence : [buildSyntheticEvidence(rule, node, result, scanTimestamp)];
}

function resolveEvidenceHints(
  rule: ValidationRule,
  result: ValidationResult,
): readonly EvidenceHint[] {
  if (rule.observedKeys && rule.observedKeys.length > 0) {
    return uniqueHints(
      rule.observedKeys.map((key) => ({
        key,
        location: 'metadata' as const,
      })),
    );
  }

  const mappedHints = RULE_HINTS[rule.id];
  if (mappedHints && mappedHints.length > 0) {
    return uniqueHints(mappedHints);
  }

  const detailKeys = Object.keys(result.details ?? {});
  if (detailKeys.length > 0) {
    return uniqueHints(
      detailKeys.map((key) => ({
        key,
        location: 'details' as const,
      })),
    );
  }

  return uniqueHints(CATEGORY_FALLBACK_HINTS[rule.category]);
}

function uniqueHints(hints: readonly EvidenceHint[]): readonly EvidenceHint[] {
  const seen = new Set<string>();
  const unique: EvidenceHint[] = [];

  for (const hint of hints) {
    const dedupeKey = `${hint.location ?? 'metadata'}:${hint.key}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    unique.push(hint);
  }

  return unique;
}

function resolveHintValue(
  hint: EvidenceHint,
  metadata: Record<string, unknown>,
  details?: Record<string, unknown>,
): unknown {
  const detailValue =
    hint.location === 'details' || hint.location === undefined
      ? readPath(details, hint.key)
      : undefined;
  if (detailValue !== undefined) {
    return detailValue;
  }

  const metadataValue = readPath(metadata, hint.key);
  if (metadataValue !== undefined) {
    return metadataValue;
  }

  return null;
}

function inferEvidenceType(
  hint: EvidenceHint,
  metadata: Record<string, unknown>,
): EvidenceType {
  if (hint.location === 'details' && readPath(metadata, hint.key) === undefined) {
    return 'inferred';
  }

  return 'observed';
}

function resolveExpectedValue(ruleId: string, key: string): string | undefined {
  const direct = KEY_EXPECTATIONS[key];
  if (direct) {
    return direct;
  }

  const terminalKey = key.split('.').at(-1);
  if (terminalKey && KEY_EXPECTATIONS[terminalKey]) {
    return KEY_EXPECTATIONS[terminalKey];
  }

  if (ruleId === 'route53_failover_configured') {
    return 'PRIMARY and SECONDARY Route53 records';
  }

  return undefined;
}

function buildObservationDescription(
  rule: ValidationRule,
  result: ValidationResult,
  key: string,
  value: unknown,
  evidenceType: EvidenceType,
): string {
  const prefix = evidenceType === 'inferred' ? 'Inferred' : 'Observed';
  return `${prefix} ${key}=${formatEvidenceValue(value)} while evaluating ${rule.name}. ${result.message}`;
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildSyntheticEvidence(
  rule: ValidationRule,
  node: InfraNode,
  result: ValidationResult,
  scanTimestamp: string,
): Evidence {
  return {
    id: randomUUID(),
    type: 'observed',
    source: {
      origin: 'scan',
      scanTimestamp,
    },
    subject: {
      nodeId: node.id,
      ruleId: rule.id,
    },
    observation: {
      key: 'validationStatus',
      value: result.status,
      description: `Observed validation status ${result.status} while evaluating ${rule.name}. ${result.message}`,
    },
    timestamp: scanTimestamp,
  };
}

function readPath(
  value: Record<string, unknown> | undefined,
  path: string,
): unknown {
  if (!value) {
    return undefined;
  }

  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

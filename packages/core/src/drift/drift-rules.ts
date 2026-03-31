import { NodeType } from '../types/index.js';
import {
  getMetadata,
  getReplicaCount,
  isMultiAzEnabled,
  readBoolean,
  readNumber,
  readString,
} from '../graph/analysis-helpers.js';
import type { DriftCategory, DriftChange, DriftSeverity, InfrastructureNode } from './drift-types.js';

/** Pure drift rule applied to the same resource across two snapshots. */
export interface DriftRule {
  readonly id: string;
  readonly category: DriftCategory;
  readonly severity: DriftSeverity;
  readonly description: string;
  check(previous: InfrastructureNode, current: InfrastructureNode): DriftChange | null;
}

const TRUE_STRINGS = new Set(['enabled', 'enabling', 'active', 'true', 'aes256', 'aws:kms']);
const FALSE_STRINGS = new Set(['disabled', 'disabling', 'inactive', 'false', 'none', 'null']);
const PUBLIC_SOURCES = new Set(['0.0.0.0/0', '::/0']);
const EMPTY_AFFECTED_SERVICES: readonly string[] = [];

function createChange(
  rule: DriftRule,
  node: InfrastructureNode,
  field: string,
  previousValue: unknown,
  currentValue: unknown,
  description: string,
  drImpact: string,
): DriftChange {
  return {
    id: `${rule.id}:${node.id}:${field}`,
    category: rule.category,
    severity: rule.severity,
    resourceId: node.id,
    resourceType: node.type,
    field,
    previousValue,
    currentValue,
    description,
    drImpact,
    affectedServices: EMPTY_AFFECTED_SERVICES,
  };
}

function hasKnownKeys(
  metadata: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => key in metadata && metadata[key] != null);
}

function readEnabledFlag(value: unknown): boolean | null {
  const booleanValue = readBoolean(value);
  if (booleanValue != null) return booleanValue;

  const normalized = readString(value)?.toLowerCase();
  if (!normalized) return null;
  if (TRUE_STRINGS.has(normalized)) return true;
  if (FALSE_STRINGS.has(normalized)) return false;
  return null;
}

function resolveBackupEnabled(node: InfrastructureNode): boolean | null {
  const metadata = getMetadata(node);
  const explicit =
    readEnabledFlag(metadata.backupEnabled) ??
    readEnabledFlag(metadata.backup_enabled) ??
    readEnabledFlag(metadata.backupsEnabled) ??
    readEnabledFlag(metadata.backups_enabled) ??
    readEnabledFlag(metadata.automatedBackupEnabled) ??
    readEnabledFlag(metadata.automated_backup_enabled) ??
    readEnabledFlag(metadata.automatedBackupsEnabled) ??
    readEnabledFlag(metadata.automated_backups_enabled) ??
    readEnabledFlag(metadata.pointInTimeRecovery) ??
    readEnabledFlag(metadata.point_in_time_recovery);
  if (explicit != null) return explicit;

  const retention =
    readNumber(metadata.backupRetentionPeriod) ??
    readNumber(metadata.backup_retention_period) ??
    readNumber(metadata.backupRetentionDays) ??
    readNumber(metadata.backup_retention_days);
  if (retention != null) return retention > 0;

  const pitrStatus =
    readEnabledFlag(metadata.pointInTimeRecoveryStatus) ??
    readEnabledFlag(metadata.point_in_time_recovery_status);
  if (pitrStatus != null) return pitrStatus;

  return hasKnownKeys(metadata, [
    'backupEnabled',
    'backup_enabled',
    'backupsEnabled',
    'backups_enabled',
    'automatedBackupEnabled',
    'automated_backup_enabled',
    'automatedBackupsEnabled',
    'automated_backups_enabled',
    'backupRetentionPeriod',
    'backup_retention_period',
    'backupRetentionDays',
    'backup_retention_days',
    'pointInTimeRecovery',
    'point_in_time_recovery',
    'pointInTimeRecoveryStatus',
    'point_in_time_recovery_status',
  ])
    ? false
    : null;
}

function resolveMultiAzEnabled(node: InfrastructureNode): boolean | null {
  const metadata = getMetadata(node);
  const keys = [
    'multiAZ',
    'multiAz',
    'multi_az',
    'isMultiAZ',
    'zoneRedundant',
    'zone_redundant',
    'availabilityType',
    'highAvailabilityMode',
    'tier',
    'replication',
  ];
  return hasKnownKeys(metadata, keys) ? isMultiAzEnabled(metadata) : null;
}

function resolveEncryptionEnabled(node: InfrastructureNode): boolean | null {
  const metadata = getMetadata(node);
  const explicit =
    readEnabledFlag(metadata.encrypted) ??
    readEnabledFlag(metadata.isEncrypted) ??
    readEnabledFlag(metadata.encryptionEnabled) ??
    readEnabledFlag(metadata.storageEncrypted) ??
    readEnabledFlag(metadata.serverSideEncryption) ??
    readEnabledFlag(metadata.atRestEncryptionEnabled) ??
    readEnabledFlag(metadata.kmsEnabled);
  if (explicit != null) return explicit;

  const encryptionMode =
    readString(metadata.encryption) ??
    readString(metadata.serverSideEncryptionType) ??
    readString(metadata.sseAlgorithm);
  if (encryptionMode) {
    return TRUE_STRINGS.has(encryptionMode.toLowerCase())
      ? true
      : FALSE_STRINGS.has(encryptionMode.toLowerCase())
        ? false
        : true;
  }

  return readString(metadata.kmsMasterKeyId)
    ? true
    : hasKnownKeys(metadata, [
        'encrypted',
        'isEncrypted',
        'encryptionEnabled',
        'storageEncrypted',
        'serverSideEncryption',
        'atRestEncryptionEnabled',
        'kmsEnabled',
        'encryption',
        'serverSideEncryptionType',
        'sseAlgorithm',
        'kmsMasterKeyId',
      ])
      ? false
      : null;
}

function resolveVersioningEnabled(node: InfrastructureNode): boolean | null {
  const metadata = getMetadata(node);
  const status =
    readEnabledFlag(metadata.versioningEnabled) ??
    readEnabledFlag(metadata.versioning) ??
    readEnabledFlag(metadata.versioningStatus);
  if (status != null) return status;

  return hasKnownKeys(metadata, ['versioningEnabled', 'versioning', 'versioningStatus'])
    ? false
    : null;
}

function resolveScalingConfig(
  node: InfrastructureNode,
): { min: number | null; max: number | null; desired: number | null } | null {
  const metadata = getMetadata(node);
  const min = readNumber(metadata.asgMinSize) ?? readNumber(metadata.minSize);
  const max = readNumber(metadata.asgMaxSize) ?? readNumber(metadata.maxSize);
  const desired =
    readNumber(metadata.asgDesiredCapacity) ?? readNumber(metadata.desiredCapacity);
  return min != null || max != null || desired != null ? { min, max, desired } : null;
}

function resolveZoneCoverage(node: InfrastructureNode): readonly string[] {
  const metadata = getMetadata(node);
  const zones = new Set<string>();
  const direct = readString(node.availabilityZone);
  if (direct) zones.add(direct);

  const candidates = [metadata.availabilityZones, metadata.asgAvailabilityZones];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      const zone = readString(entry);
      if (zone) zones.add(zone);
    }
  }

  const metadataZone = readString(metadata.availabilityZone) ?? readString(metadata.zone);
  if (metadataZone) zones.add(metadataZone);

  return Array.from(zones).sort();
}

function hasPublicIngress(node: InfrastructureNode): boolean | null {
  const metadata = getMetadata(node);
  const rules = metadata.inboundRules;
  if (!Array.isArray(rules)) return null;

  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
    const sources = (rule as { readonly sources?: unknown }).sources;
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      const normalized = readString(source);
      if (normalized && PUBLIC_SOURCES.has(normalized)) return true;
    }
  }

  return false;
}

const backupDisabledRule: DriftRule = {
  id: 'backup_disabled',
  category: 'backup_changed',
  severity: 'critical',
  description: 'Backup protection was disabled.',
  check(previous, current) {
    const before = resolveBackupEnabled(previous);
    const after = resolveBackupEnabled(current);
    if (before !== true || after !== false) return null;
    return createChange(
      backupDisabledRule,
      current,
      'backup',
      before,
      after,
      `Backup protection was disabled for ${current.name}.`,
      'Restore points may be missing or older than the DR objectives require.',
    );
  },
};

const multiAzDisabledRule: DriftRule = {
  id: 'multi_az_disabled',
  category: 'redundancy_changed',
  severity: 'critical',
  description: 'Multi-AZ or equivalent redundancy was removed.',
  check(previous, current) {
    const before = resolveMultiAzEnabled(previous);
    const after = resolveMultiAzEnabled(current);
    if (before !== true || after !== false) return null;
    return createChange(
      multiAzDisabledRule,
      current,
      'multi_az',
      before,
      after,
      `Multi-AZ redundancy was disabled for ${current.name}.`,
      'A zonal failure can now interrupt recovery and increase failover time.',
    );
  },
};

const replicaRemovedRule: DriftRule = {
  id: 'replica_removed',
  category: 'redundancy_changed',
  severity: 'high',
  description: 'One or more replicas were removed.',
  check(previous, current) {
    if (![NodeType.DATABASE, NodeType.CACHE].includes(current.type as NodeType)) return null;
    const before = getReplicaCount(getMetadata(previous));
    const after = getReplicaCount(getMetadata(current));
    if (before <= 0 || after >= before) return null;
    return createChange(
      replicaRemovedRule,
      current,
      'replicaCount',
      before,
      after,
      `Replica capacity decreased for ${current.name}.`,
      'Read scale and failover headroom are reduced, increasing recovery risk.',
    );
  },
};

const securityGroupOpenedRule: DriftRule = {
  id: 'security_group_opened',
  category: 'security_changed',
  severity: 'high',
  description: 'A security group was opened to the public internet.',
  check(previous, current) {
    if (current.type !== NodeType.FIREWALL) return null;
    const before = hasPublicIngress(previous);
    const after = hasPublicIngress(current);
    if (before !== false || after !== true) return null;
    return createChange(
      securityGroupOpenedRule,
      current,
      'inboundRules',
      before,
      after,
      `${current.name} now allows ingress from 0.0.0.0/0 or ::/0.`,
      'Recovery components are more exposed and may fail compliance or isolation checks.',
    );
  },
};

const scalingChangedRule: DriftRule = {
  id: 'scaling_changed',
  category: 'config_changed',
  severity: 'medium',
  description: 'Auto-scaling bounds changed.',
  check(previous, current) {
    const before = resolveScalingConfig(previous);
    const after = resolveScalingConfig(current);
    if (!before || !after) return null;
    const changed =
      before.min !== after.min || before.max !== after.max || before.desired !== after.desired;
    if (!changed) return null;
    return createChange(
      scalingChangedRule,
      current,
      'scaling',
      before,
      after,
      `Scaling bounds changed for ${current.name}.`,
      'Recovery capacity assumptions may no longer match the current runtime footprint.',
    );
  },
};

const crossAzLostRule: DriftRule = {
  id: 'cross_az_lost',
  category: 'network_changed',
  severity: 'high',
  description: 'A resource lost availability-zone coverage.',
  check(previous, current) {
    const before = resolveZoneCoverage(previous);
    const after = resolveZoneCoverage(current);
    if (before.length <= after.length || after.length === 0) return null;
    return createChange(
      crossAzLostRule,
      current,
      'availabilityZones',
      before,
      after,
      `${current.name} spans fewer availability zones than before.`,
      'Cross-AZ resilience is reduced, which can invalidate zonal failover assumptions.',
    );
  },
};

const encryptionDisabledRule: DriftRule = {
  id: 'encryption_disabled',
  category: 'security_changed',
  severity: 'critical',
  description: 'Encryption was disabled.',
  check(previous, current) {
    const before = resolveEncryptionEnabled(previous);
    const after = resolveEncryptionEnabled(current);
    if (before !== true || after !== false) return null;
    return createChange(
      encryptionDisabledRule,
      current,
      'encryption',
      before,
      after,
      `Encryption was disabled for ${current.name}.`,
      'Sensitive recovery data may no longer meet security or compliance requirements.',
    );
  },
};

const versioningDisabledRule: DriftRule = {
  id: 'versioning_disabled',
  category: 'backup_changed',
  severity: 'high',
  description: 'Object versioning was disabled.',
  check(previous, current) {
    if (current.type !== NodeType.OBJECT_STORAGE) return null;
    const before = resolveVersioningEnabled(previous);
    const after = resolveVersioningEnabled(current);
    if (before !== true || after !== false) return null;
    return createChange(
      versioningDisabledRule,
      current,
      'versioning',
      before,
      after,
      `Versioning was disabled for ${current.name}.`,
      'Rollback and object-level recovery become less reliable after accidental changes.',
    );
  },
};

const spofCreatedRule: DriftRule = {
  id: 'spof_created',
  category: 'redundancy_changed',
  severity: 'critical',
  description: 'The resource became a single point of failure.',
  check(previous, current) {
    const before = readBoolean(previous.isSPOF);
    const after = readBoolean(current.isSPOF);
    if (before !== false || after !== true) return null;
    return createChange(
      spofCreatedRule,
      current,
      'isSPOF',
      before,
      after,
      `${current.name} is now flagged as a single point of failure.`,
      'A failure on this component can now break recovery paths for dependent services.',
    );
  },
};

/** Default drift rules used by the core detector. */
export const DEFAULT_DRIFT_RULES: readonly DriftRule[] = [
  backupDisabledRule,
  multiAzDisabledRule,
  replicaRemovedRule,
  securityGroupOpenedRule,
  scalingChangedRule,
  crossAzLostRule,
  encryptionDisabledRule,
  versioningDisabledRule,
  spofCreatedRule,
];

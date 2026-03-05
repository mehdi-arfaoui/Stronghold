import { countKnownZones, hasAzureVmScaleSet } from '../recommendations/commonChecks.js';
import { readString, readStringFromKeys } from '../metadataUtils.js';
import {
  getDisplayName,
  getLocationDisplay,
  getServiceSubtitle,
  readMetadataBoolean,
  readMetadataNumber,
} from './helpers.js';
import type { RecommendationRuleNode, ResilienceRule } from './types.js';

const AZURE_RULE_COST_MULTIPLIERS = {
  vmZoneRedundant: 1.0,
  vmssAddZone: 0.15,
  sqlGeoReplication: 1.0,
  postgresHaZoneRedundant: 0.75,
  blobLrsToZrsOrGrs: 0.2,
  blobUnknownReplication: 0.25,
} as const;

function hasAzureSqlGeoReplication(metadata: Record<string, unknown>): boolean {
  const explicit = readMetadataBoolean(metadata, ['hasGeoReplication']);
  if (explicit != null) return explicit;

  if (readStringFromKeys(metadata, ['geoReplicaLocation', 'failoverGroupId'])) return true;

  const geoLinks = metadata.geoReplicationLinks;
  if (Array.isArray(geoLinks)) return geoLinks.length > 0;

  const geoLinksCount = readMetadataNumber(metadata, ['geoReplicationLinks']);
  return (geoLinksCount || 0) > 0;
}

function hasPostgresHaEnabled(metadata: Record<string, unknown>): boolean {
  const mode =
    readStringFromKeys(metadata, ['haMode', 'highAvailabilityMode', 'high_availability_mode']) ||
    null;
  if (mode) {
    const normalized = mode.toLowerCase();
    if (normalized.includes('disable')) return false;
    return true;
  }

  const highAvailability = metadata.highAvailability;
  if (highAvailability && typeof highAvailability === 'object' && !Array.isArray(highAvailability)) {
    const payload = highAvailability as Record<string, unknown>;
    const nestedMode = readString(payload.mode);
    if (!nestedMode) return false;
    return !nestedMode.toLowerCase().includes('disable');
  }
  return false;
}

function resolveStorageReplication(metadata: Record<string, unknown>): string {
  const direct =
    readStringFromKeys(metadata, ['replicationType', 'replication', 'skuName', 'sku', 'sku_name']) ||
    null;
  if (direct) return direct.toUpperCase();

  const sku = metadata.sku;
  if (sku && typeof sku === 'object' && !Array.isArray(sku)) {
    const nestedName = readString((sku as Record<string, unknown>).name);
    if (nestedName) return nestedName.toUpperCase();
  }
  return 'UNKNOWN';
}

function isResilientStorageReplication(replication: string): boolean {
  const normalized = replication.toUpperCase();
  return (
    normalized.includes('ZRS') ||
    normalized.includes('GRS') ||
    normalized.includes('RAGRS') ||
    normalized.includes('GZRS') ||
    normalized.includes('RAGZRS')
  );
}

export const azureRules: ResilienceRule[] = [
  {
    id: 'azure-vm-vmss-zone-redundant',
    provider: 'azure',
    kinds: ['vm', 'virtualMachineScaleSet'],
    criticalMetadata: [
      'vmssId|virtualMachineScaleSetId|virtualMachineScaleSet|vmssInstanceCount',
      'availabilityZones|zones|zone',
    ],
    appliesTo: (node) =>
      node.resolution.kind === 'vm' || node.resolution.kind === 'virtualMachineScaleSet',
    isSatisfied: (node) => {
      if (!hasAzureVmScaleSet(node.metadata)) return false;
      return countKnownZones(node.metadata) >= 2;
    },
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const subtitle = getServiceSubtitle(node);
      const zones = countKnownZones(node.metadata);
      const hasVmss = hasAzureVmScaleSet(node.metadata);
      const costDeltaMultiplier = hasVmss
        ? AZURE_RULE_COST_MULTIPLIERS.vmssAddZone
        : AZURE_RULE_COST_MULTIPLIERS.vmZoneRedundant;
      return {
        title: 'Azure VM/VMSS - zone redundancy',
        description: `${serviceName} (${subtitle}) doit etre execute dans un VMSS sur 2+ zones. Zones detectees: ${zones || 'inconnu'}.`,
        action: `Migrer ${serviceName} vers un VMSS zone-redundant (minimum 2 instances sur 2 zones).`,
        costDeltaMultiplier,
        strategy: 'warm_standby',
        newRTO: '15 min',
      };
    },
  },
  {
    id: 'azure-sql-active-geo-replication',
    provider: 'azure',
    kinds: ['sqlDatabase'],
    criticalMetadata: ['geoReplicaLocation|hasGeoReplication|geoReplicationLinks|failoverGroupId'],
    appliesTo: (node) => node.resolution.kind === 'sqlDatabase',
    isSatisfied: (node) => hasAzureSqlGeoReplication(node.metadata),
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const subtitle = getServiceSubtitle(node);
      return {
        title: 'Azure SQL Database - Active Geo-Replication',
        description: `${serviceName} (${subtitle}) doit disposer d une replique active sur une region secondaire.`,
        action: `Activer Active Geo-Replication (ou failover group) sur ${serviceName}.`,
        costDeltaMultiplier: AZURE_RULE_COST_MULTIPLIERS.sqlGeoReplication,
        strategy: 'hot_standby',
        newRTO: '5 min',
      };
    },
  },
  {
    id: 'azure-postgresql-flexible-zone-redundant-ha',
    provider: 'azure',
    kinds: ['postgresqlFlexible'],
    criticalMetadata: ['haMode|highAvailabilityMode|highAvailability'],
    appliesTo: (node) => node.resolution.kind === 'postgresqlFlexible',
    isSatisfied: (node) => hasPostgresHaEnabled(node.metadata),
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const location = getLocationDisplay(node);
      return {
        title: 'Azure PostgreSQL Flexible - Zone Redundant HA',
        description: `${serviceName} (${location}) doit activer le mode High Availability Zone Redundant.`,
        action: `Activer High Availability (Zone Redundant) sur ${serviceName}.`,
        costDeltaMultiplier: AZURE_RULE_COST_MULTIPLIERS.postgresHaZoneRedundant,
        strategy: 'warm_standby',
        newRTO: '5 min',
      };
    },
  },
  {
    id: 'azure-blob-lrs-to-zrs-grs',
    provider: 'azure',
    kinds: ['storageAccount'],
    criticalMetadata: ['replication|replicationType|skuName|sku'],
    appliesTo: (node) => node.resolution.kind === 'storageAccount',
    isSatisfied: (node) => isResilientStorageReplication(resolveStorageReplication(node.metadata)),
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const replication = resolveStorageReplication(node.metadata);
      const costDeltaMultiplier =
        replication === 'UNKNOWN'
          ? AZURE_RULE_COST_MULTIPLIERS.blobUnknownReplication
          : AZURE_RULE_COST_MULTIPLIERS.blobLrsToZrsOrGrs;
      return {
        title: 'Azure Blob Storage - replication resilience',
        description: `${serviceName} utilise une replication ${replication}. Cible recommandee: ZRS/GRS pour la resilience inter-zone/inter-region.`,
        action: `Migrer ${serviceName} de LRS vers ZRS ou GRS selon l objectif de reprise.`,
        costDeltaMultiplier,
        strategy: 'backup_restore',
        newRTO: '60 min',
      };
    },
  },
];

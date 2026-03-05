import { countKnownZones, hasGcpManagedInstanceGroup } from '../recommendations/commonChecks.js';
import { readStringFromKeys } from '../metadataUtils.js';
import { getDisplayName, getServiceSubtitle } from './helpers.js';
import type { ResilienceRule } from './types.js';

const GCP_RULE_COST_MULTIPLIERS = {
  computeMigRegional: 1.0,
  computeMigAddZone: 0.12,
  cloudSqlRegionalHa: 1.0,
  memorystoreStandardHa: 0.85,
  storageDualOrMultiRegion: 0.2,
} as const;

function cloudSqlAvailabilityType(metadata: Record<string, unknown>): string {
  return (
    readStringFromKeys(metadata, ['availabilityType', 'availability_type', 'settingsAvailabilityType']) ||
    'UNKNOWN'
  )
    .toUpperCase()
    .trim();
}

function memorystoreTier(metadata: Record<string, unknown>): string {
  return (readStringFromKeys(metadata, ['tier', 'redisTier', 'redis_tier']) || 'UNKNOWN')
    .toUpperCase()
    .trim();
}

function inferStorageLocationType(location: string): string {
  const normalized = location.trim().toUpperCase();
  if (normalized === 'US' || normalized === 'EU' || normalized === 'ASIA') return 'multi-region';
  if (normalized.includes('+')) return 'dual-region';
  if (/^[A-Z]{2,6}\d$/.test(normalized)) return 'dual-region';
  return 'region';
}

function cloudStorageLocationType(metadata: Record<string, unknown>): string {
  const explicit = readStringFromKeys(metadata, ['locationType', 'location_type']);
  if (explicit) return explicit.toLowerCase().trim();

  const location = readStringFromKeys(metadata, ['location']);
  if (!location) return 'unknown';
  return inferStorageLocationType(location);
}

function isResilientStorageLocationType(locationType: string): boolean {
  return locationType === 'dual-region' || locationType === 'multi-region';
}

export const gcpRules: ResilienceRule[] = [
  {
    id: 'gcp-compute-mig-multi-zone',
    provider: 'gcp',
    kinds: ['computeEngine'],
    criticalMetadata: [
      'instanceGroupManager|managedInstanceGroup|instanceGroupSize',
      'availabilityZones|zones|zone|locations|nodePoolLocations',
    ],
    appliesTo: (node) => node.resolution.kind === 'computeEngine',
    isSatisfied: (node) => hasGcpManagedInstanceGroup(node.metadata) && countKnownZones(node.metadata) >= 2,
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const subtitle = getServiceSubtitle(node);
      const zones = countKnownZones(node.metadata);
      const hasMig = hasGcpManagedInstanceGroup(node.metadata);
      const costDeltaMultiplier = hasMig
        ? GCP_RULE_COST_MULTIPLIERS.computeMigAddZone
        : GCP_RULE_COST_MULTIPLIERS.computeMigRegional;
      return {
        title: 'GCP Compute Engine - MIG multi-zone',
        description: `${serviceName} (${subtitle}) doit etre protege par un Managed Instance Group regional sur 2+ zones. Zones detectees: ${zones || 'inconnu'}.`,
        action: `Configurer ${serviceName} dans un MIG regional (minimum 2 instances sur 2 zones).`,
        costDeltaMultiplier,
        strategy: 'warm_standby',
        newRTO: '15 min',
      };
    },
  },
  {
    id: 'gcp-cloud-sql-regional-ha',
    provider: 'gcp',
    kinds: ['cloudSQL'],
    criticalMetadata: ['availabilityType|availability_type|settingsAvailabilityType'],
    appliesTo: (node) => node.resolution.kind === 'cloudSQL',
    isSatisfied: (node) => cloudSqlAvailabilityType(node.metadata) === 'REGIONAL',
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const subtitle = getServiceSubtitle(node);
      return {
        title: 'GCP Cloud SQL - High Availability REGIONAL',
        description: `${serviceName} (${subtitle}) doit etre configure en haute disponibilite regionale.`,
        action: `Activer availability_type=REGIONAL sur ${serviceName} pour activer le failover inter-zone.`,
        costDeltaMultiplier: GCP_RULE_COST_MULTIPLIERS.cloudSqlRegionalHa,
        strategy: 'hot_standby',
        newRTO: '5 min',
      };
    },
  },
  {
    id: 'gcp-memorystore-standard-ha',
    provider: 'gcp',
    kinds: ['memorystore'],
    criticalMetadata: ['tier|redisTier|redis_tier'],
    appliesTo: (node) => node.resolution.kind === 'memorystore',
    isSatisfied: (node) => memorystoreTier(node.metadata).includes('STANDARD_HA'),
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const subtitle = getServiceSubtitle(node);
      const tier = memorystoreTier(node.metadata);
      return {
        title: 'GCP Memorystore - STANDARD_HA',
        description: `${serviceName} (${subtitle}) est actuellement sur le tier ${tier}.`,
        action: `Migrer ${serviceName} vers le tier STANDARD_HA pour activer la replication et le failover.`,
        costDeltaMultiplier: GCP_RULE_COST_MULTIPLIERS.memorystoreStandardHa,
        strategy: 'warm_standby',
        newRTO: '3 min',
      };
    },
  },
  {
    id: 'gcp-cloud-storage-dual-multi-region',
    provider: 'gcp',
    kinds: ['cloudStorage'],
    criticalMetadata: ['locationType|location_type|location'],
    appliesTo: (node) => node.resolution.kind === 'cloudStorage',
    isSatisfied: (node) => isResilientStorageLocationType(cloudStorageLocationType(node.metadata)),
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const subtitle = getServiceSubtitle(node);
      const locationType = cloudStorageLocationType(node.metadata);
      return {
        title: 'GCP Cloud Storage - dual/multi-region',
        description: `${serviceName} (${subtitle}) utilise le mode ${locationType}.`,
        action: `Migrer ${serviceName} vers un bucket dual-region ou multi-region.`,
        costDeltaMultiplier: GCP_RULE_COST_MULTIPLIERS.storageDualOrMultiRegion,
        strategy: 'backup_restore',
        newRTO: '60 min',
      };
    },
  },
];

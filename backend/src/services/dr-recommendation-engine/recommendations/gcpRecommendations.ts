import type { DrStrategyKey } from '../../../constants/dr-financial-reference-data.js';
import type {
  CloudServiceResolution,
  CriticalityLevel,
  DrProviderAdapter,
  IncidentProbabilityResult,
  ServiceRecommendationBuildInput,
  ServiceRecommendationText,
} from '../types.js';
import {
  countKnownZones,
  hasGcpManagedInstanceGroup,
  readReplicaCount,
} from './commonChecks.js';
import {
  readPositiveNumberFromKeys,
  readString,
  readStringArray,
  readStringFromKeys,
} from '../metadataUtils.js';

function strongest(left: DrStrategyKey, right: DrStrategyKey): DrStrategyKey {
  const order: Record<DrStrategyKey, number> = {
    backup_restore: 1,
    pilot_light: 2,
    warm_standby: 3,
    hot_standby: 4,
    active_active: 5,
  };
  return order[left] >= order[right] ? left : right;
}

function cloudSqlAvailabilityType(metadata: Record<string, unknown>): string {
  return (
    readString(metadata.availabilityType) ??
    readString(metadata.availability_type) ??
    readString(metadata.settingsAvailabilityType) ??
    'UNKNOWN'
  )
    .toUpperCase()
    .trim();
}

function cloudStorageLocationType(metadata: Record<string, unknown>): string {
  return (readString(metadata.locationType) ?? readString(metadata.location_type) ?? 'region')
    .toLowerCase()
    .trim();
}

function memorystoreTier(metadata: Record<string, unknown>): string {
  return (
    readString(metadata.tier) ??
    readString(metadata.redisTier) ??
    readString(metadata.redis_tier) ??
    'BASIC'
  )
    .toUpperCase()
    .trim();
}

function gkeIsSingleZone(metadata: Record<string, unknown>): boolean {
  const location = readString(metadata.location);
  const locations = readStringArray(metadata.locations);
  const nodePoolLocations = readStringArray(metadata.nodePoolLocations);
  const zonesCount = new Set([...locations, ...nodePoolLocations]).size;
  const hasRegionalLocation = Boolean(location && /^\w+-\w+\d+$/.test(location));

  if (zonesCount > 1) return false;
  if (location && !hasRegionalLocation) return true;
  return zonesCount <= 1;
}

function bigtableClusterCount(metadata: Record<string, unknown>): number {
  return (
    readPositiveNumberFromKeys(metadata, [
      'clusterCount',
      'clustersCount',
      'clusters',
      'replicaCount',
    ]) || 1
  );
}

function resolveGcpFloor(
  criticality: CriticalityLevel,
  defaultFloor: DrStrategyKey,
  resolution: CloudServiceResolution,
): DrStrategyKey | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'computeEngine') {
    if (!hasGcpManagedInstanceGroup(metadata)) {
      return strongest(defaultFloor, criticality === 'critical' ? 'warm_standby' : 'pilot_light');
    }
    const zones = countKnownZones(metadata);
    if (zones <= 1) {
      return strongest(defaultFloor, 'backup_restore');
    }
  }

  if (resolution.kind === 'cloudSQL') {
    const availabilityType = cloudSqlAvailabilityType(metadata);
    if (availabilityType !== 'REGIONAL') {
      return strongest(defaultFloor, criticality === 'critical' ? 'warm_standby' : 'pilot_light');
    }
  }

  if (resolution.kind === 'memorystore') {
    if (memorystoreTier(metadata) === 'BASIC') {
      return strongest(defaultFloor, 'pilot_light');
    }
  }

  if (resolution.kind === 'cloudStorage') {
    if (cloudStorageLocationType(metadata) === 'region') {
      return 'backup_restore';
    }
  }

  if (
    resolution.kind === 'cloudFunctions' ||
    resolution.kind === 'firestore' ||
    resolution.kind === 'pubsub' ||
    resolution.kind === 'cloudTasks'
  ) {
    return 'backup_restore';
  }

  if (resolution.kind === 'bigTable' && bigtableClusterCount(metadata) <= 1) {
    return strongest(defaultFloor, 'pilot_light');
  }

  if (resolution.kind === 'gke' && gkeIsSingleZone(metadata)) {
    return strongest(defaultFloor, criticality === 'critical' ? 'warm_standby' : 'pilot_light');
  }

  return null;
}

function resolveGcpNativeCostFactor(
  _strategy: DrStrategyKey,
  resolution: CloudServiceResolution,
): number | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'computeEngine') {
    if (!hasGcpManagedInstanceGroup(metadata)) return 1.0;
    const zones = countKnownZones(metadata);
    return zones <= 1 ? 0.1 : 0;
  }

  if (resolution.kind === 'cloudSQL') {
    const availabilityType = cloudSqlAvailabilityType(metadata);
    if (availabilityType !== 'REGIONAL') return 1.0;
    if (readReplicaCount(metadata) <= 0) return 0.2;
    return 0.1;
  }

  if (resolution.kind === 'memorystore') {
    if (memorystoreTier(metadata) === 'BASIC') return 1.0;
    return 0.1;
  }

  if (resolution.kind === 'cloudStorage') {
    if (cloudStorageLocationType(metadata) === 'region') return 0.25;
    return 0.1;
  }

  if (
    resolution.kind === 'cloudFunctions' ||
    resolution.kind === 'firestore' ||
    resolution.kind === 'pubsub' ||
    resolution.kind === 'cloudTasks'
  ) {
    return 0;
  }

  if (resolution.kind === 'bigTable') {
    return bigtableClusterCount(metadata) <= 1 ? 1.0 : 0.1;
  }

  if (resolution.kind === 'gke') {
    return gkeIsSingleZone(metadata) ? 1.0 : 0.2;
  }

  return null;
}

function resolveGcpIncidentProbability(
  resolution: CloudServiceResolution,
): IncidentProbabilityResult | null {
  const metadata = resolution.metadata;

  if (
    resolution.kind === 'cloudFunctions' ||
    resolution.kind === 'firestore' ||
    resolution.kind === 'pubsub' ||
    resolution.kind === 'cloudTasks'
  ) {
    return {
      key: 'cloud_region',
      probabilityAnnual: resolution.kind === 'cloudFunctions' ? 0.001 : 0.005,
      source: 'Default ARO GCP managed service profile',
    };
  }

  if (resolution.kind === 'cloudStorage') {
    return {
      key: 'cloud_region',
      probabilityAnnual: cloudStorageLocationType(metadata) === 'region' ? 0.01 : 0.003,
      source: 'Default ARO GCP Cloud Storage profile',
    };
  }

  if (resolution.kind === 'cloudSQL') {
    return {
      key: 'database',
      probabilityAnnual: cloudSqlAvailabilityType(metadata) === 'REGIONAL' ? 0.02 : 0.05,
      source: 'Default ARO GCP Cloud SQL profile',
    };
  }

  if (resolution.kind === 'memorystore') {
    return {
      key: 'infrastructure',
      probabilityAnnual: memorystoreTier(metadata) === 'BASIC' ? 0.08 : 0.04,
      source: 'Default ARO GCP Memorystore profile',
    };
  }

  if (resolution.kind === 'bigTable') {
    return {
      key: 'database',
      probabilityAnnual: bigtableClusterCount(metadata) <= 1 ? 0.06 : 0.03,
      source: 'Default ARO GCP Bigtable profile',
    };
  }

  if (resolution.kind === 'gke') {
    return {
      key: 'infrastructure',
      probabilityAnnual: gkeIsSingleZone(metadata) ? 0.08 : 0.04,
      source: 'Default ARO GCP GKE profile',
    };
  }

  if (resolution.kind === 'computeEngine') {
    const zones = countKnownZones(metadata);
    return {
      key: 'infrastructure',
      probabilityAnnual: hasGcpManagedInstanceGroup(metadata) && zones >= 2 ? 0.04 : 0.1,
      source: 'Default ARO GCP compute profile',
    };
  }

  return null;
}

function buildGcpRecommendation(input: ServiceRecommendationBuildInput): ServiceRecommendationText | null {
  const metadata = input.resolution.metadata;

  if (input.resolution.kind === 'computeEngine') {
    if (!hasGcpManagedInstanceGroup(metadata)) {
      const action =
        'Creer un Managed Instance Group (MIG) regional avec minimum 2 instances sur 2+ zones.';
      const resilienceImpact =
        'Autoscaling et autohealing integres avec suppression du SPOF instance/zone.';
      return {
        action,
        resilienceImpact,
        text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
      };
    }

    const zones = countKnownZones(metadata);
    if (zones <= 1) {
      const action =
        'Etendre le Managed Instance Group vers un scope regional sur au moins 2 zones.';
      const resilienceImpact =
        'Reduit la dependance a une zone unique avec un cout principalement de configuration.';
      return {
        action,
        resilienceImpact,
        text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
      };
    }
  }

  if (input.resolution.kind === 'cloudSQL' && cloudSqlAvailabilityType(metadata) !== 'REGIONAL') {
    const action =
      `Activer la haute disponibilite regionale (availability_type=REGIONAL) sur ${input.serviceName}.`;
    const resilienceImpact =
      'Replica synchrone inter-zone et failover automatique geres par Cloud SQL.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'memorystore' && memorystoreTier(metadata) === 'BASIC') {
    const action = 'Migrer Memorystore du tier BASIC vers STANDARD_HA.';
    const resilienceImpact =
      'Replication cross-zone automatique avec failover integre en cas de panne du primaire.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'cloudStorage' && cloudStorageLocationType(metadata) === 'region') {
    const action = 'Passer Cloud Storage de single-region vers dual-region ou multi-region.';
    const resilienceImpact =
      'Ameliore la disponibilite des donnees et reduit le risque de perte regionale.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'bigTable' && bigtableClusterCount(metadata) <= 1) {
    const action =
      'Ajouter un second cluster Bigtable dans une autre zone pour activer la replication.';
    const resilienceImpact =
      'Supprime le SPOF cluster unique et permet une meilleure continuite de service.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'gke' && gkeIsSingleZone(metadata)) {
    const action =
      'Migrer vers un cluster GKE regional avec node pools repartis sur 2+ zones.';
    const resilienceImpact =
      'Control plane multi-zone et meilleure resilence des workloads Kubernetes.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (
    input.resolution.kind === 'cloudFunctions' ||
    input.resolution.kind === 'firestore' ||
    input.resolution.kind === 'pubsub' ||
    input.resolution.kind === 'cloudTasks'
  ) {
    const action =
      'Aucune infrastructure DR lourde requise; conserver les mecanismes natifs de resilience GCP.';
    const resilienceImpact =
      'Service gere, multi-zone/global par conception pour la plupart des cas.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  return null;
}

export const gcpProviderAdapter: DrProviderAdapter = {
  lookupEstimatedMonthlyUsd: () => null,
  resolveFloorStrategy: resolveGcpFloor,
  resolveNativeCostFactor: resolveGcpNativeCostFactor,
  resolveIncidentProbability: resolveGcpIncidentProbability,
  buildRecommendation: buildGcpRecommendation,
};

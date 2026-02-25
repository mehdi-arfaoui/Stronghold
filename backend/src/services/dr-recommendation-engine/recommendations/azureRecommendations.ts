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
  hasAzureVmScaleSet,
  isMultiAzEnabled,
  readReplicaCount,
} from './commonChecks.js';
import {
  readNumber,
  readPositiveNumberFromKeys,
  readString,
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

function hasGeoReplication(metadata: Record<string, unknown>): boolean {
  const failoverGroupId = readString(metadata.failoverGroupId);
  if (failoverGroupId) return true;

  const replicationLinks = metadata.geoReplicationLinks;
  if (Array.isArray(replicationLinks)) return replicationLinks.length > 0;

  const linksCount = readNumber(metadata.geoReplicationLinks);
  return (linksCount || 0) > 0;
}

function hasFlexibleHaEnabled(metadata: Record<string, unknown>): boolean {
  const highAvailability =
    metadata.highAvailability && typeof metadata.highAvailability === 'object' && !Array.isArray(metadata.highAvailability)
      ? (metadata.highAvailability as Record<string, unknown>)
      : {};
  const mode = String(
    readString(metadata.highAvailabilityMode) ??
      readString(metadata.high_availability_mode) ??
      readString(highAvailability.mode),
  )
    .toLowerCase()
    .trim();

  if (!mode) return false;
  return !mode.includes('disable');
}

function redisTier(metadata: Record<string, unknown>): string {
  const sku = (
    readStringFromKeys(metadata, ['sku_name', 'skuName', 'sku', 'tier']) || ''
  ).toLowerCase();
  if (sku.includes('basic')) return 'basic';
  if (sku.includes('standard')) return 'standard';
  if (sku.includes('premium')) return 'premium';
  return 'unknown';
}

function storageReplication(metadata: Record<string, unknown>): string {
  return (
    readString(metadata.replication) ??
    readString(metadata.replicationType) ??
    readString(metadata.skuName) ??
    readString(metadata.sku) ??
    'unknown'
  )
    .toUpperCase()
    .trim();
}

function aksNodeCount(metadata: Record<string, unknown>): number {
  return (
    readPositiveNumberFromKeys(metadata, [
      'agentPoolNodeCount',
      'nodeCount',
      'count',
      'agentPoolProfilesCount',
    ]) || 0
  );
}

function resolveAzureFloor(
  criticality: CriticalityLevel,
  defaultFloor: DrStrategyKey,
  resolution: CloudServiceResolution,
): DrStrategyKey | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'vm' || resolution.kind === 'virtualMachineScaleSet') {
    if (!hasAzureVmScaleSet(metadata)) {
      return strongest(defaultFloor, criticality === 'critical' ? 'warm_standby' : 'pilot_light');
    }
    const zones = countKnownZones(metadata);
    if (zones <= 1) {
      return strongest(defaultFloor, 'backup_restore');
    }
  }

  if (resolution.kind === 'sqlDatabase') {
    if (!isMultiAzEnabled(metadata) && !hasGeoReplication(metadata)) {
      return strongest(defaultFloor, criticality === 'critical' ? 'warm_standby' : 'pilot_light');
    }
  }

  if (resolution.kind === 'postgresqlFlexible' || resolution.kind === 'mysqlFlexible') {
    if (!hasFlexibleHaEnabled(metadata)) {
      return strongest(defaultFloor, criticality === 'critical' || criticality === 'high' ? 'warm_standby' : 'pilot_light');
    }
  }

  if (resolution.kind === 'redis') {
    if (redisTier(metadata) === 'basic') {
      return strongest(defaultFloor, 'pilot_light');
    }
  }

  if (resolution.kind === 'storageAccount') {
    const replication = storageReplication(metadata);
    if (replication.includes('LRS')) return 'backup_restore';
  }

  if (resolution.kind === 'functions' || resolution.kind === 'eventGrid') {
    return 'backup_restore';
  }

  if (resolution.kind === 'aks') {
    const nodeCount = aksNodeCount(metadata);
    const zones = countKnownZones(metadata);
    if (nodeCount <= 1 || zones <= 1) {
      return strongest(defaultFloor, criticality === 'critical' ? 'warm_standby' : 'pilot_light');
    }
  }

  return null;
}

function resolveAzureNativeCostFactor(
  _strategy: DrStrategyKey,
  resolution: CloudServiceResolution,
): number | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'vm' || resolution.kind === 'virtualMachineScaleSet') {
    if (!hasAzureVmScaleSet(metadata)) return 1.0;
    const zones = countKnownZones(metadata);
    const availabilitySet = readString(metadata.availabilitySetId);
    if (availabilitySet && zones <= 1) return 0;
    return zones >= 2 ? 0 : 0.1;
  }

  if (resolution.kind === 'sqlDatabase') {
    if (isMultiAzEnabled(metadata)) return 0;
    if (hasGeoReplication(metadata)) return 1.0;
    return 0.5;
  }

  if (resolution.kind === 'postgresqlFlexible' || resolution.kind === 'mysqlFlexible') {
    if (!hasFlexibleHaEnabled(metadata)) return 1.0;
    return 0.1;
  }

  if (resolution.kind === 'redis') {
    const tier = redisTier(metadata);
    if (tier === 'basic') return 1.0;
    if (tier === 'standard' && !isMultiAzEnabled(metadata)) return 0.5;
    return 0.1;
  }

  if (resolution.kind === 'storageAccount') {
    const replication = storageReplication(metadata);
    if (replication.includes('LRS')) return 0.25;
    return 0.05;
  }

  if (resolution.kind === 'functions' || resolution.kind === 'eventGrid') return 0;
  if (resolution.kind === 'cosmosdb' || resolution.kind === 'serviceBus') return 0.3;

  if (resolution.kind === 'aks') {
    const nodeCount = aksNodeCount(metadata);
    const zones = countKnownZones(metadata);
    if (nodeCount <= 1 || zones <= 1) return 1.0;
    return 0.2;
  }

  return null;
}

function resolveAzureIncidentProbability(
  resolution: CloudServiceResolution,
): IncidentProbabilityResult | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'functions' || resolution.kind === 'eventGrid') {
    return {
      key: 'cloud_region',
      probabilityAnnual: 0.001,
      source: 'Default ARO Azure managed serverless/event service',
    };
  }

  if (resolution.kind === 'storageAccount') {
    const replication = storageReplication(metadata);
    return {
      key: 'cloud_region',
      probabilityAnnual: replication.includes('LRS') ? 0.01 : 0.003,
      source: 'Default ARO Azure Storage profile',
    };
  }

  if (resolution.kind === 'sqlDatabase' || resolution.kind === 'postgresqlFlexible' || resolution.kind === 'mysqlFlexible') {
    const haEnabled =
      resolution.kind === 'sqlDatabase'
        ? isMultiAzEnabled(metadata) || hasGeoReplication(metadata)
        : hasFlexibleHaEnabled(metadata);
    return {
      key: 'database',
      probabilityAnnual: haEnabled ? 0.02 : 0.05,
      source: 'Default ARO Azure relational database profile',
    };
  }

  if (resolution.kind === 'redis') {
    return {
      key: 'infrastructure',
      probabilityAnnual: redisTier(metadata) === 'basic' ? 0.08 : 0.04,
      source: 'Default ARO Azure Cache for Redis profile',
    };
  }

  if (resolution.kind === 'cosmosdb' || resolution.kind === 'serviceBus') {
    return {
      key: 'cloud_region',
      probabilityAnnual: 0.005,
      source: 'Default ARO Azure managed data/messaging profile',
    };
  }

  if (resolution.kind === 'aks') {
    const nodeCount = aksNodeCount(metadata);
    const zones = countKnownZones(metadata);
    return {
      key: 'infrastructure',
      probabilityAnnual: nodeCount <= 1 || zones <= 1 ? 0.08 : 0.04,
      source: 'Default ARO Azure AKS profile',
    };
  }

  if (resolution.kind === 'vm' || resolution.kind === 'virtualMachineScaleSet') {
    const zones = countKnownZones(metadata);
    return {
      key: 'infrastructure',
      probabilityAnnual: hasAzureVmScaleSet(metadata) && zones >= 2 ? 0.04 : 0.1,
      source: 'Default ARO Azure VM profile',
    };
  }

  return null;
}

function buildAzureRecommendation(input: ServiceRecommendationBuildInput): ServiceRecommendationText | null {
  const metadata = input.resolution.metadata;

  if (input.resolution.kind === 'vm' || input.resolution.kind === 'virtualMachineScaleSet') {
    if (!hasAzureVmScaleSet(metadata)) {
      const action =
        'Deployer un Virtual Machine Scale Set (VMSS) avec minimum 2 instances reparties sur au moins 2 Availability Zones.';
      const resilienceImpact =
        'Failover automatique gere par Azure et suppression du SPOF VM/AZ.';
      return {
        action,
        resilienceImpact,
        text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
      };
    }

    const zones = countKnownZones(metadata);
    if (zones <= 1) {
      const action =
        'Migrer la capacite VM vers un VMSS zone-redundant (2+ zones) sans changer le dimensionnement cible.';
      const resilienceImpact =
        'Reduit le risque de panne locale AZ via une modification de configuration principalement.';
      return {
        action,
        resilienceImpact,
        text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
      };
    }
  }

  if (input.resolution.kind === 'sqlDatabase' && !isMultiAzEnabled(metadata) && !hasGeoReplication(metadata)) {
    const action =
      `Activer la zone redundancy ou un failover group sur ${input.serviceName} pour eliminer le SPOF base de donnees.`;
    const resilienceImpact =
      'Azure maintient une reprise automatique inter-zone/region selon le mode choisi.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (
    (input.resolution.kind === 'postgresqlFlexible' || input.resolution.kind === 'mysqlFlexible') &&
    !hasFlexibleHaEnabled(metadata)
  ) {
    const action =
      `Activer le mode High Availability Zone Redundant sur ${input.serviceName}.`;
    const resilienceImpact =
      'Replica standby synchrone dans une autre AZ avec failover automatique en environ 60 secondes.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'redis' && redisTier(metadata) === 'basic') {
    const action =
      'Migrer du tier Basic vers le tier Standard Azure Cache for Redis (replication incluse).';
    const resilienceImpact =
      'Ajoute la replication automatique et supprime le SPOF du noeud cache unique.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'storageAccount' && storageReplication(metadata).includes('LRS')) {
    const action =
      'Passer le Storage Account de LRS vers ZRS (ou GRS selon objectif multi-region).';
    const resilienceImpact =
      'Replication automatique des donnees sur plusieurs zones et reduction du risque de perte locale.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'aks') {
    const nodeCount = aksNodeCount(metadata);
    const zones = countKnownZones(metadata);
    if (nodeCount <= 1 || zones <= 1) {
      const action =
        'Configurer le cluster AKS avec des node pools repartis sur 2+ Availability Zones et min_count=2.';
      const resilienceImpact =
        'Elimine le SPOF node pool single-zone et ameliore la disponibilite applicative.';
      return {
        action,
        resilienceImpact,
        text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
      };
    }
  }

  if (
    input.resolution.kind === 'functions' ||
    input.resolution.kind === 'eventGrid' ||
    input.resolution.kind === 'cosmosdb' ||
    input.resolution.kind === 'serviceBus'
  ) {
    const action =
      'Aucune infrastructure DR lourde requise; prioriser les options de resilience natives du service Azure.';
    const resilienceImpact =
      input.resolution.kind === 'cosmosdb'
        ? 'Optionnel: activer multi-region writes pour une posture DR avancee.'
        : 'Le service est gere par Azure, une configuration de resilience suffit.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  return null;
}

export const azureProviderAdapter: DrProviderAdapter = {
  lookupEstimatedMonthlyUsd: () => null,
  resolveFloorStrategy: resolveAzureFloor,
  resolveNativeCostFactor: resolveAzureNativeCostFactor,
  resolveIncidentProbability: resolveAzureIncidentProbability,
  buildRecommendation: buildAzureRecommendation,
};

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
  hasAwsAutoScalingGroup,
  hasDeadLetterQueue,
  isMultiAzEnabled,
  readReplicaCount,
} from './commonChecks.js';

function strongest(
  left: DrStrategyKey,
  right: DrStrategyKey,
): DrStrategyKey {
  const order: Record<DrStrategyKey, number> = {
    backup_restore: 1,
    pilot_light: 2,
    warm_standby: 3,
    hot_standby: 4,
    active_active: 5,
  };
  return order[left] >= order[right] ? left : right;
}

function resolveAwsFloor(
  criticality: CriticalityLevel,
  defaultFloor: DrStrategyKey,
  resolution: CloudServiceResolution,
): DrStrategyKey | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'rds' && !isMultiAzEnabled(metadata)) {
    return strongest(defaultFloor, 'warm_standby');
  }
  if (resolution.kind === 'elasticache' && readReplicaCount(metadata) <= 0) {
    return strongest(defaultFloor, 'pilot_light');
  }
  if (resolution.kind === 'ec2' && !hasAwsAutoScalingGroup(metadata)) {
    return strongest(defaultFloor, criticality === 'critical' ? 'warm_standby' : 'pilot_light');
  }

  if (
    resolution.kind === 'lambda' ||
    resolution.kind === 'dynamodb' ||
    resolution.kind === 's3' ||
    resolution.kind === 'sqs' ||
    resolution.kind === 'sns'
  ) {
    return 'backup_restore';
  }

  return null;
}

function resolveAwsNativeCostFactor(
  _strategy: DrStrategyKey,
  resolution: CloudServiceResolution,
): number | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'ec2') {
    if (hasAwsAutoScalingGroup(metadata)) {
      const zones = countKnownZones(metadata);
      return zones >= 2 ? 0 : 0.1;
    }
    return 1.0;
  }
  if (resolution.kind === 'rds') {
    if (!isMultiAzEnabled(metadata)) return 1.0;
    return 0.1;
  }
  if (resolution.kind === 'elasticache') {
    if (readReplicaCount(metadata) <= 0) return 1.0;
    return 0.1;
  }
  if (
    resolution.kind === 'lambda' ||
    resolution.kind === 'dynamodb' ||
    resolution.kind === 'sns' ||
    resolution.kind === 'sqs'
  ) {
    return 0;
  }
  if (resolution.kind === 's3') {
    return 0.25;
  }
  return null;
}

function resolveAwsIncidentProbability(
  resolution: CloudServiceResolution,
): IncidentProbabilityResult | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'lambda') {
    return {
      key: 'cloud_region',
      probabilityAnnual: 0.001,
      source: 'Default ARO AWS Lambda managed service',
    };
  }
  if (resolution.kind === 's3') {
    return {
      key: 'cloud_region',
      probabilityAnnual: 0.0001,
      source: 'Default ARO AWS S3 managed object storage',
    };
  }
  if (resolution.kind === 'dynamodb' || resolution.kind === 'sqs' || resolution.kind === 'sns') {
    return {
      key: 'cloud_region',
      probabilityAnnual: 0.005,
      source: 'Default ARO AWS managed messaging/database service',
    };
  }
  if (resolution.kind === 'rds') {
    return {
      key: 'database',
      probabilityAnnual: isMultiAzEnabled(metadata) || readReplicaCount(metadata) > 0 ? 0.02 : 0.05,
      source: 'Default ARO AWS RDS profile',
    };
  }
  if (resolution.kind === 'elasticache') {
    return {
      key: 'infrastructure',
      probabilityAnnual: readReplicaCount(metadata) > 0 ? 0.04 : 0.08,
      source: 'Default ARO AWS ElastiCache profile',
    };
  }
  if (resolution.kind === 'ec2') {
    return {
      key: 'infrastructure',
      probabilityAnnual: hasAwsAutoScalingGroup(metadata) ? 0.04 : 0.1,
      source: 'Default ARO AWS compute profile',
    };
  }
  return null;
}

function buildAwsRecommendation(input: ServiceRecommendationBuildInput): ServiceRecommendationText | null {
  const metadata = input.resolution.metadata;

  if (input.resolution.kind === 'ec2') {
    if (!hasAwsAutoScalingGroup(metadata)) {
      const action =
        'Creer un Auto Scaling Group avec min_size=2 et repartir les instances sur au moins 2 Availability Zones.';
      const resilienceImpact =
        'Supprime le SPOF instance/AZ et permet un redemarrage automatique en cas de panne.';
      return {
        action,
        resilienceImpact,
        text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
      };
    }

    const action =
      'Etendre la distribution de l Auto Scaling Group sur 2+ Availability Zones (sans changer la capacite cible).';
    const resilienceImpact =
      'Reduit le risque de panne liee a une seule AZ avec impact cout quasi nul.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'rds' && !isMultiAzEnabled(metadata)) {
    const action = `Activer l option Multi-AZ sur ${input.serviceName}.`;
    const resilienceImpact =
      'AWS maintient un replica synchrone dans une autre AZ avec bascule automatique.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'elasticache' && readReplicaCount(metadata) <= 0) {
    const action =
      `Migrer ${input.serviceName} vers un Replication Group ElastiCache avec au moins 1 replica dans une autre AZ.`;
    const resilienceImpact =
      'Permet un failover automatique en quelques secondes en cas de perte du noeud primaire.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'sqs' && !hasDeadLetterQueue(metadata)) {
    const action =
      `Configurer une Dead Letter Queue (DLQ) pour ${input.serviceName} avec un redrive policy explicite.`;
    const resilienceImpact =
      'Evite la perte silencieuse de messages et accelere la reprise des incidents applicatifs.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (
    input.resolution.kind === 'lambda' ||
    input.resolution.kind === 'dynamodb' ||
    input.resolution.kind === 'sns' ||
    input.resolution.kind === 'sqs' ||
    input.resolution.kind === 's3'
  ) {
    const action =
      'Aucune infrastructure DR lourde requise; conserver les mecanismes natifs du service manage.';
    const resilienceImpact =
      input.resolution.kind === 's3'
        ? 'Optionnel: activer la replication cross-region si un objectif multi-region est requis.'
        : 'Le service est multi-AZ par conception, une optimisation de configuration suffit.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  return null;
}

export const awsProviderAdapter: DrProviderAdapter = {
  lookupEstimatedMonthlyUsd: () => null,
  resolveFloorStrategy: resolveAwsFloor,
  resolveNativeCostFactor: resolveAwsNativeCostFactor,
  resolveIncidentProbability: resolveAwsIncidentProbability,
  buildRecommendation: buildAwsRecommendation,
};

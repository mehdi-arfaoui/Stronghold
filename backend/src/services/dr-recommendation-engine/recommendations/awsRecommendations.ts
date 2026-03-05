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
import { readPositiveNumberFromKeys, readStringFromKeys } from '../metadataUtils.js';

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

function strategyFactor(
  strategy: DrStrategyKey,
  factors: Record<DrStrategyKey, number>,
): number {
  return factors[strategy];
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
  strategy: DrStrategyKey,
  resolution: CloudServiceResolution,
): number | null {
  const metadata = resolution.metadata;

  if (resolution.kind === 'ec2') {
    const singleInstanceFactors: Record<DrStrategyKey, number> = {
      backup_restore: 0.08,
      pilot_light: 0.22,
      warm_standby: 0.4,
      hot_standby: 0.65,
      active_active: 0.85,
    };
    const zonalAsgFactors: Record<DrStrategyKey, number> = {
      backup_restore: 0.04,
      pilot_light: 0.12,
      warm_standby: 0.28,
      hot_standby: 0.45,
      active_active: 0.75,
    };

    if (hasAwsAutoScalingGroup(metadata)) {
      const zones = countKnownZones(metadata);
      return zones >= 2 ? 0 : strategyFactor(strategy, zonalAsgFactors);
    }
    return strategyFactor(strategy, singleInstanceFactors);
  }
  if (resolution.kind === 'rds') {
    const singleAzFactors: Record<DrStrategyKey, number> = {
      backup_restore: 0.08,
      pilot_light: 0.2,
      warm_standby: 0.45,
      hot_standby: 0.7,
      active_active: 0.9,
    };
    const resilientFactors: Record<DrStrategyKey, number> = {
      backup_restore: 0.03,
      pilot_light: 0.08,
      warm_standby: 0.18,
      hot_standby: 0.35,
      active_active: 0.8,
    };
    if (!isMultiAzEnabled(metadata) && readReplicaCount(metadata) <= 0) {
      return strategyFactor(strategy, singleAzFactors);
    }
    return strategyFactor(strategy, resilientFactors);
  }
  if (resolution.kind === 'elasticache') {
    const singleNodeFactors: Record<DrStrategyKey, number> = {
      backup_restore: 0.05,
      pilot_light: 0.15,
      warm_standby: 0.35,
      hot_standby: 0.55,
      active_active: 0.8,
    };
    const resilientFactors: Record<DrStrategyKey, number> = {
      backup_restore: 0.02,
      pilot_light: 0.05,
      warm_standby: 0.12,
      hot_standby: 0.25,
      active_active: 0.7,
    };
    if (readReplicaCount(metadata) <= 0) return strategyFactor(strategy, singleNodeFactors);
    return strategyFactor(strategy, resilientFactors);
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
    const s3Factors: Record<DrStrategyKey, number> = {
      backup_restore: 0.05,
      pilot_light: 0.08,
      warm_standby: 0.14,
      hot_standby: 0.2,
      active_active: 0.35,
    };
    return strategyFactor(strategy, s3Factors);
  }
  if (resolution.kind === 'alb' || resolution.kind === 'apiGateway') {
    const ingressFactors: Record<DrStrategyKey, number> = {
      backup_restore: 0.05,
      pilot_light: 0.12,
      warm_standby: 0.25,
      hot_standby: 0.4,
      active_active: 0.7,
    };
    return strategyFactor(strategy, ingressFactors);
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
    const instanceType =
      readStringFromKeys(metadata, ['instanceType', 'instance_type', 'vmSize']) || 'instance';
    const availabilityZone =
      readStringFromKeys(metadata, ['availabilityZone', 'availability_zone']) || 'AZ inconnue';
    if (!hasAwsAutoScalingGroup(metadata)) {
      const action =
        `Deployer ${input.serviceName} (${instanceType}, ${availabilityZone}) dans un Auto Scaling Group min=2 sur 2+ Availability Zones.`;
      const resilienceImpact =
        'Supprime le SPOF instance/AZ et permet un redemarrage automatique en cas de panne.';
      return {
        action,
        resilienceImpact,
        text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
      };
    }

    const currentZones = Math.max(
      countKnownZones(metadata),
      readPositiveNumberFromKeys(metadata, ['asgAZCount']) || 0,
    );
    const action =
      `Etendre l Auto Scaling Group de ${input.serviceName} sur 2+ Availability Zones (etat actuel: ${currentZones || 1} zone).`;
    const resilienceImpact =
      'Reduit le risque de panne liee a une seule AZ avec impact cout quasi nul.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'rds' && !isMultiAzEnabled(metadata)) {
    const engine = readStringFromKeys(metadata, ['engine', 'databaseEngine']) || 'database';
    const instanceClass =
      readStringFromKeys(metadata, ['dbInstanceClass', 'instanceClass', 'instanceType']) || 'instance';
    const availabilityZone =
      readStringFromKeys(metadata, ['availabilityZone', 'availability_zone']) || 'AZ inconnue';
    const action =
      `Activer Multi-AZ sur ${input.serviceName} (RDS ${engine} ${instanceClass}, ${availabilityZone}).`;
    const resilienceImpact =
      'AWS maintient un replica synchrone dans une autre AZ avec bascule automatique (~60s).';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${input.monthlyLabel}.`,
    };
  }

  if (input.resolution.kind === 'elasticache' && readReplicaCount(metadata) <= 0) {
    const cacheNodeType =
      readStringFromKeys(metadata, ['cacheNodeType', 'instanceType', 'nodeType']) || 'cache node';
    const action =
      `Ajouter un replica multi-AZ pour ${input.serviceName} (${cacheNodeType}).`;
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

import {
  countKnownZones,
  hasAwsAutoScalingGroup,
  isMultiAzEnabled,
  readReplicaCount,
} from '../recommendations/commonChecks.js';
import { readString, readStringFromKeys } from '../metadataUtils.js';
import {
  getDisplayName,
  getEngineDisplay,
  getLocationDisplay,
  getServiceSubtitle,
  readMetadataBoolean,
  readMetadataNumber,
} from './helpers.js';
import type { RecommendationRuleNode, ResilienceRule } from './types.js';

const AWS_RULE_COST_MULTIPLIERS = {
  ec2AsgCreate: 1.0,
  ec2AsgScaleUp: 0.9,
  ec2AsgAddAz: 0.15,
  rdsMultiAz: 1.0,
  elasticacheReplicaFailover: 0.65,
  elasticacheFailoverOnly: 0.2,
  s3CrossRegionReplication: 0.25,
  dynamodbPitr: 0.2,
} as const;

function resolveAsgMinSize(metadata: Record<string, unknown>): number | null {
  return readMetadataNumber(metadata, ['asgMinSize', 'minSize', 'asgDesiredCapacity', 'desiredCapacity']);
}

function resolveAsgAzCount(metadata: Record<string, unknown>): number | null {
  const explicitCount = readMetadataNumber(metadata, ['asgAZCount']);
  if (explicitCount != null) return explicitCount;

  const knownZones = countKnownZones(metadata);
  if (knownZones > 0) return knownZones;

  const asgAvailabilityZones = metadata.asgAvailabilityZones;
  if (!Array.isArray(asgAvailabilityZones)) return null;
  const zones = asgAvailabilityZones
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
  return zones.length > 0 ? new Set(zones).size : null;
}

function hasS3CrossRegionReplication(metadata: Record<string, unknown>): boolean {
  const explicit = readMetadataBoolean(metadata, ['hasCrossRegionReplication', 'crossRegionReplication']);
  if (explicit === true) return true;

  const replicationRules = readMetadataNumber(metadata, ['replicationRules']);
  if (replicationRules != null && replicationRules > 0) return true;

  const replicationConfiguration = metadata.replicationConfiguration;
  if (replicationConfiguration && typeof replicationConfiguration === 'object') {
    return true;
  }
  return false;
}

function isAutomaticFailoverEnabled(metadata: Record<string, unknown>): boolean | null {
  const explicit = readMetadataBoolean(metadata, [
    'automaticFailover',
    'multiAZEnabled',
    'multiAZ',
    'multi_az',
  ]);
  if (explicit != null) return explicit;

  const status = readString(metadata.automaticFailoverStatus);
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized.includes('enabled') || normalized.includes('enabling')) return true;
  if (normalized.includes('disabled') || normalized.includes('disabling')) return false;
  return null;
}

function elasticacheReplicaCount(metadata: Record<string, unknown>): number {
  const replicas = readReplicaCount(metadata);
  if (replicas > 0) return replicas;

  const memberClusters = readMetadataNumber(metadata, ['memberClusters']);
  if (memberClusters != null && memberClusters > 1) return memberClusters - 1;
  return 0;
}

function isDynamoPitrEnabled(metadata: Record<string, unknown>): boolean {
  const explicit = readMetadataBoolean(metadata, ['pointInTimeRecovery']);
  if (explicit != null) return explicit;

  const status = readString(metadata.pointInTimeRecoveryStatus);
  if (!status) return false;
  const normalized = status.toUpperCase();
  return normalized === 'ENABLED' || normalized === 'ENABLING';
}

function isRedisLikeEngine(node: RecommendationRuleNode): boolean {
  const engine = readStringFromKeys(node.metadata, ['engine', 'cacheEngine']);
  if (!engine) return true;
  const normalized = engine.toLowerCase();
  return normalized.includes('redis') || normalized.includes('valkey');
}

export const awsRules: ResilienceRule[] = [
  {
    id: 'aws-ec2-asg-multi-az',
    provider: 'aws',
    kinds: ['ec2'],
    criticalMetadata: [
      'asgMinSize|minSize|asgDesiredCapacity|desiredCapacity',
      'asgAZCount|asgAvailabilityZones|availabilityZones|availabilityZone',
    ],
    appliesTo: (node) => node.resolution.kind === 'ec2',
    isSatisfied: (node) => {
      const metadata = node.metadata;
      if (!hasAwsAutoScalingGroup(metadata)) return false;
      const minSize = resolveAsgMinSize(metadata);
      const azCount = resolveAsgAzCount(metadata);
      if (minSize == null || azCount == null) return false;
      return minSize >= 2 && azCount >= 2;
    },
    generate: (node) => {
      const metadata = node.metadata;
      const serviceName = getDisplayName(node);
      const subtitle = getServiceSubtitle(node);
      const minSize = resolveAsgMinSize(metadata);
      const azCount = resolveAsgAzCount(metadata);
      const hasAsg = hasAwsAutoScalingGroup(metadata);

      let costDeltaMultiplier: number = AWS_RULE_COST_MULTIPLIERS.ec2AsgCreate;
      if (hasAsg && (azCount || 0) >= 2 && (minSize || 0) < 2) {
        costDeltaMultiplier = AWS_RULE_COST_MULTIPLIERS.ec2AsgScaleUp;
      } else if (hasAsg && (azCount || 0) < 2 && (minSize || 0) >= 2) {
        costDeltaMultiplier = AWS_RULE_COST_MULTIPLIERS.ec2AsgAddAz;
      }

      const action = `Configurer ${serviceName} (${subtitle}) avec un Auto Scaling Group min=2 sur au moins 2 Availability Zones.`;
      const description = `Etat detecte: ASG=${hasAsg ? 'oui' : 'non'}, minSize=${minSize ?? 'inconnu'}, AZ=${azCount ?? 'inconnu'}. Cette action supprime le SPOF compute.`;
      return {
        title: 'AWS EC2 - haute disponibilite ASG multi-AZ',
        description,
        action,
        costDeltaMultiplier,
        strategy: 'warm_standby',
        newRTO: '15 min',
      };
    },
  },
  {
    id: 'aws-rds-multi-az',
    provider: 'aws',
    kinds: ['rds'],
    criticalMetadata: ['multiAZ|multiAz|multi_az|isMultiAZ', 'readReplicaCount|replicaCount|readReplicas'],
    appliesTo: (node) => node.resolution.kind === 'rds',
    isSatisfied: (node) => isMultiAzEnabled(node.metadata) || readReplicaCount(node.metadata) > 0,
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const engine = getEngineDisplay(node);
      const location = getLocationDisplay(node);
      const instanceType = getServiceSubtitle(node).split(' - ')[0] || 'type inconnu';
      return {
        title: 'AWS RDS/Aurora - Multi-AZ',
        description: `${serviceName} (${engine}, ${instanceType}, ${location}) est actuellement sans protection Multi-AZ explicite.`,
        action: `Activer Multi-AZ sur ${serviceName} (${instanceType}, ${location}) avec bascule automatique inter-AZ.`,
        costDeltaMultiplier: AWS_RULE_COST_MULTIPLIERS.rdsMultiAz,
        strategy: 'warm_standby',
        newRTO: '5 min',
      };
    },
  },
  {
    id: 'aws-elasticache-redis-failover',
    provider: 'aws',
    kinds: ['elasticache'],
    criticalMetadata: [
      'replicaCount|readReplicaCount|memberClusters',
      'automaticFailover|automaticFailoverStatus|multiAZEnabled',
    ],
    appliesTo: (node) => node.resolution.kind === 'elasticache' && isRedisLikeEngine(node),
    isSatisfied: (node) => {
      const replicaCount = elasticacheReplicaCount(node.metadata);
      const automaticFailover = isAutomaticFailoverEnabled(node.metadata);
      return replicaCount > 0 && automaticFailover === true;
    },
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const subtitle = getServiceSubtitle(node);
      const replicaCount = elasticacheReplicaCount(node.metadata);
      const automaticFailover = isAutomaticFailoverEnabled(node.metadata);
      const needsReplica = replicaCount <= 0;
      const needsFailover = automaticFailover !== true;
      const costDeltaMultiplier =
        needsReplica && needsFailover
          ? AWS_RULE_COST_MULTIPLIERS.elasticacheReplicaFailover
          : AWS_RULE_COST_MULTIPLIERS.elasticacheFailoverOnly;
      return {
        title: 'AWS ElastiCache Redis - replica + automatic failover',
        description: `${serviceName} (${subtitle}) doit disposer d au moins un replica et d un failover automatique.`,
        action: `Ajouter un replica multi-AZ et activer automatic failover sur ${serviceName}.`,
        costDeltaMultiplier,
        strategy: 'hot_standby',
        newRTO: '2 min',
      };
    },
  },
  {
    id: 'aws-s3-cross-region-replication',
    provider: 'aws',
    kinds: ['s3'],
    criticalMetadata: ['versioningStatus', 'hasCrossRegionReplication|replicationRules|replicationConfiguration'],
    appliesTo: (node) => node.resolution.kind === 's3',
    isSatisfied: (node) => hasS3CrossRegionReplication(node.metadata),
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const location = getLocationDisplay(node);
      const versioningStatus = readString(node.metadata.versioningStatus) || 'inconnu';
      return {
        title: 'AWS S3 - Cross-Region Replication',
        description: `${serviceName} (${location}) doit activer Versioning + CRR pour une reprise inter-region. Versioning actuel: ${versioningStatus}.`,
        action: `Activer le versioning puis configurer la Cross-Region Replication pour ${serviceName}.`,
        costDeltaMultiplier: AWS_RULE_COST_MULTIPLIERS.s3CrossRegionReplication,
        strategy: 'backup_restore',
        newRTO: '60 min',
      };
    },
  },
  {
    id: 'aws-dynamodb-pitr',
    provider: 'aws',
    kinds: ['dynamodb'],
    criticalMetadata: ['pointInTimeRecovery|pointInTimeRecoveryStatus'],
    appliesTo: (node) => node.resolution.kind === 'dynamodb',
    isSatisfied: (node) => isDynamoPitrEnabled(node.metadata),
    generate: (node) => {
      const serviceName = getDisplayName(node);
      const location = getLocationDisplay(node);
      return {
        title: 'AWS DynamoDB - Point-in-Time Recovery',
        description: `${serviceName} (${location}) doit disposer du Point-in-Time Recovery pour restaurer une table a un instant donne.`,
        action: `Activer Point-in-Time Recovery (PITR) sur ${serviceName}.`,
        costDeltaMultiplier: AWS_RULE_COST_MULTIPLIERS.dynamodbPitr,
        strategy: 'backup_restore',
        newRTO: '30 min',
      };
    },
  },
];

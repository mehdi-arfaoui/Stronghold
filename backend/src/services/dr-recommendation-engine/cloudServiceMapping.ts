import { asRecord, includesAnyToken, readString, readStringArray } from './metadataUtils.js';
import type { CloudProvider, CloudServiceCategory, CloudServiceResolution } from './types.js';

export const CLOUD_SERVICE_MAPPING = {
  compute: {
    aws: ['ec2', 'instance'],
    azure: ['vm', 'virtualmachine', 'virtualmachinescaleset'],
    gcp: ['computeengine', 'gce', 'instance'],
  },
  database_relational: {
    aws: ['rds', 'aurora'],
    azure: ['sqldatabase', 'postgresqlflexible', 'mysqlflexible'],
    gcp: ['cloudsql', 'spanner'],
  },
  database_nosql: {
    aws: ['dynamodb'],
    azure: ['cosmosdb'],
    gcp: ['firestore', 'bigtable'],
  },
  cache: {
    aws: ['elasticache'],
    azure: ['redis', 'azurecache'],
    gcp: ['memorystore'],
  },
  storage: {
    aws: ['s3', 'bucket'],
    azure: ['storageaccount', 'blob'],
    gcp: ['cloudstorage', 'bucket'],
  },
  serverless: {
    aws: ['lambda'],
    azure: ['functions', 'azurefunctions'],
    gcp: ['cloudfunctions', 'cloudrun'],
  },
  messaging: {
    aws: ['sqs', 'sns'],
    azure: ['servicebus', 'eventgrid', 'eventhub'],
    gcp: ['pubsub', 'cloudtasks'],
  },
  kubernetes: {
    aws: ['eks'],
    azure: ['aks'],
    gcp: ['gke'],
  },
  loadbalancer: {
    aws: ['alb', 'nlb', 'elb'],
    azure: ['applicationgateway', 'loadbalancer', 'frontdoor'],
    gcp: ['httploadbalancer', 'networkloadbalancer'],
  },
} as const;

const CATEGORY_ORDER: Array<Exclude<CloudServiceCategory, 'unknown'>> = [
  'compute',
  'database_relational',
  'database_nosql',
  'cache',
  'storage',
  'serverless',
  'messaging',
  'kubernetes',
  'loadbalancer',
];

function normalizeString(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s/_-]+/g, '');
}

function normalizeProviderToken(value: string | null | undefined): CloudProvider {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'aws') return 'aws';
  if (normalized === 'azure') return 'azure';
  if (normalized === 'gcp' || normalized === 'google' || normalized === 'google_cloud') return 'gcp';
  return 'other';
}

function buildDescriptors(nodeType: string, metadata: Record<string, unknown>): string[] {
  const keysToScan = [
    'sourceType',
    'source',
    'awsService',
    'subType',
    'displayName',
    'resourceType',
    'serviceType',
    'serviceName',
    'kind',
    'engine',
    'databaseVersion',
    'sku',
    'skuName',
    'tier',
    'availabilityType',
    'replication',
  ];
  const descriptors = new Set<string>();
  descriptors.add(normalizeString(nodeType));
  for (const key of keysToScan) {
    descriptors.add(normalizeString(metadata[key]));
  }

  for (const arrayKey of ['locations', 'availabilityZones']) {
    for (const value of readStringArray(metadata[arrayKey])) {
      descriptors.add(normalizeString(value));
    }
  }

  return Array.from(descriptors).filter((item) => item.length > 0);
}

function detectCategory(
  provider: CloudProvider,
  descriptors: string[],
  nodeType: string,
): CloudServiceCategory {
  if (provider !== 'other') {
    for (const category of CATEGORY_ORDER) {
      const providerTokens = CLOUD_SERVICE_MAPPING[category][provider];
      if (includesAnyToken(descriptors, providerTokens)) {
        return category;
      }
    }
  }

  const normalizedType = normalizeString(nodeType);
  if (normalizedType === 'vm' || normalizedType === 'physicalserver') return 'compute';
  if (normalizedType === 'database') return 'database_relational';
  if (normalizedType === 'cache') return 'cache';
  if (normalizedType === 'objectstorage' || normalizedType === 'filestorage') return 'storage';
  if (normalizedType === 'serverless') return 'serverless';
  if (normalizedType === 'messagequeue') return 'messaging';
  if (normalizedType === 'kubernetescluster' || normalizedType === 'kubernetesservice' || normalizedType === 'kubernetespod') {
    return 'kubernetes';
  }
  if (normalizedType === 'loadbalancer' || normalizedType === 'apigateway') return 'loadbalancer';
  return 'unknown';
}

function detectAwsKind(descriptors: string[]): string {
  if (includesAnyToken(descriptors, ['dynamodb'])) return 'dynamodb';
  if (includesAnyToken(descriptors, ['elasticache', 'redis', 'memcache'])) return 'elasticache';
  if (includesAnyToken(descriptors, ['lambda'])) return 'lambda';
  if (includesAnyToken(descriptors, ['rds', 'aurora'])) return 'rds';
  if (includesAnyToken(descriptors, ['s3', 'bucket'])) return 's3';
  if (includesAnyToken(descriptors, ['sqs', 'queue'])) return 'sqs';
  if (includesAnyToken(descriptors, ['sns', 'topic'])) return 'sns';
  if (includesAnyToken(descriptors, ['eks'])) return 'eks';
  if (includesAnyToken(descriptors, ['ec2', 'instance'])) return 'ec2';
  return 'other';
}

function detectAzureKind(descriptors: string[]): string {
  if (includesAnyToken(descriptors, ['postgresqlflexible', 'dbforpostgresql'])) return 'postgresqlFlexible';
  if (includesAnyToken(descriptors, ['mysqlflexible', 'dbformysql'])) return 'mysqlFlexible';
  if (includesAnyToken(descriptors, ['sqldatabase', 'microsoftsqlserversdatabases', 'azuresqldatabase'])) return 'sqlDatabase';
  if (includesAnyToken(descriptors, ['redis', 'azurecache'])) return 'redis';
  if (includesAnyToken(descriptors, ['storageaccount', 'blob', 'microsoftstorage'])) return 'storageAccount';
  if (includesAnyToken(descriptors, ['function', 'azurefunctions'])) return 'functions';
  if (includesAnyToken(descriptors, ['cosmosdb'])) return 'cosmosdb';
  if (includesAnyToken(descriptors, ['servicebus'])) return 'serviceBus';
  if (includesAnyToken(descriptors, ['eventgrid'])) return 'eventGrid';
  if (includesAnyToken(descriptors, ['aks', 'containerservice'])) return 'aks';
  if (includesAnyToken(descriptors, ['virtualmachinescaleset', 'vmss'])) return 'virtualMachineScaleSet';
  if (includesAnyToken(descriptors, ['virtualmachine', 'vm'])) return 'vm';
  return 'other';
}

function detectGcpKind(descriptors: string[]): string {
  if (includesAnyToken(descriptors, ['cloudsql'])) return 'cloudSQL';
  if (includesAnyToken(descriptors, ['memorystore', 'redis'])) return 'memorystore';
  if (includesAnyToken(descriptors, ['cloudstorage', 'storage', 'bucket'])) return 'cloudStorage';
  if (includesAnyToken(descriptors, ['cloudfunction', 'cloudfunctions', 'cloudrun'])) return 'cloudFunctions';
  if (includesAnyToken(descriptors, ['bigtable'])) return 'bigTable';
  if (includesAnyToken(descriptors, ['firestore'])) return 'firestore';
  if (includesAnyToken(descriptors, ['pubsub'])) return 'pubsub';
  if (includesAnyToken(descriptors, ['cloudtasks'])) return 'cloudTasks';
  if (includesAnyToken(descriptors, ['gke', 'kubernetesengine'])) return 'gke';
  if (includesAnyToken(descriptors, ['computeengine', 'gce', 'instance'])) return 'computeEngine';
  return 'other';
}

function detectKind(provider: CloudProvider, descriptors: string[]): string {
  if (provider === 'aws') return detectAwsKind(descriptors);
  if (provider === 'azure') return detectAzureKind(descriptors);
  if (provider === 'gcp') return detectGcpKind(descriptors);
  return 'other';
}

export function resolveCloudProvider(provider: string | null | undefined): CloudProvider {
  return normalizeProviderToken(provider);
}

export function resolveCloudServiceResolution(options: {
  provider?: string | null;
  nodeType: string;
  metadata?: unknown;
}): CloudServiceResolution {
  const provider = normalizeProviderToken(options.provider);
  const metadata = asRecord(options.metadata);
  const descriptors = buildDescriptors(options.nodeType, metadata);
  const category = detectCategory(provider, descriptors, options.nodeType);
  const kind = detectKind(provider, descriptors);

  return {
    provider,
    category,
    kind,
    nodeType: String(options.nodeType || '').toUpperCase(),
    sourceType: String(metadata.sourceType || ''),
    metadata,
    descriptors,
  };
}

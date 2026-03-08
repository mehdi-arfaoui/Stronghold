import type { DemoCompanySizeKey, DemoSectorKey } from '../config/demo-profiles.js';

export interface DemoInfraNodeDef {
  id: string;
  externalId: string;
  name: string;
  type: string;
  provider: string;
  region?: string;
  availabilityZone?: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
}

export interface DemoInfraEdgeDef {
  sourceId: string;
  targetId: string;
  type: string;
  confidence?: number;
  inferenceMethod?: string;
  confirmed?: boolean;
}

export type DemoInfrastructureLayerName =
  | 'core'
  | 'microservices'
  | 'resilience'
  | 'dr'
  | 'multi_region'
  | 'legacy_extended';

export type DemoInfrastructureGenerationParams = {
  sector: DemoSectorKey;
  companySize: DemoCompanySizeKey;
};

export type DemoInfrastructureSeed = {
  layers: DemoInfrastructureLayerName[];
  nodes: DemoInfraNodeDef[];
  confirmedEdges: DemoInfraEdgeDef[];
  inferredEdges: DemoInfraEdgeDef[];
  spofNodeIds: string[];
};

type DemoLayerContribution = {
  nodes: DemoInfraNodeDef[];
  confirmedEdges: DemoInfraEdgeDef[];
  inferredEdges?: DemoInfraEdgeDef[];
};

type GenericLabelKey =
  | 'main-app'
  | 'payment-service'
  | 'user-service'
  | 'order-service'
  | 'catalog-service'
  | 'notification-svc'
  | 'analytics-service'
  | 'admin-dashboard'
  | 'search-service'
  | 'legacy-erp'
  | 'main-db'
  | 'payment-db'
  | 'user-db'
  | 'order-db';

type DemoProtectionLevel = 'protected' | 'partial' | 'unprotected' | 'incomplete';

const AWS_AZ_SUFFIXES = ['a', 'b', 'c'] as const;
const GCP_ZONE_SUFFIXES = ['a', 'b', 'c'] as const;
const AZURE_ZONE_IDS = ['1', '2', '3'] as const;

// Intentionally incomplete nodes to demonstrate requiresVerification in demo data.
const INTENTIONAL_METADATA_GAP_NODE_IDS = new Set<string>(['dr-bastion', 'gcp-storage-archive']);

const EXPLICIT_PROTECTION_LEVELS: Readonly<Record<string, DemoProtectionLevel>> = {
  // AWS compute
  'svc-main-app': 'unprotected',
  'svc-api-gateway': 'partial',
  'svc-payment': 'protected',
  'svc-user': 'partial',
  'svc-order': 'protected',
  'svc-admin': 'partial',
  'svc-search': 'protected',
  'svc-analytics': 'partial',
  'api-rate-limiter': 'protected',
  'support-portal': 'partial',
  'partner-gateway': 'unprotected',
  'dr-bastion': 'incomplete',
  // AWS data
  'db-main': 'unprotected',
  'db-payment': 'partial',
  'db-user': 'protected',
  'db-order': 'partial',
  'db-catalog': 'protected',
  'db-admin': 'unprotected',
  'redis-main': 'partial',
  'admin-portal-cache': 'unprotected',
  's3-images': 'partial',
  's3-backups': 'protected',
  's3-dr-backups': 'protected',
  'ddb-sessions': 'protected',
  // Azure
  'azure-analytics-node': 'partial',
  'azure-sql-replica': 'protected',
  'azure-storage-archive': 'partial',
  // GCP
  'gcp-compute-batch': 'unprotected',
  'gcp-cloudsql-orders': 'partial',
  'gcp-memorystore-shared': 'protected',
  'gcp-storage-archive': 'incomplete',
};

const SIZE_LAYERS: Readonly<Record<DemoCompanySizeKey, DemoInfrastructureLayerName[]>> = {
  pme: ['core'],
  pme_plus: ['core', 'microservices'],
  eti: ['core', 'microservices', 'resilience', 'dr'],
  large: ['core', 'microservices', 'resilience', 'dr', 'multi_region', 'legacy_extended'],
};

const SIZE_SPOF_IDS: Readonly<Record<DemoCompanySizeKey, string[]>> = {
  pme: ['db-payment', 'svc-api-gateway', 'erp-server', 'redis-main'],
  pme_plus: ['db-payment', 'svc-api-gateway', 'crm-legacy'],
  eti: ['erp-server', 'svc-api-gateway'],
  large: ['partner-gateway', 'onprem-legacy-db2'],
};

const SECTOR_LABELS: Readonly<
  Record<DemoSectorKey, Partial<Record<GenericLabelKey, string>>>
> = {
  ecommerce: {
    'main-app': 'storefront',
    'payment-service': 'payment-service',
    'user-service': 'customer-svc',
    'order-service': 'order-engine',
    'catalog-service': 'product-catalog',
    'notification-svc': 'email-marketing',
    'analytics-service': 'recommendation',
    'admin-dashboard': 'back-office',
    'search-service': 'product-search',
    'legacy-erp': 'legacy-erp',
    'main-db': 'catalog-db',
    'payment-db': 'payment-db',
    'user-db': 'customer-db',
    'order-db': 'order-db',
  },
  finance: {
    'main-app': 'trading-platform',
    'payment-service': 'transaction-svc',
    'user-service': 'kyc-service',
    'order-service': 'order-matching',
    'catalog-service': 'instrument-ref',
    'notification-svc': 'alert-engine',
    'analytics-service': 'risk-calculator',
    'admin-dashboard': 'compliance-ui',
    'search-service': 'market-data',
    'legacy-erp': 'core-banking',
    'main-db': 'positions-db',
    'payment-db': 'ledger-db',
    'user-db': 'kyc-db',
    'order-db': 'trade-db',
  },
  healthcare: {
    'main-app': 'patient-portal',
    'payment-service': 'billing-service',
    'user-service': 'patient-records',
    'order-service': 'appointment-svc',
    'catalog-service': 'drug-catalog',
    'notification-svc': 'care-alerts',
    'analytics-service': 'lab-integration',
    'admin-dashboard': 'admin-clinical',
    'search-service': 'patient-search',
    'legacy-erp': 'his-legacy',
    'main-db': 'ehr-database',
    'payment-db': 'billing-db',
    'user-db': 'patient-db',
    'order-db': 'scheduling-db',
  },
  manufacturing: {
    'main-app': 'mes-console',
    'payment-service': 'erp-connector',
    'user-service': 'workforce-mgmt',
    'order-service': 'work-order-svc',
    'catalog-service': 'asset-catalog',
    'notification-svc': 'alarm-dispatcher',
    'analytics-service': 'quality-control',
    'admin-dashboard': 'scada-dashboard',
    'search-service': 'inventory-search',
    'legacy-erp': 'plm-legacy',
    'main-db': 'mes-database',
    'payment-db': 'erp-database',
    'user-db': 'hr-database',
    'order-db': 'workorder-db',
  },
  it_saas: {
    'main-app': 'developer-portal',
    'payment-service': 'subscription-billing',
    'user-service': 'identity-svc',
    'order-service': 'provisioning-engine',
    'catalog-service': 'service-catalog',
    'notification-svc': 'incident-notifier',
    'analytics-service': 'usage-analytics',
    'admin-dashboard': 'ops-console',
    'search-service': 'log-search',
    'legacy-erp': 'legacy-crm',
    'main-db': 'platform-db',
    'payment-db': 'billing-db',
    'user-db': 'identity-db',
    'order-db': 'provisioning-db',
  },
  transport: {
    'main-app': 'shipment-portal',
    'payment-service': 'billing-svc',
    'user-service': 'driver-svc',
    'order-service': 'dispatch-engine',
    'catalog-service': 'route-catalog',
    'notification-svc': 'dispatch-alerts',
    'analytics-service': 'route-optimizer',
    'admin-dashboard': 'control-tower',
    'search-service': 'shipment-search',
    'legacy-erp': 'tms-legacy',
    'main-db': 'shipments-db',
    'payment-db': 'billing-db',
    'user-db': 'driver-db',
    'order-db': 'dispatch-db',
  },
  energy: {
    'main-app': 'grid-operations',
    'payment-service': 'settlement-svc',
    'user-service': 'metering-svc',
    'order-service': 'outage-workorder',
    'catalog-service': 'asset-registry',
    'notification-svc': 'outage-alerts',
    'analytics-service': 'load-forecast',
    'admin-dashboard': 'scada-control',
    'search-service': 'asset-search',
    'legacy-erp': 'utility-billing-legacy',
    'main-db': 'grid-db',
    'payment-db': 'settlement-db',
    'user-db': 'meter-db',
    'order-db': 'outage-db',
  },
  public: {
    'main-app': 'citizen-portal',
    'payment-service': 'tax-payment-svc',
    'user-service': 'identity-registry',
    'order-service': 'case-management',
    'catalog-service': 'service-directory',
    'notification-svc': 'public-alerts',
    'analytics-service': 'policy-analytics',
    'admin-dashboard': 'administration-console',
    'search-service': 'records-search',
    'legacy-erp': 'public-finance-legacy',
    'main-db': 'citizen-db',
    'payment-db': 'treasury-db',
    'user-db': 'identity-db',
    'order-db': 'case-db',
  },
};

function defineNode(
  id: string,
  name: string,
  type: string,
  provider: string,
  options: {
    externalId?: string;
    region?: string;
    availabilityZone?: string;
    tags?: Record<string, string>;
    metadata?: Record<string, unknown>;
    genericLabelKey?: GenericLabelKey;
  } = {},
): DemoInfraNodeDef {
  const metadata: Record<string, unknown> = {
    ...(options.metadata ?? {}),
  };
  if (options.genericLabelKey) {
    metadata.genericLabelKey = options.genericLabelKey;
  }

  const node: DemoInfraNodeDef = {
    id,
    externalId: options.externalId ?? `demo:${id}`,
    name,
    type,
    provider,
    tags: { ...(options.tags ?? {}) },
    metadata,
  };

  if (options.region !== undefined) {
    node.region = options.region;
  }
  if (options.availabilityZone !== undefined) {
    node.availabilityZone = options.availabilityZone;
  }

  return node;
}

function defineEdge(
  sourceId: string,
  targetId: string,
  type: string,
  options: {
    confidence?: number;
    inferenceMethod?: string;
    confirmed?: boolean;
  } = {},
): DemoInfraEdgeDef {
  const edge: DemoInfraEdgeDef = {
    sourceId,
    targetId,
    type,
  };

  if (options.confidence !== undefined) {
    edge.confidence = options.confidence;
  }
  if (options.inferenceMethod !== undefined) {
    edge.inferenceMethod = options.inferenceMethod;
  }
  if (options.confirmed !== undefined) {
    edge.confirmed = options.confirmed;
  }

  return edge;
}

function toMetadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function resolveRegion(node: DemoInfraNodeDef, fallback: string): string {
  return readStringValue(node.region) ?? readStringValue(node.metadata.region) ?? fallback;
}

function resolveDemoDomain(node: DemoInfraNodeDef): string {
  const type = String(node.type || '').toUpperCase();
  const tagDomain = readStringValue(node.tags.domain);
  if (tagDomain) return tagDomain;

  if (['API_GATEWAY', 'LOAD_BALANCER', 'DNS', 'CDN', 'FIREWALL', 'NETWORK_DEVICE'].includes(type)) {
    return 'network';
  }
  if (['DATABASE', 'CACHE', 'OBJECT_STORAGE', 'MESSAGE_QUEUE'].includes(type)) {
    return 'data';
  }
  if (['APPLICATION', 'MICROSERVICE', 'SERVERLESS', 'KUBERNETES_POD', 'KUBERNETES_SERVICE'].includes(type)) {
    return 'application';
  }
  return 'platform';
}

function resolveDemoTier(node: DemoInfraNodeDef): string {
  const type = String(node.type || '').toUpperCase();
  const tagTier = readStringValue(node.tags.tier);
  if (tagTier) return tagTier;

  if (['API_GATEWAY', 'LOAD_BALANCER', 'DNS', 'CDN'].includes(type)) return 'edge';
  if (['DATABASE', 'CACHE', 'OBJECT_STORAGE', 'MESSAGE_QUEUE'].includes(type)) return 'data';
  if (['APPLICATION', 'MICROSERVICE', 'SERVERLESS'].includes(type)) return 'application';
  return 'platform';
}

function buildAwsZones(region: string, count: number): string[] {
  const safeCount = Math.max(1, Math.min(count, AWS_AZ_SUFFIXES.length));
  return AWS_AZ_SUFFIXES.slice(0, safeCount).map((suffix) => `${region}${suffix}`);
}

function buildGcpZones(region: string, count: number): string[] {
  const safeCount = Math.max(1, Math.min(count, GCP_ZONE_SUFFIXES.length));
  return GCP_ZONE_SUFFIXES.slice(0, safeCount).map((suffix) => `${region}-${suffix}`);
}

function buildAzureZones(count: number): string[] {
  const safeCount = Math.max(1, Math.min(count, AZURE_ZONE_IDS.length));
  return AZURE_ZONE_IDS.slice(0, safeCount);
}

function resolveProtectionLevel(node: DemoInfraNodeDef, metadata: Record<string, unknown>): DemoProtectionLevel {
  const explicit = EXPLICIT_PROTECTION_LEVELS[node.id];
  if (explicit) return explicit;
  if (INTENTIONAL_METADATA_GAP_NODE_IDS.has(node.id)) return 'incomplete';

  if (metadata.intentionalSpof === true || String(node.tags.intentional_spof || '').toLowerCase() === 'true') {
    return 'unprotected';
  }

  const nodeId = String(node.id || '').toLowerCase();
  const role = String(node.tags.role || '').toLowerCase();
  const env = String(node.tags.env || '').toLowerCase();
  const critical = String(node.tags.critical || '').toLowerCase();

  if (nodeId.includes('secondary') || nodeId.includes('replica') || role === 'secondary') return 'protected';
  if (env === 'dr' || nodeId.includes('dr-')) return 'partial';
  if (critical === 'true') return 'partial';

  return 'unprotected';
}

type DemoTemplateType =
  | 'aws_ec2'
  | 'aws_rds'
  | 'aws_elasticache'
  | 'aws_s3'
  | 'aws_dynamodb'
  | 'azure_vm'
  | 'azure_sql'
  | 'azure_postgresql'
  | 'azure_blob'
  | 'gcp_compute'
  | 'gcp_cloudsql'
  | 'gcp_memorystore'
  | 'gcp_storage';

function resolveTemplateType(node: DemoInfraNodeDef, metadata: Record<string, unknown>): DemoTemplateType | null {
  const provider = String(node.provider || '').toLowerCase();
  const type = String(node.type || '').toUpperCase();
  const sourceType = String(metadata.sourceType || '').toLowerCase();
  const engine = String(metadata.engine || '').toLowerCase();

  if (provider === 'aws') {
    if (type === 'DATABASE' && (sourceType.includes('dynamodb') || node.id.includes('ddb'))) {
      return 'aws_dynamodb';
    }
    if (type === 'DATABASE') return 'aws_rds';
    if (type === 'CACHE') return 'aws_elasticache';
    if (type === 'OBJECT_STORAGE') return 'aws_s3';
    if (['APPLICATION', 'MICROSERVICE', 'VM', 'PHYSICAL_SERVER'].includes(type)) return 'aws_ec2';
    return null;
  }

  if (provider === 'azure') {
    if (type === 'OBJECT_STORAGE') return 'azure_blob';
    if (type === 'DATABASE' && (sourceType.includes('postgres') || engine.includes('postgres'))) {
      return 'azure_postgresql';
    }
    if (type === 'DATABASE') return 'azure_sql';
    if (['APPLICATION', 'MICROSERVICE', 'VM'].includes(type)) return 'azure_vm';
    return null;
  }

  if (provider === 'gcp') {
    if (type === 'OBJECT_STORAGE') return 'gcp_storage';
    if (type === 'DATABASE') return 'gcp_cloudsql';
    if (type === 'CACHE') return 'gcp_memorystore';
    if (['APPLICATION', 'MICROSERVICE', 'VM'].includes(type)) return 'gcp_compute';
    return null;
  }

  return null;
}

export type DemoMetadataValidationIssue = {
  nodeId: string;
  nodeName: string;
  templateType: DemoTemplateType | 'generic';
  missingExpressions: string[];
};

type ValidateDemoMetadataOptions = {
  includeIntentionalGaps?: boolean;
};

const COMMON_DEMO_METADATA_EXPRESSIONS = [
  'businessName',
  'tagName',
  'domain',
  'tier',
] as const;

const TEMPLATE_METADATA_EXPRESSIONS: Readonly<Record<DemoTemplateType, readonly string[]>> = {
  aws_ec2: [
    'instanceType',
    'asgMinSize|asgDesiredCapacity|minSize|desiredCapacity',
    'asgAZCount|asgAvailabilityZones|availabilityZones|availabilityZone',
  ],
  aws_rds: [
    'dbInstanceClass|instanceType',
    'engine',
    'isMultiAZ|multiAZ|multiAz|multi_az',
    'replicaCount|readReplicaCount|readReplicas',
  ],
  aws_elasticache: [
    'engine',
    'cacheNodeType|instanceType',
    'replicaCount|readReplicaCount|memberClusters',
    'automaticFailover|automaticFailoverStatus|multiAZEnabled',
  ],
  aws_s3: [
    'bucketName|name',
    'versioningStatus',
    'hasCrossRegionReplication|crossRegionReplication|replicationRules|replicationConfiguration',
  ],
  aws_dynamodb: [
    'tableName|name',
    'billingMode',
    'pointInTimeRecovery|pointInTimeRecoveryStatus',
  ],
  azure_vm: [
    'vmSize|instanceType',
    'vmssId|virtualMachineScaleSetId|virtualMachineScaleSet|vmssInstanceCount',
    'availabilityZones|zones|zone',
  ],
  azure_sql: [
    'engine',
    'skuName|sku',
    'geoReplicaLocation|hasGeoReplication|geoReplicationLinks|failoverGroupId',
  ],
  azure_postgresql: [
    'engine',
    'haMode|highAvailabilityMode|highAvailability',
  ],
  azure_blob: [
    'replication|replicationType|skuName|sku',
  ],
  gcp_compute: [
    'machineType|instanceType',
    'instanceGroupManager|managedInstanceGroup|instanceGroupSize',
    'availabilityZones|zones|zone|locations|nodePoolLocations',
  ],
  gcp_cloudsql: [
    'engine',
    'tier|instanceType',
    'availabilityType|availability_type|settingsAvailabilityType',
  ],
  gcp_memorystore: [
    'engine',
    'tier|redisTier|redis_tier',
    'memorySizeGb',
  ],
  gcp_storage: [
    'locationType|location_type|location',
    'storageClass',
  ],
};

function splitMetadataExpression(expression: string): string[] {
  return expression
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function hasUsableMetadataValue(metadata: Record<string, unknown>, key: string): boolean {
  if (!(key in metadata)) return false;
  const value = metadata[key];
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function resolveMissingMetadataExpressions(
  metadata: Record<string, unknown>,
  expressions: readonly string[],
): string[] {
  const missing: string[] = [];
  for (const expression of expressions) {
    const alternatives = splitMetadataExpression(expression);
    const hasKnownValue = alternatives.some((key) => hasUsableMetadataValue(metadata, key));
    if (!hasKnownValue) missing.push(expression);
  }
  return missing;
}

export function validateDemoMetadata(
  nodes: DemoInfraNodeDef[],
  options: ValidateDemoMetadataOptions = {},
): DemoMetadataValidationIssue[] {
  const includeIntentionalGaps = options.includeIntentionalGaps === true;
  const issues: DemoMetadataValidationIssue[] = [];

  for (const node of nodes) {
    if (!includeIntentionalGaps && INTENTIONAL_METADATA_GAP_NODE_IDS.has(node.id)) {
      continue;
    }

    const metadata = toMetadataRecord(node.metadata);
    const templateType = resolveTemplateType(node, metadata);
    const templateExpressions = templateType ? TEMPLATE_METADATA_EXPRESSIONS[templateType] : [];
    const requiredExpressions = [...COMMON_DEMO_METADATA_EXPRESSIONS, ...templateExpressions];
    const missingExpressions = resolveMissingMetadataExpressions(metadata, requiredExpressions);

    if (missingExpressions.length > 0) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        templateType: templateType ?? 'generic',
        missingExpressions,
      });
    }
  }

  return issues;
}

function resolveNormalizedProtection(protection: DemoProtectionLevel): 'protected' | 'partial' | 'unprotected' {
  if (protection === 'incomplete') return 'partial';
  return protection;
}

function buildCommonDemoMetadata(node: DemoInfraNodeDef, metadata: Record<string, unknown>): Record<string, unknown> {
  const existingTags = toMetadataRecord(metadata.tags);
  const existingAwsTags = toMetadataRecord(metadata.awsTags);
  const existingBusinessTags = toMetadataRecord(metadata.businessTags);

  const businessName = readStringValue(metadata.businessName) ?? node.name;
  const tagName = readStringValue(metadata.tagName) ?? slugify(node.name);
  const domain = readStringValue(metadata.domain) ?? resolveDemoDomain(node);
  const tier = readStringValue(metadata.tier) ?? resolveDemoTier(node);
  const environment = readStringValue(node.tags.env) ?? 'production';

  return {
    businessName,
    tagName,
    domain,
    tier,
    displayName: readStringValue(metadata.displayName) ?? businessName,
    technicalName: readStringValue(metadata.technicalName) ?? node.id,
    tags: {
      ...existingTags,
      Name: readStringValue(existingTags.Name) ?? tagName,
      name: readStringValue(existingTags.name) ?? tagName,
      domain: readStringValue(existingTags.domain) ?? domain,
      tier: readStringValue(existingTags.tier) ?? tier,
      environment: readStringValue(existingTags.environment) ?? environment,
    },
    awsTags: {
      ...existingAwsTags,
      Name: readStringValue(existingAwsTags.Name) ?? tagName,
      Service: readStringValue(existingAwsTags.Service) ?? businessName,
      Environment: readStringValue(existingAwsTags.Environment) ?? environment,
      Tier: readStringValue(existingAwsTags.Tier) ?? tier,
      Domain: readStringValue(existingAwsTags.Domain) ?? domain,
    },
    businessTags: {
      ...existingBusinessTags,
      domain: readStringValue(existingBusinessTags.domain) ?? domain,
      tier: readStringValue(existingBusinessTags.tier) ?? tier,
      environment: readStringValue(existingBusinessTags.environment) ?? environment,
    },
  };
}

function buildAwsEc2Metadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const region = resolveRegion(node, 'eu-west-1');
  const azCount = protection === 'protected' ? 3 : 1;
  const zones = buildAwsZones(region, azCount);
  const hasAsg = protection !== 'unprotected';
  const nodeType = String(node.type || '').toUpperCase();
  const instanceType = nodeType === 'VM' ? 't3.medium' : protection === 'protected' ? 'm5.large' : 't3.medium';

  return {
    sourceType: 'EC2_INSTANCE',
    instanceType,
    autoScalingGroupName: hasAsg ? `asg-${slugify(node.id)}` : null,
    asgMinSize: protection === 'protected' ? 2 : 1,
    asgMaxSize: protection === 'protected' ? 6 : 2,
    asgDesiredCapacity: protection === 'protected' ? 3 : 1,
    asgAZCount: azCount,
    asgAvailabilityZones: zones,
    availabilityZones: zones,
    availabilityZone: zones[0],
  };
}

function buildAwsRdsMetadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const isMultiAZ = protection !== 'unprotected';
  const replicaCount = protection === 'protected' ? 1 : 0;

  return {
    sourceType: 'RDS',
    dbInstanceClass: protection === 'protected' ? 'db.r6g.large' : 'db.t3.medium',
    engine: readStringValue(node.metadata.engine) ?? 'PostgreSQL',
    isMultiAZ,
    multiAZ: isMultiAZ,
    readReplicaCount: replicaCount,
    readReplicas: replicaCount,
    replicaCount,
    crossRegionReplicaCount: protection === 'protected' ? 1 : 0,
  };
}

function buildAwsElastiCacheMetadata(
  node: DemoInfraNodeDef,
  protectionLevel: DemoProtectionLevel,
): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const replicaCount = protection === 'protected' ? 2 : protection === 'partial' ? 1 : 0;
  const automaticFailover = protection === 'protected';

  return {
    sourceType: 'ELASTICACHE',
    engine: 'Redis',
    cacheNodeType: protection === 'protected' ? 'cache.r6g.large' : 'cache.t3.small',
    replicaCount,
    readReplicaCount: replicaCount,
    memberClusters: replicaCount + 1,
    automaticFailover,
    automaticFailoverStatus: automaticFailover ? 'enabled' : 'disabled',
    multiAZEnabled: automaticFailover,
  };
}

function buildAwsS3Metadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const hasReplication = protection === 'protected';

  return {
    sourceType: 'S3_BUCKET',
    bucketName: readStringValue(node.name) ?? node.id,
    versioningStatus: protection === 'unprotected' ? 'Suspended' : 'Enabled',
    hasCrossRegionReplication: hasReplication,
    crossRegionReplication: hasReplication,
    replicationRules: hasReplication ? 1 : 0,
    replicationConfiguration: hasReplication ? { status: 'Enabled', destinationRegion: 'eu-central-1' } : null,
  };
}

function buildAwsDynamoDbMetadata(
  node: DemoInfraNodeDef,
  protectionLevel: DemoProtectionLevel,
): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const pitrEnabled = protection === 'protected';

  return {
    sourceType: 'DYNAMODB_TABLE',
    engine: 'DynamoDB',
    tableName: readStringValue(node.metadata.tableName) ?? readStringValue(node.name) ?? node.id,
    billingMode: 'PAY_PER_REQUEST',
    pointInTimeRecovery: pitrEnabled,
    pointInTimeRecoveryStatus: pitrEnabled ? 'ENABLED' : 'DISABLED',
  };
}

function buildAzureVmMetadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const zones =
    protection === 'protected' ? buildAzureZones(3) : buildAzureZones(1);
  const hasVmss = protection !== 'unprotected';

  return {
    sourceType: hasVmss ? 'virtualMachineScaleSet' : 'virtualMachine',
    vmSize: protection === 'protected' ? 'Standard_D4s_v5' : 'Standard_D2s_v5',
    vmssId: hasVmss ? `/subscriptions/demo/resourceGroups/rg-demo/providers/Microsoft.Compute/virtualMachineScaleSets/${slugify(node.id)}` : null,
    vmssInstanceCount: protection === 'protected' ? 3 : 1,
    availabilityZones: zones,
    zones,
    zone: zones[0],
  };
}

function buildAzureSqlMetadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const hasGeoReplication = protection === 'protected';

  return {
    sourceType: 'sqlDatabase',
    engine: 'Azure SQL Database',
    skuName: protection === 'protected' ? 'BusinessCritical_Gen5_4' : 'GeneralPurpose_Gen5_2',
    hasGeoReplication,
    geoReplicaLocation: hasGeoReplication ? 'northeurope' : null,
    geoReplicationLinks: hasGeoReplication ? 1 : 0,
    failoverGroupId: hasGeoReplication ? `fg-${slugify(node.id)}` : null,
  };
}

function buildAzurePostgresqlMetadata(
  node: DemoInfraNodeDef,
  protectionLevel: DemoProtectionLevel,
): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const haMode = protection === 'protected' ? 'ZoneRedundant' : protection === 'partial' ? 'SameZone' : 'Disabled';

  return {
    sourceType: 'postgresqlFlexible',
    engine: 'Azure Database for PostgreSQL Flexible Server',
    skuName: protection === 'protected' ? 'Standard_D4s_v5' : 'Standard_B2s',
    haMode,
    highAvailabilityMode: haMode,
    highAvailability: { mode: haMode },
  };
}

function buildAzureBlobMetadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const replicationType =
    protection === 'protected' ? 'GRS' : protection === 'partial' ? 'ZRS' : 'LRS';

  return {
    sourceType: 'storageAccount',
    kind: 'StorageV2',
    replicationType,
    replication: replicationType,
    skuName: `Standard_${replicationType}`,
    sku: { name: `Standard_${replicationType}` },
  };
}

function buildGcpComputeMetadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const region = resolveRegion(node, 'europe-west1');
  const zoneCount = protection === 'protected' ? 2 : 1;
  const zones = buildGcpZones(region, zoneCount);
  const hasMig = protection !== 'unprotected';

  return {
    sourceType: 'computeEngine',
    machineType: protection === 'protected' ? 'e2-standard-4' : 'e2-standard-2',
    managedInstanceGroup: hasMig ? `mig-${slugify(node.id)}` : null,
    instanceGroupManager: hasMig ? `mig-${slugify(node.id)}` : null,
    instanceGroupSize: protection === 'protected' ? 3 : protection === 'partial' ? 2 : 1,
    availabilityZones: zones,
    zones,
    zone: zones[0],
  };
}

function buildGcpCloudSqlMetadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);

  return {
    sourceType: 'cloudSQL',
    engine: readStringValue(node.metadata.engine) ?? 'PostgreSQL',
    tier: protection === 'protected' ? 'db-custom-4-15360' : 'db-custom-2-7680',
    availabilityType: protection === 'protected' ? 'REGIONAL' : 'ZONAL',
  };
}

function buildGcpMemorystoreMetadata(
  node: DemoInfraNodeDef,
  protectionLevel: DemoProtectionLevel,
): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);
  const tier =
    protection === 'protected' ? 'STANDARD_HA' : protection === 'partial' ? 'STANDARD' : 'BASIC';

  return {
    sourceType: 'memorystore',
    engine: 'Redis',
    tier,
    redisTier: tier,
    memorySizeGb: protection === 'protected' ? 8 : 2,
  };
}

function buildGcpStorageMetadata(node: DemoInfraNodeDef, protectionLevel: DemoProtectionLevel): Record<string, unknown> {
  const protection = resolveNormalizedProtection(protectionLevel);

  if (protection === 'protected') {
    return {
      sourceType: 'cloudStorage',
      locationType: 'dual-region',
      location: 'europe-west1+europe-west4',
      storageClass: 'STANDARD',
    };
  }

  return {
    sourceType: 'cloudStorage',
    locationType: 'region',
    location: 'europe-west1',
    storageClass: protection === 'partial' ? 'NEARLINE' : 'STANDARD',
  };
}

function buildTemplateMetadata(
  node: DemoInfraNodeDef,
  metadata: Record<string, unknown>,
  protectionLevel: DemoProtectionLevel,
): { templateType: DemoTemplateType | null; templateMetadata: Record<string, unknown> } {
  const templateType = resolveTemplateType(node, metadata);
  if (!templateType) {
    return { templateType: null, templateMetadata: {} };
  }

  switch (templateType) {
    case 'aws_ec2':
      return { templateType, templateMetadata: buildAwsEc2Metadata(node, protectionLevel) };
    case 'aws_rds':
      return { templateType, templateMetadata: buildAwsRdsMetadata(node, protectionLevel) };
    case 'aws_elasticache':
      return { templateType, templateMetadata: buildAwsElastiCacheMetadata(node, protectionLevel) };
    case 'aws_s3':
      return { templateType, templateMetadata: buildAwsS3Metadata(node, protectionLevel) };
    case 'aws_dynamodb':
      return { templateType, templateMetadata: buildAwsDynamoDbMetadata(node, protectionLevel) };
    case 'azure_vm':
      return { templateType, templateMetadata: buildAzureVmMetadata(node, protectionLevel) };
    case 'azure_sql':
      return { templateType, templateMetadata: buildAzureSqlMetadata(node, protectionLevel) };
    case 'azure_postgresql':
      return { templateType, templateMetadata: buildAzurePostgresqlMetadata(node, protectionLevel) };
    case 'azure_blob':
      return { templateType, templateMetadata: buildAzureBlobMetadata(node, protectionLevel) };
    case 'gcp_compute':
      return { templateType, templateMetadata: buildGcpComputeMetadata(node, protectionLevel) };
    case 'gcp_cloudsql':
      return { templateType, templateMetadata: buildGcpCloudSqlMetadata(node, protectionLevel) };
    case 'gcp_memorystore':
      return { templateType, templateMetadata: buildGcpMemorystoreMetadata(node, protectionLevel) };
    case 'gcp_storage':
      return { templateType, templateMetadata: buildGcpStorageMetadata(node, protectionLevel) };
    default:
      return { templateType: null, templateMetadata: {} };
  }
}

function applyIntentionalMetadataGaps(
  node: DemoInfraNodeDef,
  metadata: Record<string, unknown>,
  templateType: DemoTemplateType | null,
): void {
  if (!INTENTIONAL_METADATA_GAP_NODE_IDS.has(node.id)) return;

  metadata.demoIntentionalMetadataGap = true;
  metadata.manualVerificationReason =
    'Intentional demo gap to keep requiresVerification examples visible in Discovery.';

  if (templateType === 'aws_ec2') {
    delete metadata.autoScalingGroupName;
    delete metadata.asgName;
    delete metadata.asgDesiredCapacity;
    delete metadata.desiredCapacity;
    delete metadata.minSize;
    delete metadata.asgMinSize;
    delete metadata.asgAZCount;
    delete metadata.asgAvailabilityZones;
    delete metadata.availabilityZones;
    delete metadata.availabilityZone;
  }

  if (templateType === 'gcp_storage') {
    delete metadata.locationType;
    delete metadata.location;
  }
}

function buildCoreLayer(): DemoLayerContribution {
  const nodes: DemoInfraNodeDef[] = [
    defineNode('region-eu-west-1', 'eu-west-1 (primary)', 'REGION', 'aws', {
      externalId: 'aws:region:eu-west-1',
      region: 'eu-west-1',
      metadata: { role: 'primary' },
    }),
    defineNode('vpc-prod', 'vpc-production', 'VPC', 'aws', {
      externalId: 'arn:aws:ec2:eu-west-1:123456:vpc/vpc-prod',
      region: 'eu-west-1',
      tags: { env: 'production' },
      metadata: { cidr: '10.0.0.0/16' },
    }),
    defineNode('subnet-pub-1a', 'subnet-public-1a', 'SUBNET', 'aws', {
      externalId: 'arn:aws:ec2:eu-west-1:123456:subnet/subnet-pub-1a',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { tier: 'public' },
      metadata: { cidr: '10.0.1.0/24', vpcId: 'vpc-prod' },
    }),
    defineNode('subnet-priv-1a', 'subnet-private-1a', 'SUBNET', 'aws', {
      externalId: 'arn:aws:ec2:eu-west-1:123456:subnet/subnet-priv-1a',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { tier: 'private' },
      metadata: { cidr: '10.0.10.0/24', vpcId: 'vpc-prod' },
    }),
    defineNode('cloudflare-cdn', 'edge-cdn', 'CDN', 'manual', {
      externalId: 'cloudflare:zone:shopmax.com',
      tags: { service: 'cdn' },
      metadata: { domain: 'shopmax.com' },
    }),
    defineNode('route53-shopmax', 'shopmax.com (Route53)', 'DNS', 'aws', {
      externalId: 'arn:aws:route53:::hostedzone/Z1234SHOPMAX',
      region: 'global',
      tags: { service: 'dns', env: 'production' },
      metadata: { hostedZone: 'shopmax.com', recordCount: 12 },
    }),
    defineNode('alb-prod', 'alb-production', 'LOAD_BALANCER', 'aws', {
      externalId: 'arn:aws:elasticloadbalancing:eu-west-1:123456:loadbalancer/app/alb-prod',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { env: 'production', app: 'shopmax' },
      metadata: { scheme: 'internet-facing', type: 'application' },
    }),
    defineNode('waf-prod', 'waf-production', 'FIREWALL', 'aws', {
      externalId: 'arn:aws:wafv2:eu-west-1:123456:regional/webacl/shopmax-waf',
      region: 'eu-west-1',
      tags: { env: 'production', app: 'shopmax' },
      metadata: { rulesCount: 8 },
    }),
    defineNode('svc-api-gateway', 'api-gateway', 'API_GATEWAY', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'frontend', critical: 'true' },
      metadata: { replicas: 1, drMonthlyCostOverride: 210 },
    }),
    defineNode('svc-main-app', 'main-app', 'APPLICATION', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'application' },
      metadata: { replicas: 1 },
      genericLabelKey: 'main-app',
    }),
    defineNode('svc-payment', 'payment-service', 'MICROSERVICE', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'backend', critical: 'true' },
      metadata: { replicas: 2, team: 'payments' },
      genericLabelKey: 'payment-service',
    }),
    defineNode('svc-user', 'user-service', 'MICROSERVICE', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'backend' },
      metadata: { replicas: 2, team: 'identity' },
      genericLabelKey: 'user-service',
    }),
    defineNode('svc-order', 'order-service', 'MICROSERVICE', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'backend', critical: 'true' },
      metadata: { replicas: 2, team: 'orders' },
      genericLabelKey: 'order-service',
    }),
    defineNode('db-main', 'main-db', 'DATABASE', 'aws', {
      externalId: 'arn:aws:rds:eu-west-1:123456:db/main-db',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { service: 'core-data' },
      metadata: { engine: 'PostgreSQL', replicaCount: 0, isMultiAZ: false, storageGB: 300 },
      genericLabelKey: 'main-db',
    }),
    defineNode('db-payment', 'payment-db', 'DATABASE', 'aws', {
      externalId: 'arn:aws:rds:eu-west-1:123456:db/payment-db',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { service: 'payments', critical: 'true' },
      metadata: {
        engine: 'PostgreSQL',
        replicaCount: 0,
        isMultiAZ: false,
        storageGB: 500,
        drMonthlyCostOverride: 220,
      },
      genericLabelKey: 'payment-db',
    }),
    defineNode('db-user', 'user-db', 'DATABASE', 'aws', {
      externalId: 'arn:aws:rds:eu-west-1:123456:db/user-db',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { service: 'identity' },
      metadata: { engine: 'PostgreSQL', replicaCount: 0, isMultiAZ: false, storageGB: 180 },
      genericLabelKey: 'user-db',
    }),
    defineNode('redis-main', 'redis-main', 'CACHE', 'aws', {
      externalId: 'arn:aws:elasticache:eu-west-1:123456:cluster/redis-main',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { service: 'cache' },
      metadata: { engine: 'Redis', replicaCount: 0, isMultiAZ: false },
    }),
    defineNode('s3-images', 'assets-bucket', 'OBJECT_STORAGE', 'aws', {
      externalId: 'arn:aws:s3:::shopmax-images',
      region: 'eu-west-1',
      tags: { service: 'assets' },
      metadata: { versioning: true, crossRegionReplication: false },
    }),
    defineNode('datadog', 'datadog-monitoring', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:datadog:shopmax',
      tags: { service: 'monitoring' },
      metadata: { plan: 'pro' },
    }),
    defineNode('stripe-api', 'stripe-api', 'THIRD_PARTY_API', 'manual', {
      externalId: 'third_party:stripe',
      tags: { service: 'payment', critical: 'true' },
      metadata: { sla: '99.99%' },
    }),
    defineNode('sendgrid-api', 'sendgrid-api', 'THIRD_PARTY_API', 'manual', {
      externalId: 'third_party:sendgrid',
      tags: { service: 'email' },
      metadata: { sla: '99.95%' },
    }),
    defineNode('erp-server', 'legacy-erp', 'PHYSICAL_SERVER', 'on_premise', {
      externalId: 'onprem:192.168.1.50',
      tags: { service: 'erp', legacy: 'true', critical: 'true' },
      metadata: {
        ip: '192.168.1.50',
        os: 'Windows Server 2019',
        drMonthlyCostOverride: 2400,
      },
      genericLabelKey: 'legacy-erp',
    }),
    defineNode('erp-db', 'erp-db', 'DATABASE', 'on_premise', {
      externalId: 'onprem:192.168.1.51',
      tags: { service: 'erp', legacy: 'true' },
      metadata: { ip: '192.168.1.51', engine: 'SQL Server', isMultiAZ: false, replicaCount: 0 },
    }),
    defineNode('vpn-gateway', 'vpn-gateway', 'NETWORK_DEVICE', 'on_premise', {
      externalId: 'onprem:192.168.1.1',
      tags: { service: 'network' },
      metadata: { ip: '192.168.1.1', model: 'Cisco ASA 5516-X' },
    }),
  ];

  const confirmedEdges: DemoInfraEdgeDef[] = [
    defineEdge('region-eu-west-1', 'vpc-prod', 'CONTAINS'),
    defineEdge('vpc-prod', 'subnet-pub-1a', 'CONTAINS'),
    defineEdge('vpc-prod', 'subnet-priv-1a', 'CONTAINS'),
    defineEdge('cloudflare-cdn', 'route53-shopmax', 'ROUTES_TO'),
    defineEdge('route53-shopmax', 'alb-prod', 'ROUTES_TO'),
    defineEdge('waf-prod', 'alb-prod', 'ROUTES_TO'),
    defineEdge('alb-prod', 'svc-api-gateway', 'ROUTES_TO'),
    defineEdge('svc-api-gateway', 'svc-main-app', 'ROUTES_TO'),
    defineEdge('svc-api-gateway', 'svc-payment', 'ROUTES_TO'),
    defineEdge('svc-api-gateway', 'svc-user', 'ROUTES_TO'),
    defineEdge('svc-api-gateway', 'svc-order', 'ROUTES_TO'),
    defineEdge('svc-api-gateway', 'redis-main', 'CONNECTS_TO'),
    defineEdge('svc-main-app', 'db-main', 'CONNECTS_TO'),
    defineEdge('svc-main-app', 's3-images', 'CONNECTS_TO'),
    defineEdge('svc-payment', 'db-payment', 'CONNECTS_TO'),
    defineEdge('svc-payment', 'stripe-api', 'DEPENDS_ON'),
    defineEdge('svc-user', 'db-user', 'CONNECTS_TO'),
    defineEdge('svc-order', 'db-main', 'CONNECTS_TO'),
    defineEdge('svc-order', 'erp-server', 'DEPENDS_ON'),
    defineEdge('svc-order', 'sendgrid-api', 'DEPENDS_ON'),
    defineEdge('erp-server', 'erp-db', 'CONNECTS_TO'),
    defineEdge('vpn-gateway', 'vpc-prod', 'CONNECTS_TO'),
    defineEdge('erp-server', 'vpn-gateway', 'CONNECTS_TO'),
    defineEdge('datadog', 'svc-api-gateway', 'MONITORS'),
    defineEdge('datadog', 'svc-payment', 'MONITORS'),
    defineEdge('datadog', 'svc-order', 'MONITORS'),
    defineEdge('datadog', 'db-payment', 'MONITORS'),
    defineEdge('datadog', 'db-main', 'MONITORS'),
    defineEdge('datadog', 'redis-main', 'MONITORS'),
  ];

  const inferredEdges: DemoInfraEdgeDef[] = [
    defineEdge('svc-main-app', 'db-payment', 'CONNECTS_TO', {
      confidence: 0.55,
      inferenceMethod: 'traffic-correlation',
      confirmed: false,
    }),
    defineEdge('svc-user', 'redis-main', 'CONNECTS_TO', {
      confidence: 0.64,
      inferenceMethod: 'runtime-profiling',
      confirmed: false,
    }),
  ];

  return { nodes, confirmedEdges, inferredEdges };
}

function buildMicroservicesLayer(): DemoLayerContribution {
  const nodes: DemoInfraNodeDef[] = [
    defineNode('subnet-priv-1b', 'subnet-private-1b', 'SUBNET', 'aws', {
      externalId: 'arn:aws:ec2:eu-west-1:123456:subnet/subnet-priv-1b',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      tags: { tier: 'private' },
      metadata: { cidr: '10.0.11.0/24', vpcId: 'vpc-prod' },
    }),
    defineNode('eks-prod', 'eks-production', 'KUBERNETES_CLUSTER', 'aws', {
      externalId: 'arn:aws:eks:eu-west-1:123456:cluster/eks-production',
      region: 'eu-west-1',
      tags: { env: 'production' },
      metadata: { version: '1.29', nodeCount: 7, isMultiAZ: false },
    }),
    defineNode('svc-catalog', 'catalog-service', 'MICROSERVICE', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'backend' },
      metadata: { replicas: 2 },
      genericLabelKey: 'catalog-service',
    }),
    defineNode('svc-notification', 'notification-svc', 'MICROSERVICE', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'backend' },
      metadata: { replicas: 2 },
      genericLabelKey: 'notification-svc',
    }),
    defineNode('svc-admin', 'admin-dashboard', 'APPLICATION', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'internal' },
      metadata: { replicas: 1, drMonthlyCostOverride: 520 },
      genericLabelKey: 'admin-dashboard',
    }),
    defineNode('svc-search', 'search-service', 'MICROSERVICE', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'backend' },
      metadata: { replicas: 2 },
      genericLabelKey: 'search-service',
    }),
    defineNode('svc-analytics', 'analytics-service', 'MICROSERVICE', 'aws', {
      region: 'eu-west-1',
      tags: { tier: 'backend' },
      metadata: { replicas: 1 },
      genericLabelKey: 'analytics-service',
    }),
    defineNode('db-order', 'order-db', 'DATABASE', 'aws', {
      externalId: 'arn:aws:rds:eu-west-1:123456:db/order-db',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { service: 'orders' },
      metadata: { engine: 'PostgreSQL', replicaCount: 0, isMultiAZ: false, storageGB: 220 },
      genericLabelKey: 'order-db',
    }),
    defineNode('db-admin', 'admin-db', 'DATABASE', 'aws', {
      externalId: 'arn:aws:rds:eu-west-1:123456:db/admin-db',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { service: 'admin' },
      metadata: { engine: 'PostgreSQL', replicaCount: 0, isMultiAZ: false, storageGB: 90 },
    }),
    defineNode('db-catalog', 'catalog-db', 'DATABASE', 'aws', {
      externalId: 'arn:aws:rds:eu-west-1:123456:db/catalog-db',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { service: 'catalog' },
      metadata: { engine: 'MySQL', replicaCount: 0, isMultiAZ: false, storageGB: 640 },
      genericLabelKey: 'main-db',
    }),
    defineNode('es-catalog', 'catalog-search', 'DATABASE', 'aws', {
      externalId: 'arn:aws:es:eu-west-1:123456:domain/catalog-search',
      region: 'eu-west-1',
      tags: { service: 'search' },
      metadata: { engine: 'OpenSearch', replicaCount: 1, isMultiAZ: false },
    }),
    defineNode('sqs-orders', 'orders-queue', 'MESSAGE_QUEUE', 'aws', {
      externalId: 'arn:aws:sqs:eu-west-1:123456:orders-queue',
      region: 'eu-west-1',
      tags: { service: 'orders' },
      metadata: { retentionDays: 14 },
    }),
    defineNode('sqs-notifications', 'notifications-queue', 'MESSAGE_QUEUE', 'aws', {
      externalId: 'arn:aws:sqs:eu-west-1:123456:notifications-queue',
      region: 'eu-west-1',
      tags: { service: 'notifications' },
      metadata: { retentionDays: 7 },
    }),
    defineNode('ddb-sessions', 'sessions-table', 'DATABASE', 'aws', {
      externalId: 'arn:aws:dynamodb:eu-west-1:123456:table/sessions-table',
      region: 'eu-west-1',
      tags: { service: 'sessions' },
      metadata: {
        sourceType: 'DYNAMODB_TABLE',
        engine: 'DynamoDB',
        tableName: 'sessions-table',
        billingMode: 'PAY_PER_REQUEST',
      },
    }),
    defineNode('s3-backups', 'backup-bucket', 'OBJECT_STORAGE', 'aws', {
      externalId: 'arn:aws:s3:::shopmax-backups',
      region: 'eu-west-1',
      tags: { service: 'backup' },
      metadata: { versioning: true, crossRegionReplication: false },
    }),
    defineNode('lambda-image', 'image-processor', 'SERVERLESS', 'aws', {
      externalId: 'arn:aws:lambda:eu-west-1:123456:function:image-processor',
      region: 'eu-west-1',
      tags: { service: 'media' },
      metadata: { runtime: 'nodejs20.x', timeoutSec: 30 },
    }),
    defineNode('ci-cd-pipeline', 'ci-cd-pipeline', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:github-actions:shopmax',
      tags: { service: 'delivery' },
      metadata: { stage: 'build-test-deploy' },
    }),
    defineNode('crm-legacy', 'legacy-crm', 'PHYSICAL_SERVER', 'on_premise', {
      externalId: 'onprem:192.168.1.60',
      tags: { service: 'crm', legacy: 'true' },
      metadata: { ip: '192.168.1.60', os: 'Windows Server 2016' },
    }),
    defineNode('notification-provider', 'twilio-notify', 'THIRD_PARTY_API', 'manual', {
      externalId: 'third_party:twilio',
      tags: { service: 'notifications' },
      metadata: { sla: '99.9%' },
    }),
    defineNode('api-rate-limiter', 'api-rate-limiter', 'APPLICATION', 'aws', {
      region: 'eu-west-1',
      tags: { service: 'security' },
      metadata: { mode: 'token-bucket' },
    }),
    defineNode('backup-orchestrator', 'backup-orchestrator', 'SERVERLESS', 'aws', {
      region: 'eu-west-1',
      tags: { service: 'backup' },
      metadata: { schedule: 'hourly' },
    }),
    defineNode('vpn-branch-office', 'vpn-branch-office', 'NETWORK_DEVICE', 'on_premise', {
      externalId: 'onprem:192.168.2.1',
      tags: { service: 'network', site: 'branch' },
      metadata: { ip: '192.168.2.1' },
    }),
    defineNode('admin-portal-cache', 'admin-cache', 'CACHE', 'aws', {
      region: 'eu-west-1',
      tags: { service: 'admin' },
      metadata: { engine: 'Redis', replicaCount: 0, isMultiAZ: false },
    }),
    defineNode('audit-collector', 'audit-collector', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:audit:collector',
      tags: { service: 'audit' },
      metadata: { retentionDays: 365 },
    }),
  ];

  const confirmedEdges: DemoInfraEdgeDef[] = [
    defineEdge('vpc-prod', 'subnet-priv-1b', 'CONTAINS'),
    defineEdge('eks-prod', 'subnet-priv-1a', 'RUNS_ON'),
    defineEdge('eks-prod', 'subnet-priv-1b', 'RUNS_ON'),
    defineEdge('svc-payment', 'eks-prod', 'RUNS_ON'),
    defineEdge('svc-order', 'eks-prod', 'RUNS_ON'),
    defineEdge('svc-user', 'eks-prod', 'RUNS_ON'),
    defineEdge('svc-catalog', 'eks-prod', 'RUNS_ON'),
    defineEdge('svc-notification', 'eks-prod', 'RUNS_ON'),
    defineEdge('svc-search', 'eks-prod', 'RUNS_ON'),
    defineEdge('svc-analytics', 'eks-prod', 'RUNS_ON'),
    defineEdge('svc-admin', 'eks-prod', 'RUNS_ON'),
    defineEdge('alb-prod', 'api-rate-limiter', 'ROUTES_TO'),
    defineEdge('api-rate-limiter', 'svc-api-gateway', 'ROUTES_TO'),
    defineEdge('svc-api-gateway', 'svc-catalog', 'ROUTES_TO'),
    defineEdge('svc-api-gateway', 'svc-search', 'ROUTES_TO'),
    defineEdge('svc-api-gateway', 'svc-admin', 'ROUTES_TO'),
    defineEdge('svc-catalog', 'db-catalog', 'CONNECTS_TO'),
    defineEdge('svc-catalog', 'es-catalog', 'CONNECTS_TO'),
    defineEdge('svc-catalog', 'lambda-image', 'DEPENDS_ON'),
    defineEdge('svc-search', 'es-catalog', 'CONNECTS_TO'),
    defineEdge('svc-search', 'redis-main', 'CONNECTS_TO'),
    defineEdge('svc-order', 'db-order', 'CONNECTS_TO'),
    defineEdge('svc-order', 'sqs-orders', 'PUBLISHES_TO'),
    defineEdge('svc-order', 'sqs-notifications', 'PUBLISHES_TO'),
    defineEdge('svc-notification', 'sqs-notifications', 'SUBSCRIBES_TO'),
    defineEdge('svc-notification', 'sendgrid-api', 'DEPENDS_ON'),
    defineEdge('svc-notification', 'notification-provider', 'DEPENDS_ON'),
    defineEdge('svc-admin', 'db-admin', 'CONNECTS_TO'),
    defineEdge('svc-admin', 'admin-portal-cache', 'CONNECTS_TO'),
    defineEdge('svc-user', 'ddb-sessions', 'CONNECTS_TO'),
    defineEdge('svc-analytics', 'db-main', 'CONNECTS_TO'),
    defineEdge('svc-analytics', 'db-order', 'CONNECTS_TO'),
    defineEdge('backup-orchestrator', 'db-main', 'BACKS_UP_TO'),
    defineEdge('backup-orchestrator', 'db-user', 'BACKS_UP_TO'),
    defineEdge('backup-orchestrator', 'db-order', 'BACKS_UP_TO'),
    defineEdge('backup-orchestrator', 'db-catalog', 'BACKS_UP_TO'),
    defineEdge('backup-orchestrator', 'ddb-sessions', 'BACKS_UP_TO'),
    defineEdge('backup-orchestrator', 's3-backups', 'BACKS_UP_TO'),
    defineEdge('lambda-image', 's3-images', 'CONNECTS_TO'),
    defineEdge('lambda-image', 'sqs-orders', 'SUBSCRIBES_TO'),
    defineEdge('ci-cd-pipeline', 'eks-prod', 'DEPENDS_ON'),
    defineEdge('ci-cd-pipeline', 'audit-collector', 'DEPENDS_ON'),
    defineEdge('crm-legacy', 'db-main', 'CONNECTS_TO'),
    defineEdge('crm-legacy', 'vpn-gateway', 'CONNECTS_TO'),
    defineEdge('vpn-branch-office', 'vpn-gateway', 'CONNECTS_TO'),
    defineEdge('datadog', 'eks-prod', 'MONITORS'),
    defineEdge('datadog', 'db-order', 'MONITORS'),
    defineEdge('datadog', 'db-catalog', 'MONITORS'),
    defineEdge('audit-collector', 'svc-admin', 'MONITORS'),
  ];

  const inferredEdges: DemoInfraEdgeDef[] = [
    defineEdge('svc-admin', 'db-user', 'CONNECTS_TO', {
      confidence: 0.71,
      inferenceMethod: 'tags',
      confirmed: false,
    }),
    defineEdge('svc-analytics', 's3-backups', 'CONNECTS_TO', {
      confidence: 0.52,
      inferenceMethod: 'network',
      confirmed: false,
    }),
    defineEdge('crm-legacy', 'erp-db', 'CONNECTS_TO', {
      confidence: 0.49,
      inferenceMethod: 'legacy-integration',
      confirmed: false,
    }),
  ];

  return { nodes, confirmedEdges, inferredEdges };
}

function buildResilienceLayer(): DemoLayerContribution {
  const nodes: DemoInfraNodeDef[] = [
    defineNode('az-eu-west-1a', 'eu-west-1a', 'AVAILABILITY_ZONE', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { env: 'production' },
    }),
    defineNode('az-eu-west-1b', 'eu-west-1b', 'AVAILABILITY_ZONE', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      tags: { env: 'production' },
    }),
    defineNode('db-user-replica', 'user-db-replica', 'DATABASE', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      tags: { service: 'identity', role: 'replica' },
      metadata: { engine: 'PostgreSQL', replicaCount: 0, isMultiAZ: false, storageGB: 180 },
    }),
    defineNode('db-order-replica', 'order-db-replica', 'DATABASE', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      tags: { service: 'orders', role: 'replica' },
      metadata: { engine: 'PostgreSQL', replicaCount: 0, isMultiAZ: false, storageGB: 220 },
    }),
    defineNode('db-catalog-replica-1', 'catalog-db-replica-1', 'DATABASE', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      tags: { service: 'catalog', role: 'replica' },
      metadata: { engine: 'MySQL', replicaCount: 0, isMultiAZ: false, storageGB: 640 },
    }),
    defineNode('db-catalog-replica-2', 'catalog-db-replica-2', 'DATABASE', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      tags: { service: 'catalog', role: 'replica' },
      metadata: { engine: 'MySQL', replicaCount: 0, isMultiAZ: false, storageGB: 640 },
    }),
    defineNode('redis-replica', 'redis-replica', 'CACHE', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      tags: { service: 'cache', role: 'replica' },
      metadata: { engine: 'Redis', replicaCount: 0, isMultiAZ: false },
    }),
    defineNode('apm-observability', 'apm-observability', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:dynatrace:shopmax',
      tags: { service: 'observability' },
      metadata: { alerting: true },
    }),
    defineNode('alerting-hub', 'alerting-hub', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:pagerduty:shopmax',
      tags: { service: 'alerting' },
      metadata: { onCallTeam: 'sre' },
    }),
    defineNode('auth0', 'auth-service', 'THIRD_PARTY_API', 'manual', {
      externalId: 'third_party:auth0',
      tags: { service: 'auth' },
      metadata: { sla: '99.95%' },
    }),
    defineNode('servicenow', 'itsm-platform', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:servicenow:shopmax',
      tags: { service: 'itsm' },
      metadata: { workflows: ['incident', 'problem', 'change'] },
    }),
    defineNode('autoscaler-controller', 'autoscaler-controller', 'APPLICATION', 'aws', {
      region: 'eu-west-1',
      tags: { service: 'resilience' },
      metadata: { mode: 'horizontal-pod-autoscaler' },
    }),
    defineNode('readiness-probe-gateway', 'readiness-probe-gateway', 'APPLICATION', 'aws', {
      region: 'eu-west-1',
      tags: { service: 'resilience' },
      metadata: { probeIntervalSec: 30 },
    }),
    defineNode('k8s-pod-payment-1', 'pod-payment-1', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      metadata: { serviceId: 'svc-payment' },
    }),
    defineNode('k8s-pod-payment-2', 'pod-payment-2', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      metadata: { serviceId: 'svc-payment' },
    }),
    defineNode('k8s-pod-payment-3', 'pod-payment-3', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      metadata: { serviceId: 'svc-payment' },
    }),
    defineNode('k8s-pod-order-1', 'pod-order-1', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      metadata: { serviceId: 'svc-order' },
    }),
    defineNode('k8s-pod-order-2', 'pod-order-2', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      metadata: { serviceId: 'svc-order' },
    }),
    defineNode('k8s-pod-order-3', 'pod-order-3', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      metadata: { serviceId: 'svc-order' },
    }),
    defineNode('k8s-pod-user-1', 'pod-user-1', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      metadata: { serviceId: 'svc-user' },
    }),
    defineNode('k8s-pod-user-2', 'pod-user-2', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      metadata: { serviceId: 'svc-user' },
    }),
    defineNode('k8s-pod-catalog-1', 'pod-catalog-1', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      metadata: { serviceId: 'svc-catalog' },
    }),
    defineNode('k8s-pod-catalog-2', 'pod-catalog-2', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      metadata: { serviceId: 'svc-catalog' },
    }),
    defineNode('k8s-pod-gateway-1', 'pod-gateway-1', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      metadata: { serviceId: 'svc-api-gateway' },
    }),
    defineNode('k8s-pod-gateway-2', 'pod-gateway-2', 'KUBERNETES_POD', 'aws', {
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1b',
      metadata: { serviceId: 'svc-api-gateway' },
    }),
  ];

  const confirmedEdges: DemoInfraEdgeDef[] = [
    defineEdge('region-eu-west-1', 'az-eu-west-1a', 'CONTAINS'),
    defineEdge('region-eu-west-1', 'az-eu-west-1b', 'CONTAINS'),
    defineEdge('az-eu-west-1a', 'subnet-pub-1a', 'CONTAINS'),
    defineEdge('az-eu-west-1a', 'subnet-priv-1a', 'CONTAINS'),
    defineEdge('az-eu-west-1b', 'subnet-priv-1b', 'CONTAINS'),
    defineEdge('db-user', 'db-user-replica', 'REPLICATES_TO'),
    defineEdge('db-order', 'db-order-replica', 'REPLICATES_TO'),
    defineEdge('db-catalog', 'db-catalog-replica-1', 'REPLICATES_TO'),
    defineEdge('db-catalog', 'db-catalog-replica-2', 'REPLICATES_TO'),
    defineEdge('redis-main', 'redis-replica', 'REPLICATES_TO'),
    defineEdge('svc-api-gateway', 'auth0', 'AUTHENTICATES_VIA'),
    defineEdge('apm-observability', 'svc-api-gateway', 'MONITORS'),
    defineEdge('apm-observability', 'svc-payment', 'MONITORS'),
    defineEdge('apm-observability', 'svc-order', 'MONITORS'),
    defineEdge('apm-observability', 'svc-catalog', 'MONITORS'),
    defineEdge('alerting-hub', 'apm-observability', 'DEPENDS_ON'),
    defineEdge('servicenow', 'alerting-hub', 'DEPENDS_ON'),
    defineEdge('autoscaler-controller', 'eks-prod', 'MONITORS'),
    defineEdge('autoscaler-controller', 'svc-payment', 'MONITORS'),
    defineEdge('autoscaler-controller', 'svc-order', 'MONITORS'),
    defineEdge('alb-prod', 'readiness-probe-gateway', 'ROUTES_TO'),
    defineEdge('readiness-probe-gateway', 'svc-api-gateway', 'ROUTES_TO'),
    defineEdge('k8s-pod-payment-1', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-payment-2', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-payment-3', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-order-1', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-order-2', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-order-3', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-user-1', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-user-2', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-catalog-1', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-catalog-2', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-gateway-1', 'eks-prod', 'RUNS_ON'),
    defineEdge('k8s-pod-gateway-2', 'eks-prod', 'RUNS_ON'),
  ];

  return { nodes, confirmedEdges };
}

function buildDrLayer(): DemoLayerContribution {
  const nodes: DemoInfraNodeDef[] = [
    defineNode('region-eu-central-1', 'eu-central-1 (dr-standby)', 'REGION', 'aws', {
      externalId: 'aws:region:eu-central-1',
      region: 'eu-central-1',
      metadata: { role: 'dr-standby' },
    }),
    defineNode('vpc-dr', 'vpc-disaster-recovery', 'VPC', 'aws', {
      externalId: 'arn:aws:ec2:eu-central-1:123456:vpc/vpc-dr',
      region: 'eu-central-1',
      tags: { env: 'dr' },
      metadata: { cidr: '10.1.0.0/16' },
    }),
    defineNode('subnet-dr-pub-1a', 'subnet-dr-public-1a', 'SUBNET', 'aws', {
      region: 'eu-central-1',
      availabilityZone: 'eu-central-1a',
      tags: { tier: 'public', env: 'dr' },
      metadata: { cidr: '10.1.1.0/24', vpcId: 'vpc-dr' },
    }),
    defineNode('subnet-dr-priv-1a', 'subnet-dr-private-1a', 'SUBNET', 'aws', {
      region: 'eu-central-1',
      availabilityZone: 'eu-central-1a',
      tags: { tier: 'private', env: 'dr' },
      metadata: { cidr: '10.1.10.0/24', vpcId: 'vpc-dr' },
    }),
    defineNode('subnet-dr-priv-1b', 'subnet-dr-private-1b', 'SUBNET', 'aws', {
      region: 'eu-central-1',
      availabilityZone: 'eu-central-1b',
      tags: { tier: 'private', env: 'dr' },
      metadata: { cidr: '10.1.11.0/24', vpcId: 'vpc-dr' },
    }),
    defineNode('alb-dr', 'alb-disaster-recovery', 'LOAD_BALANCER', 'aws', {
      region: 'eu-central-1',
      availabilityZone: 'eu-central-1a',
      tags: { env: 'dr', mode: 'standby' },
      metadata: { scheme: 'internet-facing', type: 'application', standby: true },
    }),
    defineNode('db-payment-dr-replica', 'payment-db-dr-replica', 'DATABASE', 'aws', {
      region: 'eu-central-1',
      availabilityZone: 'eu-central-1a',
      tags: { service: 'payments', env: 'dr', role: 'replica' },
      metadata: { engine: 'PostgreSQL', replicaCount: 0, isMultiAZ: false, storageGB: 500 },
    }),
    defineNode('db-order-dr-replica', 'order-db-dr-replica', 'DATABASE', 'aws', {
      region: 'eu-central-1',
      availabilityZone: 'eu-central-1a',
      tags: { service: 'orders', env: 'dr', role: 'replica' },
      metadata: { engine: 'PostgreSQL', replicaCount: 0, isMultiAZ: false, storageGB: 220 },
    }),
    defineNode('s3-dr-backups', 'dr-backup-bucket', 'OBJECT_STORAGE', 'aws', {
      region: 'eu-central-1',
      tags: { service: 'backup', env: 'dr' },
      metadata: { versioning: true, immutableSnapshots: true },
    }),
    defineNode('dr-bastion', 'dr-bastion-host', 'VM', 'aws', {
      region: 'eu-central-1',
      availabilityZone: 'eu-central-1a',
      tags: { service: 'dr', env: 'dr' },
      metadata: { autoscaled: false },
    }),
    defineNode('dr-template-registry', 'dr-template-registry', 'APPLICATION', 'aws', {
      region: 'eu-central-1',
      tags: { service: 'dr', env: 'dr' },
      metadata: { templateCount: 14 },
    }),
    defineNode('dr-monitor', 'dr-monitoring', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:dr-monitoring:shopmax',
      tags: { service: 'dr-monitoring' },
      metadata: { heartbeatSeconds: 60 },
    }),
  ];

  const confirmedEdges: DemoInfraEdgeDef[] = [
    defineEdge('region-eu-central-1', 'vpc-dr', 'CONTAINS'),
    defineEdge('vpc-dr', 'subnet-dr-pub-1a', 'CONTAINS'),
    defineEdge('vpc-dr', 'subnet-dr-priv-1a', 'CONTAINS'),
    defineEdge('vpc-dr', 'subnet-dr-priv-1b', 'CONTAINS'),
    defineEdge('route53-shopmax', 'alb-dr', 'ROUTES_TO'),
    defineEdge('db-payment', 'db-payment-dr-replica', 'REPLICATES_TO'),
    defineEdge('db-order', 'db-order-dr-replica', 'REPLICATES_TO'),
    defineEdge('s3-backups', 's3-dr-backups', 'BACKS_UP_TO'),
    defineEdge('dr-bastion', 'vpc-dr', 'CONNECTS_TO'),
    defineEdge('dr-template-registry', 's3-dr-backups', 'CONNECTS_TO'),
    defineEdge('dr-template-registry', 'dr-bastion', 'DEPENDS_ON'),
    defineEdge('dr-monitor', 'alb-dr', 'MONITORS'),
    defineEdge('dr-monitor', 'db-payment-dr-replica', 'MONITORS'),
    defineEdge('dr-monitor', 'db-order-dr-replica', 'MONITORS'),
    defineEdge('vpc-dr', 'vpn-gateway', 'CONNECTS_TO'),
  ];

  return { nodes, confirmedEdges };
}

function buildMultiRegionLayer(): DemoLayerContribution {
  const nodes: DemoInfraNodeDef[] = [
    defineNode('region-us-east-1', 'us-east-1 (active)', 'REGION', 'aws', {
      externalId: 'aws:region:us-east-1',
      region: 'us-east-1',
      metadata: { role: 'active-secondary' },
    }),
    defineNode('vpc-secondary', 'vpc-secondary-active', 'VPC', 'aws', {
      externalId: 'arn:aws:ec2:us-east-1:123456:vpc/vpc-secondary',
      region: 'us-east-1',
      tags: { env: 'production', role: 'secondary' },
      metadata: { cidr: '10.2.0.0/16' },
    }),
    defineNode('subnet-secondary-pub-1a', 'subnet-secondary-public-1a', 'SUBNET', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      tags: { tier: 'public', role: 'secondary' },
      metadata: { cidr: '10.2.1.0/24', vpcId: 'vpc-secondary' },
    }),
    defineNode('subnet-secondary-priv-1a', 'subnet-secondary-private-1a', 'SUBNET', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      tags: { tier: 'private', role: 'secondary' },
      metadata: { cidr: '10.2.10.0/24', vpcId: 'vpc-secondary' },
    }),
    defineNode('subnet-secondary-priv-1b', 'subnet-secondary-private-1b', 'SUBNET', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1b',
      tags: { tier: 'private', role: 'secondary' },
      metadata: { cidr: '10.2.11.0/24', vpcId: 'vpc-secondary' },
    }),
    defineNode('alb-secondary', 'alb-secondary-active', 'LOAD_BALANCER', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      tags: { env: 'production', role: 'secondary' },
      metadata: { scheme: 'internet-facing', type: 'application', active: true },
    }),
    defineNode('eks-secondary', 'eks-secondary', 'KUBERNETES_CLUSTER', 'aws', {
      region: 'us-east-1',
      tags: { env: 'production', role: 'secondary' },
      metadata: { version: '1.29', nodeCount: 9, isMultiAZ: true },
    }),
    defineNode('global-load-balancer', 'global-load-balancer', 'LOAD_BALANCER', 'aws', {
      region: 'global',
      tags: { env: 'production', global: 'true' },
      metadata: { strategy: 'latency-and-health-weighted' },
    }),
    defineNode('edge-traffic-manager', 'edge-traffic-manager', 'DNS', 'aws', {
      region: 'global',
      tags: { env: 'production', global: 'true' },
      metadata: { managedFailover: true },
    }),
    defineNode('cdn-advanced', 'cdn-advanced', 'CDN', 'manual', {
      externalId: 'third_party:akamai',
      tags: { service: 'cdn', tier: 'advanced' },
      metadata: { provider: 'akamai' },
    }),
    defineNode('secrets-vault', 'secrets-vault', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:vault:corp',
      tags: { service: 'security' },
      metadata: { rotationDays: 30 },
    }),
    defineNode('container-registry', 'container-registry', 'SAAS_SERVICE', 'aws', {
      externalId: 'arn:aws:ecr:global:123456:repository/shopmax',
      tags: { service: 'platform' },
      metadata: { immutableTags: true },
    }),
    defineNode('analytics-warehouse', 'analytics-warehouse', 'DATABASE', 'aws', {
      region: 'us-east-1',
      tags: { service: 'analytics' },
      metadata: { engine: 'Redshift', multiCluster: true },
    }),
    defineNode('ml-platform', 'ml-platform', 'SAAS_SERVICE', 'aws', {
      externalId: 'arn:aws:sagemaker:us-east-1:123456:domain/demo',
      region: 'us-east-1',
      tags: { service: 'ml' },
      metadata: { mode: 'inference-and-training' },
    }),
    defineNode('service-mesh', 'service-mesh', 'APPLICATION', 'aws', {
      region: 'us-east-1',
      tags: { service: 'platform' },
      metadata: { implementation: 'istio' },
    }),
    defineNode('svc-api-gateway-secondary', 'api-gateway-secondary', 'API_GATEWAY', 'aws', {
      region: 'us-east-1',
      tags: { critical: 'true', role: 'secondary' },
      metadata: { replicas: 3 },
    }),
    defineNode('svc-payment-secondary', 'payment-service-secondary', 'MICROSERVICE', 'aws', {
      region: 'us-east-1',
      tags: { critical: 'true', role: 'secondary' },
      metadata: { replicas: 3 },
    }),
    defineNode('svc-user-secondary', 'user-service-secondary', 'MICROSERVICE', 'aws', {
      region: 'us-east-1',
      tags: { role: 'secondary' },
      metadata: { replicas: 3 },
    }),
    defineNode('svc-order-secondary', 'order-service-secondary', 'MICROSERVICE', 'aws', {
      region: 'us-east-1',
      tags: { critical: 'true', role: 'secondary' },
      metadata: { replicas: 3 },
    }),
    defineNode('svc-catalog-secondary', 'catalog-service-secondary', 'MICROSERVICE', 'aws', {
      region: 'us-east-1',
      tags: { role: 'secondary' },
      metadata: { replicas: 3 },
    }),
    defineNode('svc-notification-secondary', 'notification-service-secondary', 'MICROSERVICE', 'aws', {
      region: 'us-east-1',
      tags: { role: 'secondary' },
      metadata: { replicas: 2 },
    }),
    defineNode('db-payment-secondary', 'payment-db-secondary', 'DATABASE', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      tags: { service: 'payments', role: 'secondary' },
      metadata: { engine: 'PostgreSQL', replicaCount: 1, isMultiAZ: true },
    }),
    defineNode('db-user-secondary', 'user-db-secondary', 'DATABASE', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      tags: { service: 'identity', role: 'secondary' },
      metadata: { engine: 'PostgreSQL', replicaCount: 1, isMultiAZ: true },
    }),
    defineNode('db-order-secondary', 'order-db-secondary', 'DATABASE', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1b',
      tags: { service: 'orders', role: 'secondary' },
      metadata: { engine: 'PostgreSQL', replicaCount: 1, isMultiAZ: true },
    }),
    defineNode('db-catalog-secondary', 'catalog-db-secondary', 'DATABASE', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1b',
      tags: { service: 'catalog', role: 'secondary' },
      metadata: { engine: 'MySQL', replicaCount: 2, isMultiAZ: true },
    }),
    defineNode('redis-secondary', 'redis-secondary', 'CACHE', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      tags: { service: 'cache', role: 'secondary' },
      metadata: { engine: 'Redis', replicaCount: 1, isMultiAZ: true },
    }),
    defineNode('s3-images-secondary', 'assets-bucket-secondary', 'OBJECT_STORAGE', 'aws', {
      region: 'us-east-1',
      tags: { service: 'assets', role: 'secondary' },
      metadata: { versioning: true, crossRegionReplication: true },
    }),
    defineNode('k8s-pod-sec-api-1', 'pod-sec-api-1', 'KUBERNETES_POD', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      metadata: { serviceId: 'svc-api-gateway-secondary' },
    }),
    defineNode('k8s-pod-sec-api-2', 'pod-sec-api-2', 'KUBERNETES_POD', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1b',
      metadata: { serviceId: 'svc-api-gateway-secondary' },
    }),
    defineNode('k8s-pod-sec-payment-1', 'pod-sec-payment-1', 'KUBERNETES_POD', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      metadata: { serviceId: 'svc-payment-secondary' },
    }),
    defineNode('k8s-pod-sec-payment-2', 'pod-sec-payment-2', 'KUBERNETES_POD', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1b',
      metadata: { serviceId: 'svc-payment-secondary' },
    }),
    defineNode('k8s-pod-sec-order-1', 'pod-sec-order-1', 'KUBERNETES_POD', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      metadata: { serviceId: 'svc-order-secondary' },
    }),
    defineNode('k8s-pod-sec-order-2', 'pod-sec-order-2', 'KUBERNETES_POD', 'aws', {
      region: 'us-east-1',
      availabilityZone: 'us-east-1b',
      metadata: { serviceId: 'svc-order-secondary' },
    }),
  ];

  const confirmedEdges: DemoInfraEdgeDef[] = [
    defineEdge('region-us-east-1', 'vpc-secondary', 'CONTAINS'),
    defineEdge('vpc-secondary', 'subnet-secondary-pub-1a', 'CONTAINS'),
    defineEdge('vpc-secondary', 'subnet-secondary-priv-1a', 'CONTAINS'),
    defineEdge('vpc-secondary', 'subnet-secondary-priv-1b', 'CONTAINS'),
    defineEdge('global-load-balancer', 'alb-prod', 'ROUTES_TO'),
    defineEdge('global-load-balancer', 'alb-secondary', 'ROUTES_TO'),
    defineEdge('edge-traffic-manager', 'global-load-balancer', 'ROUTES_TO'),
    defineEdge('cdn-advanced', 'edge-traffic-manager', 'ROUTES_TO'),
    defineEdge('route53-shopmax', 'global-load-balancer', 'ROUTES_TO'),
    defineEdge('alb-secondary', 'svc-api-gateway-secondary', 'ROUTES_TO'),
    defineEdge('svc-api-gateway-secondary', 'svc-payment-secondary', 'ROUTES_TO'),
    defineEdge('svc-api-gateway-secondary', 'svc-user-secondary', 'ROUTES_TO'),
    defineEdge('svc-api-gateway-secondary', 'svc-order-secondary', 'ROUTES_TO'),
    defineEdge('svc-api-gateway-secondary', 'svc-catalog-secondary', 'ROUTES_TO'),
    defineEdge('svc-api-gateway-secondary', 'svc-notification-secondary', 'ROUTES_TO'),
    defineEdge('svc-api-gateway-secondary', 'redis-secondary', 'CONNECTS_TO'),
    defineEdge('svc-payment-secondary', 'db-payment-secondary', 'CONNECTS_TO'),
    defineEdge('svc-user-secondary', 'db-user-secondary', 'CONNECTS_TO'),
    defineEdge('svc-order-secondary', 'db-order-secondary', 'CONNECTS_TO'),
    defineEdge('svc-catalog-secondary', 'db-catalog-secondary', 'CONNECTS_TO'),
    defineEdge('svc-notification-secondary', 'sqs-notifications', 'SUBSCRIBES_TO'),
    defineEdge('eks-secondary', 'subnet-secondary-priv-1a', 'RUNS_ON'),
    defineEdge('eks-secondary', 'subnet-secondary-priv-1b', 'RUNS_ON'),
    defineEdge('svc-api-gateway-secondary', 'eks-secondary', 'RUNS_ON'),
    defineEdge('svc-payment-secondary', 'eks-secondary', 'RUNS_ON'),
    defineEdge('svc-user-secondary', 'eks-secondary', 'RUNS_ON'),
    defineEdge('svc-order-secondary', 'eks-secondary', 'RUNS_ON'),
    defineEdge('svc-catalog-secondary', 'eks-secondary', 'RUNS_ON'),
    defineEdge('svc-notification-secondary', 'eks-secondary', 'RUNS_ON'),
    defineEdge('db-payment', 'db-payment-secondary', 'REPLICATES_TO'),
    defineEdge('db-user', 'db-user-secondary', 'REPLICATES_TO'),
    defineEdge('db-order', 'db-order-secondary', 'REPLICATES_TO'),
    defineEdge('db-catalog', 'db-catalog-secondary', 'REPLICATES_TO'),
    defineEdge('s3-images', 's3-images-secondary', 'REPLICATES_TO'),
    defineEdge('service-mesh', 'svc-api-gateway-secondary', 'MONITORS'),
    defineEdge('service-mesh', 'svc-payment-secondary', 'MONITORS'),
    defineEdge('service-mesh', 'svc-order-secondary', 'MONITORS'),
    defineEdge('secrets-vault', 'svc-api-gateway-secondary', 'AUTHENTICATES_VIA'),
    defineEdge('container-registry', 'ci-cd-pipeline', 'DEPENDS_ON'),
    defineEdge('analytics-warehouse', 'db-order-secondary', 'CONNECTS_TO'),
    defineEdge('analytics-warehouse', 'db-main', 'CONNECTS_TO'),
    defineEdge('ml-platform', 'analytics-warehouse', 'DEPENDS_ON'),
    defineEdge('k8s-pod-sec-api-1', 'eks-secondary', 'RUNS_ON'),
    defineEdge('k8s-pod-sec-api-2', 'eks-secondary', 'RUNS_ON'),
    defineEdge('k8s-pod-sec-payment-1', 'eks-secondary', 'RUNS_ON'),
    defineEdge('k8s-pod-sec-payment-2', 'eks-secondary', 'RUNS_ON'),
    defineEdge('k8s-pod-sec-order-1', 'eks-secondary', 'RUNS_ON'),
    defineEdge('k8s-pod-sec-order-2', 'eks-secondary', 'RUNS_ON'),
    defineEdge('datadog', 'global-load-balancer', 'MONITORS'),
    defineEdge('datadog', 'analytics-warehouse', 'MONITORS'),
  ];

  return { nodes, confirmedEdges };
}

function buildExtendedLegacyLayer(): DemoLayerContribution {
  const nodes: DemoInfraNodeDef[] = [
    defineNode('data-center-primary', 'datacenter-primary', 'DATA_CENTER', 'on_premise', {
      tags: { site: 'hq' },
      metadata: { location: 'Paris' },
    }),
    defineNode('data-center-secondary', 'datacenter-secondary', 'DATA_CENTER', 'on_premise', {
      tags: { site: 'backup' },
      metadata: { location: 'Lyon' },
    }),
    defineNode('onprem-ad', 'active-directory', 'PHYSICAL_SERVER', 'on_premise', {
      tags: { service: 'identity', legacy: 'true' },
      metadata: { ip: '192.168.10.10' },
    }),
    defineNode('onprem-file-server', 'onprem-file-server', 'PHYSICAL_SERVER', 'on_premise', {
      tags: { service: 'file-storage' },
      metadata: { ip: '192.168.10.11' },
    }),
    defineNode('onprem-backup-server', 'onprem-backup-server', 'PHYSICAL_SERVER', 'on_premise', {
      tags: { service: 'backup' },
      metadata: { ip: '192.168.10.12' },
    }),
    defineNode('onprem-erp-2', 'legacy-erp-secondary', 'PHYSICAL_SERVER', 'on_premise', {
      tags: { service: 'erp', legacy: 'true' },
      metadata: { ip: '192.168.10.20' },
    }),
    defineNode('onprem-legacy-db2', 'legacy-db-secondary', 'DATABASE', 'on_premise', {
      tags: { service: 'legacy-db', legacy: 'true' },
      metadata: { ip: '192.168.10.21', engine: 'Oracle', replicaCount: 0, isMultiAZ: false },
    }),
    defineNode('onprem-legacy-app', 'legacy-app-server', 'PHYSICAL_SERVER', 'on_premise', {
      tags: { service: 'legacy-app', legacy: 'true' },
      metadata: { ip: '192.168.10.22' },
    }),
    defineNode('mpls-router-hq', 'mpls-router-hq', 'NETWORK_DEVICE', 'on_premise', {
      tags: { service: 'network', site: 'hq' },
      metadata: { ip: '192.168.10.1' },
    }),
    defineNode('mpls-router-branch', 'mpls-router-branch', 'NETWORK_DEVICE', 'on_premise', {
      tags: { service: 'network', site: 'branch' },
      metadata: { ip: '192.168.20.1' },
    }),
    defineNode('partner-api-1', 'partner-api-1', 'THIRD_PARTY_API', 'manual', {
      externalId: 'third_party:partner-1',
      tags: { service: 'partner' },
      metadata: { partner: 'logistics' },
    }),
    defineNode('partner-api-2', 'partner-api-2', 'THIRD_PARTY_API', 'manual', {
      externalId: 'third_party:partner-2',
      tags: { service: 'partner' },
      metadata: { partner: 'payments' },
    }),
    defineNode('partner-api-3', 'partner-api-3', 'THIRD_PARTY_API', 'manual', {
      externalId: 'third_party:partner-3',
      tags: { service: 'partner' },
      metadata: { partner: 'supply-chain' },
    }),
    defineNode('siem-platform', 'siem-platform', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:splunk:shopmax',
      tags: { service: 'security' },
      metadata: { useCaseCount: 24 },
    }),
    defineNode('dlp-suite', 'dlp-suite', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:dlp:shopmax',
      tags: { service: 'security' },
      metadata: { endpointCoveragePercent: 92 },
    }),
    defineNode('backup-suite', 'backup-suite', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:veeam:shopmax',
      tags: { service: 'backup' },
      metadata: { immutableBackups: true },
    }),
    defineNode('azure-vnet', 'azure-vnet-secondary', 'VPC', 'azure', {
      externalId: 'azure:vnet:stronghold-secondary',
      region: 'westeurope',
      tags: { env: 'production', provider: 'azure' },
      metadata: { cidr: '10.3.0.0/16' },
    }),
    defineNode('azure-app-gateway', 'azure-app-gateway', 'LOAD_BALANCER', 'azure', {
      externalId: 'azure:app-gateway:stronghold',
      region: 'westeurope',
      tags: { provider: 'azure' },
      metadata: { wafEnabled: true },
    }),
    defineNode('azure-analytics-node', 'azure-analytics-node', 'APPLICATION', 'azure', {
      externalId: 'azure:aks:analytics-node',
      region: 'westeurope',
      tags: { provider: 'azure', service: 'analytics' },
      metadata: { runtime: 'dotnet' },
    }),
    defineNode('azure-storage-archive', 'azure-storage-archive', 'OBJECT_STORAGE', 'azure', {
      externalId: 'azure:storage:archive',
      region: 'westeurope',
      tags: { provider: 'azure', service: 'archive' },
      metadata: { immutable: true },
    }),
    defineNode('azure-sql-replica', 'azure-sql-replica', 'DATABASE', 'azure', {
      externalId: 'azure:sql:replica',
      region: 'westeurope',
      tags: { provider: 'azure', service: 'database' },
      metadata: { engine: 'Azure SQL', replicaCount: 1, isMultiAZ: true },
    }),
    defineNode('gcp-vpc-analytics', 'gcp-vpc-analytics', 'VPC', 'gcp', {
      externalId: 'gcp:vpc:analytics',
      region: 'europe-west1',
      tags: { provider: 'gcp', env: 'production' },
      metadata: { cidr: '10.4.0.0/16' },
    }),
    defineNode('gcp-compute-batch', 'gcp-batch-worker', 'APPLICATION', 'gcp', {
      externalId: 'gcp:compute:batch-worker',
      region: 'europe-west1',
      availabilityZone: 'europe-west1-b',
      tags: { provider: 'gcp', service: 'batch' },
      metadata: { runtime: 'go1.24' },
    }),
    defineNode('gcp-cloudsql-orders', 'gcp-cloudsql-orders', 'DATABASE', 'gcp', {
      externalId: 'gcp:cloudsql:orders',
      region: 'europe-west1',
      tags: { provider: 'gcp', service: 'orders' },
      metadata: { engine: 'PostgreSQL' },
    }),
    defineNode('gcp-memorystore-shared', 'gcp-memorystore-shared', 'CACHE', 'gcp', {
      externalId: 'gcp:memorystore:shared',
      region: 'europe-west1',
      tags: { provider: 'gcp', service: 'cache' },
      metadata: { engine: 'Redis' },
    }),
    defineNode('gcp-storage-archive', 'gcp-storage-archive', 'OBJECT_STORAGE', 'gcp', {
      externalId: 'gcp:storage:archive',
      region: 'europe-west1',
      tags: { provider: 'gcp', service: 'archive' },
      metadata: { storageClass: 'NEARLINE' },
    }),
    defineNode('multi-cloud-vpn', 'multi-cloud-vpn', 'NETWORK_DEVICE', 'manual', {
      tags: { service: 'network' },
      metadata: { links: ['aws', 'azure', 'gcp'] },
    }),
    defineNode('integration-bus', 'integration-bus', 'MESSAGE_QUEUE', 'aws', {
      region: 'eu-west-1',
      tags: { service: 'integration' },
      metadata: { mode: 'event-bridge' },
    }),
    defineNode('endpoint-sec-manager', 'endpoint-security-manager', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:edr:shopmax',
      tags: { service: 'security' },
      metadata: { endpointCoveragePercent: 97 },
    }),
    defineNode('identity-federation', 'identity-federation', 'SAAS_SERVICE', 'manual', {
      externalId: 'saas:okta:federation',
      tags: { service: 'identity' },
      metadata: { providers: ['okta', 'auth0', 'adfs'] },
    }),
    defineNode('support-portal', 'support-portal', 'APPLICATION', 'aws', {
      region: 'eu-west-1',
      tags: { service: 'support' },
      metadata: { replicas: 2 },
    }),
    defineNode('branch-office-vpn-1', 'branch-office-vpn-1', 'NETWORK_DEVICE', 'on_premise', {
      tags: { service: 'network', site: 'branch-1' },
      metadata: { ip: '192.168.30.1' },
    }),
    defineNode('branch-office-vpn-2', 'branch-office-vpn-2', 'NETWORK_DEVICE', 'on_premise', {
      tags: { service: 'network', site: 'branch-2' },
      metadata: { ip: '192.168.31.1' },
    }),
    defineNode('branch-office-vpn-3', 'branch-office-vpn-3', 'NETWORK_DEVICE', 'on_premise', {
      tags: { service: 'network', site: 'branch-3' },
      metadata: { ip: '192.168.32.1' },
    }),
    defineNode('regional-file-cache-1', 'regional-file-cache-1', 'CACHE', 'on_premise', {
      tags: { service: 'file-cache' },
      metadata: { site: 'branch-1' },
    }),
    defineNode('regional-file-cache-2', 'regional-file-cache-2', 'CACHE', 'on_premise', {
      tags: { service: 'file-cache' },
      metadata: { site: 'branch-2' },
    }),
    defineNode('regional-file-cache-3', 'regional-file-cache-3', 'CACHE', 'on_premise', {
      tags: { service: 'file-cache' },
      metadata: { site: 'branch-3' },
    }),
    defineNode('regional-file-cache-4', 'regional-file-cache-4', 'CACHE', 'on_premise', {
      tags: { service: 'file-cache' },
      metadata: { site: 'hq' },
    }),
    defineNode('partner-gateway', 'partner-gateway', 'API_GATEWAY', 'aws', {
      region: 'eu-west-1',
      tags: { service: 'partner', critical: 'true' },
      metadata: { replicas: 1 },
    }),
    defineNode('backup-tape-library', 'backup-tape-library', 'PHYSICAL_SERVER', 'on_premise', {
      tags: { service: 'backup' },
      metadata: { type: 'lto' },
    }),
    defineNode('dr-datacenter-link', 'dr-datacenter-link', 'NETWORK_DEVICE', 'on_premise', {
      tags: { service: 'network', site: 'dr-link' },
      metadata: { medium: 'mpls' },
    }),
  ];

  const confirmedEdges: DemoInfraEdgeDef[] = [
    defineEdge('data-center-primary', 'erp-server', 'CONTAINS'),
    defineEdge('data-center-primary', 'erp-db', 'CONTAINS'),
    defineEdge('data-center-primary', 'onprem-ad', 'CONTAINS'),
    defineEdge('data-center-primary', 'onprem-file-server', 'CONTAINS'),
    defineEdge('data-center-primary', 'onprem-backup-server', 'CONTAINS'),
    defineEdge('data-center-secondary', 'onprem-erp-2', 'CONTAINS'),
    defineEdge('data-center-secondary', 'onprem-legacy-db2', 'CONTAINS'),
    defineEdge('data-center-secondary', 'onprem-legacy-app', 'CONTAINS'),
    defineEdge('onprem-erp-2', 'onprem-legacy-db2', 'CONNECTS_TO'),
    defineEdge('onprem-legacy-app', 'onprem-legacy-db2', 'CONNECTS_TO'),
    defineEdge('onprem-ad', 'identity-federation', 'AUTHENTICATES_VIA'),
    defineEdge('mpls-router-hq', 'vpn-gateway', 'CONNECTS_TO'),
    defineEdge('mpls-router-hq', 'mpls-router-branch', 'CONNECTS_TO'),
    defineEdge('mpls-router-branch', 'branch-office-vpn-1', 'CONNECTS_TO'),
    defineEdge('mpls-router-branch', 'branch-office-vpn-2', 'CONNECTS_TO'),
    defineEdge('mpls-router-branch', 'branch-office-vpn-3', 'CONNECTS_TO'),
    defineEdge('branch-office-vpn-1', 'regional-file-cache-1', 'CONNECTS_TO'),
    defineEdge('branch-office-vpn-2', 'regional-file-cache-2', 'CONNECTS_TO'),
    defineEdge('branch-office-vpn-3', 'regional-file-cache-3', 'CONNECTS_TO'),
    defineEdge('vpn-gateway', 'regional-file-cache-4', 'CONNECTS_TO'),
    defineEdge('partner-gateway', 'partner-api-1', 'ROUTES_TO'),
    defineEdge('partner-gateway', 'partner-api-2', 'ROUTES_TO'),
    defineEdge('partner-gateway', 'partner-api-3', 'ROUTES_TO'),
    defineEdge('svc-order', 'partner-gateway', 'DEPENDS_ON'),
    defineEdge('integration-bus', 'svc-order', 'SUBSCRIBES_TO'),
    defineEdge('integration-bus', 'svc-notification', 'PUBLISHES_TO'),
    defineEdge('integration-bus', 'partner-gateway', 'PUBLISHES_TO'),
    defineEdge('siem-platform', 'waf-prod', 'MONITORS'),
    defineEdge('siem-platform', 'global-load-balancer', 'MONITORS'),
    defineEdge('siem-platform', 'vpn-gateway', 'MONITORS'),
    defineEdge('siem-platform', 'partner-gateway', 'MONITORS'),
    defineEdge('dlp-suite', 's3-images', 'MONITORS'),
    defineEdge('dlp-suite', 's3-backups', 'MONITORS'),
    defineEdge('backup-suite', 's3-backups', 'BACKS_UP_TO'),
    defineEdge('backup-suite', 's3-dr-backups', 'BACKS_UP_TO'),
    defineEdge('backup-suite', 'azure-storage-archive', 'BACKS_UP_TO'),
    defineEdge('backup-suite', 'backup-tape-library', 'BACKS_UP_TO'),
    defineEdge('backup-suite', 'onprem-backup-server', 'CONNECTS_TO'),
    defineEdge('onprem-backup-server', 'backup-tape-library', 'CONNECTS_TO'),
    defineEdge('azure-vnet', 'azure-app-gateway', 'CONTAINS'),
    defineEdge('azure-vnet', 'azure-analytics-node', 'CONTAINS'),
    defineEdge('azure-vnet', 'azure-storage-archive', 'CONTAINS'),
    defineEdge('azure-vnet', 'azure-sql-replica', 'CONTAINS'),
    defineEdge('azure-app-gateway', 'azure-analytics-node', 'ROUTES_TO'),
    defineEdge('azure-analytics-node', 'azure-sql-replica', 'CONNECTS_TO'),
    defineEdge('azure-analytics-node', 'analytics-warehouse', 'DEPENDS_ON'),
    defineEdge('gcp-vpc-analytics', 'gcp-compute-batch', 'CONTAINS'),
    defineEdge('gcp-vpc-analytics', 'gcp-cloudsql-orders', 'CONTAINS'),
    defineEdge('gcp-vpc-analytics', 'gcp-memorystore-shared', 'CONTAINS'),
    defineEdge('gcp-vpc-analytics', 'gcp-storage-archive', 'CONTAINS'),
    defineEdge('gcp-compute-batch', 'gcp-cloudsql-orders', 'CONNECTS_TO'),
    defineEdge('gcp-compute-batch', 'gcp-memorystore-shared', 'CONNECTS_TO'),
    defineEdge('gcp-compute-batch', 'gcp-storage-archive', 'CONNECTS_TO'),
    defineEdge('svc-order', 'gcp-compute-batch', 'DEPENDS_ON'),
    defineEdge('db-main', 'azure-sql-replica', 'REPLICATES_TO'),
    defineEdge('multi-cloud-vpn', 'vpc-prod', 'CONNECTS_TO'),
    defineEdge('multi-cloud-vpn', 'azure-vnet', 'CONNECTS_TO'),
    defineEdge('multi-cloud-vpn', 'gcp-vpc-analytics', 'CONNECTS_TO'),
    defineEdge('support-portal', 'svc-user', 'DEPENDS_ON'),
    defineEdge('support-portal', 'regional-file-cache-4', 'CONNECTS_TO'),
    defineEdge('endpoint-sec-manager', 'support-portal', 'MONITORS'),
    defineEdge('identity-federation', 'svc-api-gateway', 'AUTHENTICATES_VIA'),
    defineEdge('backup-suite', 'gcp-storage-archive', 'BACKS_UP_TO'),
    defineEdge('dr-datacenter-link', 'data-center-primary', 'CONNECTS_TO'),
    defineEdge('dr-datacenter-link', 'data-center-secondary', 'CONNECTS_TO'),
  ];

  const inferredEdges: DemoInfraEdgeDef[] = [
    defineEdge('onprem-legacy-app', 'svc-order', 'DEPENDS_ON', {
      confidence: 0.51,
      inferenceMethod: 'traffic-pattern',
      confirmed: false,
    }),
    defineEdge('partner-api-2', 'db-payment-secondary', 'CONNECTS_TO', {
      confidence: 0.43,
      inferenceMethod: 'vendor-docs',
      confirmed: false,
    }),
  ];

  return { nodes, confirmedEdges, inferredEdges };
}

function edgeKey(edge: DemoInfraEdgeDef): string {
  return `${edge.sourceId}|${edge.type}|${edge.targetId}`;
}

function normalizeEdge(edge: DemoInfraEdgeDef): DemoInfraEdgeDef {
  const normalized: DemoInfraEdgeDef = {
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    type: edge.type,
  };

  if (edge.confidence !== undefined) {
    normalized.confidence = edge.confidence;
  }
  if (edge.inferenceMethod !== undefined) {
    normalized.inferenceMethod = edge.inferenceMethod;
  }
  if (edge.confirmed !== undefined) {
    normalized.confirmed = edge.confirmed;
  }

  return normalized;
}

function getLayerContribution(layer: DemoInfrastructureLayerName): DemoLayerContribution {
  switch (layer) {
    case 'core':
      return buildCoreLayer();
    case 'microservices':
      return buildMicroservicesLayer();
    case 'resilience':
      return buildResilienceLayer();
    case 'dr':
      return buildDrLayer();
    case 'multi_region':
      return buildMultiRegionLayer();
    case 'legacy_extended':
      return buildExtendedLegacyLayer();
    default:
      return { nodes: [], confirmedEdges: [] };
  }
}

function applySectorLabels(
  nodes: DemoInfraNodeDef[],
  sector: DemoSectorKey,
): DemoInfraNodeDef[] {
  const labels = SECTOR_LABELS[sector];
  return nodes.map((node) => {
    const key = String(node.metadata.genericLabelKey ?? '') as GenericLabelKey;
    const mappedName = labels[key];
    if (!mappedName) return node;
    return {
      ...node,
      name: mappedName,
      metadata: {
        ...node.metadata,
        sectorLabelApplied: true,
      },
    };
  });
}

function injectSPOFs(
  nodes: DemoInfraNodeDef[],
  companySize: DemoCompanySizeKey,
): DemoInfraNodeDef[] {
  const spofIds = new Set(SIZE_SPOF_IDS[companySize]);

  return nodes.map((node) => {
    if (!spofIds.has(node.id)) return node;

    const nextMetadata: Record<string, unknown> = {
      ...node.metadata,
      intentionalSpof: true,
    };

    if (node.type === 'DATABASE') {
      nextMetadata.isMultiAZ = false;
      nextMetadata.replicaCount = 0;
    }
    if (node.type === 'APPLICATION' || node.type === 'MICROSERVICE' || node.type === 'API_GATEWAY') {
      nextMetadata.replicas = 1;
    }

    return {
      ...node,
      tags: {
        ...node.tags,
        intentional_spof: 'true',
      },
      metadata: nextMetadata,
    };
  });
}

function inferSourceType(node: DemoInfraNodeDef): string | null {
  const type = String(node.type || '').toUpperCase();
  const provider = String(node.provider || '').toLowerCase();
  if (type === 'DATABASE') {
    if (provider === 'azure') return 'sqlDatabase';
    if (provider === 'gcp') return 'cloudSQL';
    return 'RDS';
  }
  if (type === 'CACHE') {
    if (provider === 'azure') return 'azureRedis';
    if (provider === 'gcp') return 'memorystore';
    return 'ELASTICACHE';
  }
  if (type === 'SERVERLESS') {
    if (provider === 'azure') return 'functions';
    if (provider === 'gcp') return 'cloudFunctions';
    return 'LAMBDA';
  }
  if (type === 'VM' || type === 'PHYSICAL_SERVER') {
    if (provider === 'azure') return 'virtualMachine';
    if (provider === 'gcp') return 'computeEngine';
    return 'EC2';
  }
  if (type === 'APPLICATION' || type === 'MICROSERVICE' || type === 'CONTAINER') {
    if (provider === 'azure') return 'virtualMachine';
    if (provider === 'gcp') return 'computeEngine';
    return 'ECS_SERVICE';
  }
  if (type === 'LOAD_BALANCER') {
    if (provider === 'azure') return 'applicationGateway';
    if (provider === 'gcp') return 'httpLoadBalancer';
    return 'ALB';
  }
  if (type === 'OBJECT_STORAGE' || type === 'FILE_STORAGE') {
    if (provider === 'azure') return 'storageAccount';
    if (provider === 'gcp') return 'cloudStorage';
    return 'S3_BUCKET';
  }
  if (type === 'API_GATEWAY') {
    if (provider === 'azure') return 'applicationGateway';
    return 'API_GATEWAY';
  }
  if (type === 'MESSAGE_QUEUE') {
    const external = String(node.externalId || '').toLowerCase();
    const name = String(node.name || '').toLowerCase();
    if (provider === 'gcp') return 'pubsub';
    if (provider === 'azure') return 'serviceBus';
    if (external.includes(':sns:') || name.includes('topic') || name.includes('sns')) return 'SNS_TOPIC';
    return 'SQS_QUEUE';
  }
  return null;
}

function applyDemoPricingMetadata(nodes: DemoInfraNodeDef[]): DemoInfraNodeDef[] {
  return nodes.map((node) => {
    const metadata: Record<string, unknown> = {
      demoData: true,
      demoSeed: true,
      seededBy: 'demoInfrastructureFactory',
      ...(node.metadata || {}),
    };
    Object.assign(metadata, buildCommonDemoMetadata(node, metadata));
    const tags = node.tags || {};
    const nodeId = String(node.id || '');
    const nodeName = String(node.name || '').toLowerCase();
    const isSecondaryRegion = nodeId.includes('secondary') || tags.role === 'secondary';
    const isCritical =
      String(tags.critical || '').toLowerCase() === 'true' ||
      nodeId.includes('payment') ||
      nodeId.includes('gateway') ||
      nodeId.includes('order') ||
      nodeId.includes('main');

    if (
      !metadata.kubernetesClusterId &&
      ['APPLICATION', 'MICROSERVICE', 'KUBERNETES_POD', 'KUBERNETES_SERVICE'].includes(node.type) &&
      node.provider === 'aws'
    ) {
      metadata.kubernetesClusterId = isSecondaryRegion ? 'eks-secondary' : 'eks-prod';
    }

    if (!metadata.ingressProgramKey && ['API_GATEWAY', 'LOAD_BALANCER', 'DNS', 'CDN'].includes(node.type)) {
      metadata.ingressProgramKey = isSecondaryRegion ? 'shopmax-edge-secondary' : 'shopmax-edge-primary';
    }

    if (!metadata.replicationProgramKey && node.type === 'OBJECT_STORAGE') {
      metadata.replicationProgramKey = nodeName.includes('backup') || nodeName.includes('archive')
        ? 'backup-archive-program'
        : 'assets-replication-program';
    }

    if (!metadata.instanceType && ['APPLICATION', 'MICROSERVICE', 'VM', 'PHYSICAL_SERVER'].includes(node.type)) {
      const instanceType =
        node.type === 'PHYSICAL_SERVER'
          ? isCritical
            ? 'm5.large'
            : 't3.medium'
          : nodeId.includes('admin') || nodeId.includes('probe') || nodeId.includes('autoscaler')
            ? 't3.micro'
            : nodeId.includes('analytics') || nodeId.includes('search')
              ? 'c5.xlarge'
              : nodeId.includes('catalog') || nodeId.includes('main-app') || nodeId.includes('support')
                ? 't3.medium'
                : isCritical
                  ? 'm5.large'
                  : 't3.micro';

      metadata.instanceType = instanceType;
      metadata.vcpu =
        instanceType === 'c5.xlarge' ? 4 : instanceType === 'm5.large' ? 2 : instanceType === 't3.medium' ? 2 : 2;
      metadata.memoryGb =
        instanceType === 'c5.xlarge' ? 8 : instanceType === 'm5.large' ? 8 : instanceType === 't3.medium' ? 4 : 1;
    }

    if (node.type === 'DATABASE') {
      const baseClusterId =
        nodeId.includes('payment')
          ? 'payment-db-cluster'
          : nodeId.includes('user')
            ? 'user-db-cluster'
            : nodeId.includes('order')
              ? 'order-db-cluster'
              : nodeId.includes('catalog')
                ? 'catalog-db-cluster'
                : nodeId.includes('main')
                  ? 'main-db-cluster'
                  : nodeId.includes('admin')
                    ? 'admin-db-cluster'
                    : nodeId.includes('analytics')
                      ? 'analytics-warehouse-cluster'
                      : nodeId.includes('erp')
                        ? 'erp-db-cluster'
                        : nodeId;
      if (!metadata.clusterId) {
        metadata.clusterId = baseClusterId;
      }

      if (!metadata.dbInstanceClass) {
        const dbInstanceClass =
          nodeId.includes('payment') || nodeId.includes('analytics')
            ? 'db.r5.large'
            : nodeId.includes('replica') || nodeId.includes('admin')
              ? 'db.t3.micro'
              : 'db.t3.medium';
        metadata.dbInstanceClass = dbInstanceClass;
        metadata.instanceType = metadata.instanceType ?? dbInstanceClass;
        metadata.memoryGb =
          dbInstanceClass === 'db.r5.large' ? 16 : dbInstanceClass === 'db.t3.medium' ? 4 : 1;
      }
    }

    if (node.type === 'CACHE' && !metadata.cacheNodeType) {
      const cacheNodeType =
        nodeId.includes('secondary') || nodeId.includes('replica')
          ? 'cache.t3.small'
          : nodeId.includes('admin')
            ? 'cache.t3.micro'
            : 'cache.r5.large';
      metadata.cacheNodeType = cacheNodeType;
      metadata.instanceType = metadata.instanceType ?? cacheNodeType;
      metadata.clusterId =
        metadata.clusterId ??
        (nodeId.includes('redis') ? 'redis-main-cluster' : `${nodeId}-cache-cluster`);
    }

    if (node.type === 'SERVERLESS') {
      metadata.memorySize =
        metadata.memorySize ??
        (nodeId.includes('backup') ? 128 : nodeId.includes('image') ? 1024 : 512);
      metadata.estimatedMonthlyInvocations =
        metadata.estimatedMonthlyInvocations ??
        (nodeId.includes('backup') ? 800_000 : nodeId.includes('image') ? 6_000_000 : 2_500_000);
    }

    if (node.type === 'OBJECT_STORAGE') {
      metadata.estimatedStorageGB =
        metadata.estimatedStorageGB ??
        (nodeId.includes('backup')
          ? 1_500
          : nodeId.includes('archive')
            ? 850
            : isSecondaryRegion
              ? 520
              : 500);
    }

    if (node.type === 'LOAD_BALANCER') {
      metadata.estimatedLcu =
        metadata.estimatedLcu ??
        (nodeId.includes('global')
          ? 6
          : nodeId.includes('dr')
            ? 1
            : isSecondaryRegion
              ? 2
              : 3.5);
    }

    if (node.type === 'MESSAGE_QUEUE') {
      metadata.estimatedMonthlyRequests =
        metadata.estimatedMonthlyRequests ??
        (nodeId.includes('notification') ? 18_000_000 : 7_500_000);
    }

    if (
      !metadata.drCostGroupKey &&
      ['APPLICATION', 'MICROSERVICE', 'KUBERNETES_POD', 'KUBERNETES_SERVICE'].includes(node.type) &&
      typeof metadata.kubernetesClusterId === 'string'
    ) {
      metadata.drCostGroupKey = `cluster:${metadata.kubernetesClusterId}`;
    }

    if (!metadata.drCostGroupKey && typeof metadata.replicationProgramKey === 'string') {
      metadata.drCostGroupKey = `storage:${metadata.replicationProgramKey}`;
    }

    if (!metadata.drCostGroupKey && typeof metadata.ingressProgramKey === 'string' && node.type !== 'CDN') {
      metadata.drCostGroupKey = `ingress:${metadata.ingressProgramKey}`;
    }

    const protectionLevel = resolveProtectionLevel(node, metadata);
    const { templateType, templateMetadata } = buildTemplateMetadata(node, metadata, protectionLevel);
    for (const [key, value] of Object.entries(templateMetadata)) {
      if (hasUsableMetadataValue(metadata, key)) continue;
      metadata[key] = value;
    }
    metadata.protectionLevel = protectionLevel;
    metadata.protectionProfile = protectionLevel;
    applyIntentionalMetadataGaps(node, metadata, templateType);

    return {
      ...node,
      metadata,
    };
  });
}

function enrichNodesForInference(
  nodes: DemoInfraNodeDef[],
  edges: DemoInfraEdgeDef[],
): DemoInfraNodeDef[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTargetId = new Map<string, DemoInfraEdgeDef[]>();
  const outgoingBySourceId = new Map<string, DemoInfraEdgeDef[]>();

  for (const edge of edges) {
    if (!incomingByTargetId.has(edge.targetId)) incomingByTargetId.set(edge.targetId, []);
    incomingByTargetId.get(edge.targetId)!.push(edge);
    if (!outgoingBySourceId.has(edge.sourceId)) outgoingBySourceId.set(edge.sourceId, []);
    outgoingBySourceId.get(edge.sourceId)!.push(edge);
  }

  return nodes.map((node) => {
    const metadata: Record<string, unknown> = {
      ...(node.metadata || {}),
    };

    const sourceType = inferSourceType(node);
    if (!metadata.sourceType && sourceType) {
      metadata.sourceType = sourceType;
    }

    if (node.type === 'MESSAGE_QUEUE') {
      const externalId = String(node.externalId || '');
      if (externalId.startsWith('arn:aws:sqs:') && !metadata.queueArn) {
        metadata.queueArn = externalId;
      }
      if (externalId.startsWith('arn:aws:sns:') && !metadata.topicArn) {
        metadata.topicArn = externalId;
      }
    }

    if (node.type === 'SERVERLESS') {
      const incoming = incomingByTargetId.get(node.id) || [];
      const eventSourceMappings = incoming
        .map((edge) => nodeById.get(edge.sourceId))
        .filter((source): source is DemoInfraNodeDef => Boolean(source))
        .filter((source) => source.type === 'MESSAGE_QUEUE')
        .map((source) => {
          const sourceArn = String(source.externalId || '');
          if (!sourceArn.startsWith('arn:')) return null;
          return { eventSourceArn: sourceArn, batchSize: 10 };
        })
        .filter((mapping): mapping is { eventSourceArn: string; batchSize: number } => Boolean(mapping));

      if (eventSourceMappings.length > 0 && !Array.isArray(metadata.eventSourceMappings)) {
        metadata.eventSourceMappings = eventSourceMappings;
      }

      const outgoing = outgoingBySourceId.get(node.id) || [];
      const environmentReferences: Array<{ varName: string; referenceType: string; value: string }> = [];
      for (const edge of outgoing) {
        const target = nodeById.get(edge.targetId);
        if (!target) continue;
        const targetId = String(target.externalId || target.id || '');
        if (!targetId) continue;

        if (target.type === 'DATABASE') {
          environmentReferences.push({
            varName: 'DATABASE_ARN',
            referenceType: 'arn',
            value: targetId,
          });
        } else if (target.type === 'CACHE') {
          environmentReferences.push({
            varName: 'CACHE_ARN',
            referenceType: 'arn',
            value: targetId,
          });
        } else if (target.type === 'MESSAGE_QUEUE') {
          environmentReferences.push({
            varName: 'QUEUE_ARN',
            referenceType: 'arn',
            value: targetId,
          });
        } else if (target.type === 'OBJECT_STORAGE') {
          environmentReferences.push({
            varName: 'BUCKET_ARN',
            referenceType: 'arn',
            value: targetId,
          });
        }
      }

      if (environmentReferences.length > 0 && !Array.isArray(metadata.environmentReferences)) {
        metadata.environmentReferences = environmentReferences;
      }
    }

    if (node.type === 'MESSAGE_QUEUE' && !metadata.deadLetterTargetArn) {
      const outgoing = outgoingBySourceId.get(node.id) || [];
      const dlqEdge = outgoing.find((edge) => {
        const target = nodeById.get(edge.targetId);
        const targetName = String(target?.name || '').toLowerCase();
        return (
          target?.type === 'MESSAGE_QUEUE' &&
          (targetName.includes('dlq') || targetName.includes('dead') || targetName.includes('error'))
        );
      });
      if (dlqEdge) {
        const dlqNode = nodeById.get(dlqEdge.targetId);
        const dlqArn = String(dlqNode?.externalId || '');
        if (dlqArn.startsWith('arn:')) {
          metadata.deadLetterTargetArn = dlqArn;
        }
      }
    }

    const isTopicNode =
      node.type === 'MESSAGE_QUEUE' &&
      String(metadata.sourceType || '').toLowerCase().includes('sns');
    if (isTopicNode && !Array.isArray(metadata.subscriptions)) {
      const outgoing = outgoingBySourceId.get(node.id) || [];
      const subscriptions = outgoing
        .map((edge) => nodeById.get(edge.targetId))
        .filter((target): target is DemoInfraNodeDef => Boolean(target))
        .filter((target) => target.type === 'SERVERLESS' || target.type === 'MESSAGE_QUEUE')
        .map((target) => ({
          protocol: target.type === 'SERVERLESS' ? 'lambda' : 'sqs',
          endpoint: target.externalId,
        }));
      if (subscriptions.length > 0) {
        metadata.subscriptions = subscriptions;
      }
    }

    return {
      ...node,
      metadata,
    };
  });
}

function sortNodes(nodes: DemoInfraNodeDef[]): DemoInfraNodeDef[] {
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function sortEdges(edges: DemoInfraEdgeDef[]): DemoInfraEdgeDef[] {
  return [...edges].sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)));
}

export function getLayersForCompanySize(
  companySize: DemoCompanySizeKey,
): DemoInfrastructureLayerName[] {
  return [...SIZE_LAYERS[companySize]];
}

export function generateDemoInfrastructure(
  params: DemoInfrastructureGenerationParams,
): DemoInfrastructureSeed {
  const layers = getLayersForCompanySize(params.companySize);

  const nodeMap = new Map<string, DemoInfraNodeDef>();
  const confirmedEdgeMap = new Map<string, DemoInfraEdgeDef>();
  const inferredEdgeMap = new Map<string, DemoInfraEdgeDef>();

  for (const layer of layers) {
    const contribution = getLayerContribution(layer);

    for (const node of contribution.nodes) {
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    }

    for (const edge of contribution.confirmedEdges) {
      if (!nodeMap.has(edge.sourceId) || !nodeMap.has(edge.targetId)) continue;
      const key = edgeKey(edge);
      if (!confirmedEdgeMap.has(key)) {
        confirmedEdgeMap.set(key, normalizeEdge(edge));
      }
    }

    for (const edge of contribution.inferredEdges ?? []) {
      if (!nodeMap.has(edge.sourceId) || !nodeMap.has(edge.targetId)) continue;
      const key = edgeKey(edge);
      if (!inferredEdgeMap.has(key)) {
        inferredEdgeMap.set(key, normalizeEdge(edge));
      }
    }
  }

  const baseNodes = sortNodes(Array.from(nodeMap.values()));
  const labeledNodes = applySectorLabels(baseNodes, params.sector);
  const allEdges = [
    ...Array.from(confirmedEdgeMap.values()),
    ...Array.from(inferredEdgeMap.values()),
  ];
  const enrichedNodes = enrichNodesForInference(labeledNodes, allEdges);
  const finalNodes = applyDemoPricingMetadata(
    injectSPOFs(enrichedNodes, params.companySize),
  );
  const metadataIssues = validateDemoMetadata(finalNodes);
  if (metadataIssues.length > 0) {
    const sample = metadataIssues
      .slice(0, 5)
      .map(
        (issue) =>
          `${issue.nodeId}[${issue.templateType}]: ${issue.missingExpressions.join(', ')}`,
      )
      .join(' | ');
    throw new Error(
      `Demo metadata validation failed: ${metadataIssues.length} node(s) have missing critical metadata. ${sample}`,
    );
  }
  const spofNodeIds = SIZE_SPOF_IDS[params.companySize].filter((id) => nodeMap.has(id));

  return {
    layers,
    nodes: finalNodes,
    confirmedEdges: sortEdges(Array.from(confirmedEdgeMap.values())),
    inferredEdges: sortEdges(Array.from(inferredEdgeMap.values())),
    spofNodeIds,
  };
}

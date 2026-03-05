import type { Recommendation } from '@/api/recommendations.api';
import type { InfraNode } from '@/types/graph.types';

type DisplayNode = Partial<InfraNode> & {
  serviceName?: string | null;
  serviceDisplayName?: string | null;
  serviceTechnicalName?: string | null;
  nodeType?: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  APPLICATION: 'Application',
  API_GATEWAY: 'API Gateway',
  CACHE: 'Cache',
  CDN: 'CDN',
  CONTAINER: 'Conteneur',
  DATABASE: 'Base de donnees',
  DNS: 'DNS',
  KUBERNETES_CLUSTER: 'Cluster Kubernetes',
  LOAD_BALANCER: 'Load Balancer',
  MESSAGE_QUEUE: 'File de messages',
  MICROSERVICE: 'Microservice',
  OBJECT_STORAGE: 'Stockage objet',
  SAAS_SERVICE: 'Service SaaS',
  SERVERLESS: 'Serverless',
  VM: 'Machine virtuelle',
};

const INSTANCE_TYPE_KEYS = [
  'instanceType',
  'instance_type',
  'instanceClass',
  'instance_class',
  'nodeType',
  'machineType',
  'vmSize',
  'skuName',
  'sku',
  'tier',
] as const;

const ENGINE_KEYS = ['engine', 'databaseEngine', 'cacheEngine', 'runtime'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  return null;
}

function readStringFromKeys(record: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return null;
}

function readNumberFromKeys(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value != null) return value;
  }
  return null;
}

function readBooleanFromKeys(record: Record<string, unknown> | null, keys: readonly string[]): boolean | null {
  if (!record) return null;
  for (const key of keys) {
    const value = readBoolean(record[key]);
    if (value != null) return value;
  }
  return null;
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[-_./]+/g)
    .filter((part) => part.trim().length > 0)
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      if (part.length <= 3) return part.toUpperCase();
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(' ');
}

function inferTypeFromName(value: string | null | undefined): string | null {
  const name = readString(value);
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/(^|[-_./])(db|database)([-_./]|$)/.test(lower)) return 'DATABASE';
  if (/(^|[-_./])cache([-_./]|$)/.test(lower)) return 'CACHE';
  if (/(^|[-_./])api([-_./]|$)/.test(lower)) return 'API_GATEWAY';
  if (/(^|[-_./])queue([-_./]|$)/.test(lower)) return 'MESSAGE_QUEUE';
  if (/(^|[-_./])(bucket|storage|s3)([-_./]|$)/.test(lower)) return 'OBJECT_STORAGE';
  return null;
}

function extractTagName(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const direct = readStringFromKeys(metadata, [
    'tagName',
    'nameTag',
    'applicationTag',
    'serviceTag',
    'service_name',
    'application_name',
  ]);
  if (direct) return direct;

  const tags = asRecord(metadata.tags);
  if (!tags) return null;
  return (
    readString(tags.Name) ??
    readString(tags.name) ??
    readString(tags.application) ??
    readString(tags.Application) ??
    readString(tags.service) ??
    readString(tags.Service)
  );
}

function resolveTypeLabel(node: DisplayNode): string | null {
  const explicitType = readString(node.type) ?? readString(node.nodeType);
  const inferredType =
    explicitType?.toUpperCase() ??
    inferTypeFromName(node.serviceTechnicalName) ??
    inferTypeFromName(node.name) ??
    inferTypeFromName(node.serviceName);
  if (!inferredType) return null;
  return TYPE_LABELS[inferredType] ?? humanizeIdentifier(inferredType);
}

function resolveRoleLabel(node: DisplayNode): string | null {
  const metadata = asRecord(node.metadata);
  const role = readStringFromKeys(metadata, ['role', 'serviceRole', 'workload', 'component']);
  if (!role) return null;
  return humanizeIdentifier(role);
}

function dedupeSubtitleParts(parts: Array<string | null | undefined>, title: string): string | null {
  const normalizedTitle = normalizeLabel(title);
  const unique = new Set<string>();
  const deduped: string[] = [];

  for (const rawPart of parts) {
    const part = readString(rawPart);
    if (!part) continue;
    const normalizedPart = normalizeLabel(part);
    if (!normalizedPart) continue;
    if (normalizedPart === normalizedTitle) continue;
    if (normalizedTitle.includes(normalizedPart) || normalizedPart.includes(normalizedTitle)) continue;
    if (unique.has(normalizedPart)) continue;
    unique.add(normalizedPart);
    deduped.push(part);
  }

  return deduped.length > 0 ? deduped.join(' • ') : null;
}

function resolveLocationLabel(node: DisplayNode): string | null {
  const metadata = asRecord(node.metadata);
  const region =
    readString(node.region) ??
    readStringFromKeys(metadata, ['region', 'primaryRegion', 'awsRegion', 'location']);
  const availabilityZone =
    readString(node.availabilityZone) ??
    readStringFromKeys(metadata, ['availabilityZone', 'zone', 'az']);
  if (region && availabilityZone) {
    return normalizeLabel(availabilityZone).includes(normalizeLabel(region))
      ? availabilityZone
      : `${region} / ${availabilityZone}`;
  }
  return region ?? availabilityZone;
}

function resolveInstanceTypeLabel(node: DisplayNode): string | null {
  const metadata = asRecord(node.metadata);
  return readStringFromKeys(metadata, INSTANCE_TYPE_KEYS);
}

function resolveEngineLabel(node: DisplayNode): string | null {
  const metadata = asRecord(node.metadata);
  return readStringFromKeys(metadata, ENGINE_KEYS);
}

export function inferNameFromTechnical(node: InfraNode | DisplayNode): string | null {
  const technical =
    readString((node as DisplayNode).serviceTechnicalName) ??
    readString((node as DisplayNode).name) ??
    readString((node as DisplayNode).serviceName);
  if (!technical) return null;

  const lower = technical.toLowerCase();
  const pattern = technical.match(/^(.+?)[-_](db|database|cache|api)$/i);
  if (pattern) {
    const role = humanizeIdentifier(pattern[1]);
    const suffix = pattern[2].toLowerCase();
    if (suffix === 'db' || suffix === 'database') return `Base de donnees ${role}`;
    if (suffix === 'cache') return `Cache ${role}`;
    if (suffix === 'api') return `API ${role}`;
  }

  if (/(^|[-_./])(db|database)([-_./]|$)/.test(lower)) {
    const role = resolveRoleLabel(node as DisplayNode);
    return role ? `Base de donnees ${role}` : 'Base de donnees';
  }
  if (/(^|[-_./])cache([-_./]|$)/.test(lower)) {
    const role = resolveRoleLabel(node as DisplayNode);
    return role ? `Cache ${role}` : 'Cache';
  }
  if (/(^|[-_./])api([-_./]|$)/.test(lower)) {
    const role = resolveRoleLabel(node as DisplayNode);
    return role ? `API ${role}` : 'API';
  }

  const typeLabel = resolveTypeLabel(node as DisplayNode);
  const role = resolveRoleLabel(node as DisplayNode);
  if (typeLabel && role) return `${typeLabel} ${role}`;
  if (typeLabel) return typeLabel;

  if (/\s/.test(technical)) return technical;
  return humanizeIdentifier(technical);
}

export function getDisplayName(node: InfraNode | DisplayNode): string {
  const metadata = asRecord((node as DisplayNode).metadata);
  const businessName = readString((node as DisplayNode).businessName);
  if (businessName) return businessName;

  const tagName = extractTagName(metadata);
  if (tagName) return tagName;

  const inferred = inferNameFromTechnical(node);
  if (inferred) return inferred;

  return (
    readString((node as DisplayNode).serviceDisplayName) ??
    readString((node as DisplayNode).serviceName) ??
    readString((node as DisplayNode).serviceTechnicalName) ??
    readString((node as DisplayNode).name) ??
    'Service'
  );
}

export function buildRecommendationHeading(recommendation: Recommendation): {
  title: string;
  subtitle: string | null;
} {
  const metadata = asRecord(recommendation.metadata);
  const nodeLike: DisplayNode = {
    name: recommendation.serviceTechnicalName ?? recommendation.serviceName ?? recommendation.serviceDisplayName ?? recommendation.id,
    serviceName: recommendation.serviceName,
    serviceDisplayName: recommendation.serviceDisplayName,
    serviceTechnicalName: recommendation.serviceTechnicalName,
    businessName: recommendation.businessName ?? null,
    nodeType: recommendation.nodeType ?? null,
    region: recommendation.region ?? undefined,
    availabilityZone: recommendation.availabilityZone ?? undefined,
    metadata: metadata ?? undefined,
  };

  const title = getDisplayName(nodeLike);
  const businessName = readString(recommendation.businessName);
  const tagName = extractTagName(metadata);
  const sameBusinessAndTag =
    businessName != null &&
    tagName != null &&
    normalizeLabel(businessName) === normalizeLabel(tagName);

  const typeLabel = sameBusinessAndTag ? null : resolveTypeLabel(nodeLike);
  const engineLabel = sameBusinessAndTag ? null : resolveEngineLabel(nodeLike);
  const instanceTypeLabel = resolveInstanceTypeLabel(nodeLike);
  const locationLabel = resolveLocationLabel(nodeLike);
  const technicalName = readString(recommendation.serviceTechnicalName);
  const fallbackTechnical =
    technicalName && normalizeLabel(technicalName) !== normalizeLabel(title)
      ? technicalName
      : null;
  const subtitle =
    dedupeSubtitleParts(
      sameBusinessAndTag
        ? [instanceTypeLabel, locationLabel, fallbackTechnical]
        : [typeLabel, engineLabel, instanceTypeLabel, locationLabel, fallbackTechnical],
      title,
    ) ?? null;

  return { title, subtitle };
}

export function buildRecommendationNarrative(recommendation: Recommendation): string {
  const strategy = String(recommendation.strategy || '').toLowerCase().replace(/-/g, '_');
  const actionByStrategy: Record<string, string> = {
    backup_restore: 'Mettre en place une sauvegarde restaurable et testee regulierement.',
    pilot_light: 'Preparer un environnement de secours minimal, activable rapidement.',
    warm_standby: 'Maintenir un environnement de secours pret a prendre le relais.',
    hot_standby: 'Maintenir un secours synchronise pour une bascule quasi immediate.',
    active_active: 'Repartir la charge sur plusieurs environnements actifs.',
  };
  const stateByStrategy: Record<string, string> = {
    backup_restore: 'La reprise repose surtout sur des mecanismes de sauvegarde.',
    pilot_light: 'Le service n a pas de secours operationnel immediat.',
    warm_standby: 'Le service ne dispose pas d un mode de releve chaud en continu.',
    hot_standby: 'La redondance active n est pas encore suffisante.',
    active_active: 'Le service reste concentre sur un seul environnement actif.',
  };

  const currentState = recommendation.requiresVerification
    ? 'Etat actuel a verifier: certaines metadonnees techniques sont incomplètes.'
    : stateByStrategy[strategy] ?? 'Le niveau actuel de resilience reste en dessous de l objectif de reprise.';

  const action = actionByStrategy[strategy] ?? readString(recommendation.description) ?? 'Renforcer la continuité de ce service.';
  return `Etat actuel: ${currentState} Action: ${action}`;
}

export function buildCriticalMetadataSummary(recommendation: Recommendation): string[] {
  const metadata = asRecord(recommendation.metadata);
  if (!metadata) {
    return ['Metadonnees critiques non disponibles (Multi-AZ, zones, replicas, versioning).'];
  }

  const lines: string[] = [];
  const multiAz = readBooleanFromKeys(metadata, ['multiAZ', 'multiAz', 'multi_az', 'isMultiAZ', 'zoneRedundant']);
  if (multiAz != null) lines.push(`Multi-AZ: ${multiAz ? 'true' : 'false'}`);

  const zones =
    readNumberFromKeys(metadata, ['zoneCount', 'availabilityZoneCount']) ??
    (Array.isArray(metadata.availabilityZones) ? metadata.availabilityZones.length : null);
  if (zones != null) lines.push(`Nombre de zones: ${zones}`);

  const replicas = readNumberFromKeys(metadata, ['replicaCount', 'replicas', 'readReplicaCount', 'readReplicas']);
  if (replicas != null) lines.push(`Replicas: ${replicas}`);

  const crossRegion = readBooleanFromKeys(metadata, ['crossRegion', 'crossRegionReplication', 'geoReplicationEnabled']);
  if (crossRegion != null) lines.push(`Cross-Region: ${crossRegion ? 'true' : 'false'}`);

  const s3Versioning = readBooleanFromKeys(metadata, ['versioningEnabled', 'versioning', 's3Versioning']);
  if (s3Versioning != null) lines.push(`Versioning S3: ${s3Versioning ? 'true' : 'false'}`);

  if (lines.length === 0) {
    lines.push('Metadonnees critiques insuffisantes pour justifier automatiquement tous les leviers.');
  }
  return lines;
}

import type { BlastRadiusResult } from './blastRadiusEngine.js';
import type { InfraNodeAttrs } from './types.js';

type Signal = {
  tier: number;
  weight: number;
  signal: string;
};

export type CriticalityClassification = {
  tier: number;
  confidence: number;
  signals: string[];
  impactCategory: 'critical' | 'high' | 'medium' | 'low';
};

const TYPE_CRITICALITY_HINT: Record<string, number> = {
  rds: 1,
  aurora: 1,
  sqldatabase: 1,
  cloudsql: 1,
  postgresqlflexible: 1,
  mysqlflexible: 1,
  postgresql: 1,
  mysql: 1,
  alb: 1,
  nlb: 1,
  applicationgateway: 1,
  httploadbalancer: 1,
  ec2: 2,
  vm: 2,
  compute: 2,
  ecs: 2,
  appservice: 2,
  application: 2,
  microservice: 2,
  eks: 1,
  aks: 1,
  gke: 1,
  elasticache: 2,
  redis: 2,
  memorystore: 2,
  dynamodb: 2,
  cosmosdb: 2,
  firestore: 2,
  sqs: 3,
  sns: 3,
  servicebus: 3,
  pubsub: 3,
  lambda: 3,
  function: 3,
  cloudfunction: 3,
  s3: 3,
  storageaccount: 3,
  cloudstorage: 3,
};

function normalize(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function clampTier(rawTier: number): number {
  const rounded = Math.round(rawTier);
  if (rounded < 1) return 1;
  if (rounded > 4) return 4;
  return rounded;
}

function tierToImpactCategory(tier: number): CriticalityClassification['impactCategory'] {
  if (tier <= 1) return 'critical';
  if (tier === 2) return 'high';
  if (tier === 3) return 'medium';
  return 'low';
}

function readMetadataRecord(node: InfraNodeAttrs): Record<string, unknown> {
  if (!node.metadata || typeof node.metadata !== 'object' || Array.isArray(node.metadata)) return {};
  return node.metadata as Record<string, unknown>;
}

function normalizeTags(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value == null) continue;
    tags[key] = String(value);
  }
  return tags;
}

function getCriticalityFromTags(tags: Record<string, string>): number | null {
  const critTag = tags.Criticality || tags.criticality || tags.Priority || tags.priority;
  if (critTag) {
    const lower = critTag.toLowerCase();
    if (['critical', 'tier1', 'p0', 'p1'].some((key) => lower.includes(key))) return 1;
    if (['high', 'tier2', 'p2'].some((key) => lower.includes(key))) return 2;
    if (['medium', 'tier3', 'p3'].some((key) => lower.includes(key))) return 3;
    if (['low', 'tier4', 'p4'].some((key) => lower.includes(key))) return 4;
  }

  const envTag = tags.Environment || tags.environment || tags.Env || tags.env;
  if (envTag) {
    const lower = envTag.toLowerCase();
    if (lower === 'production' || lower === 'prod') return 1;
    if (lower === 'staging' || lower === 'preprod') return 3;
    if (lower === 'dev' || lower === 'development' || lower === 'test') return 4;
  }

  return null;
}

function getCriticalityFromName(name: string): number | null {
  const lower = name.toLowerCase();
  if (['prod', 'production', 'primary', 'main', 'master', 'core'].some((key) => lower.includes(key))) return 1;
  if (['api', 'web', 'gateway', 'frontend', 'backend', 'app-server'].some((key) => lower.includes(key))) return 1;
  if (['staging', 'dev', 'test', 'backup', 'archive', 'log', 'monitoring'].some((key) => lower.includes(key))) {
    return 4;
  }
  if (['worker', 'batch', 'cron', 'scheduler', 'job'].some((key) => lower.includes(key))) return 3;
  if (['dlq', 'dead-letter', 'error', 'retry'].some((key) => lower.includes(key))) return 4;
  return null;
}

function getTypeHint(node: InfraNodeAttrs): number | null {
  const metadata = readMetadataRecord(node);
  const candidates = [
    normalize(node.type),
    normalize(metadata.sourceType),
    normalize(metadata.awsService),
    normalize(metadata.subType),
  ].filter(Boolean);

  for (const candidate of candidates) {
    for (const [key, tier] of Object.entries(TYPE_CRITICALITY_HINT)) {
      if (candidate.includes(key)) return tier;
    }
  }
  return null;
}

function getManualTier(node: InfraNodeAttrs): number | null {
  const metadata = readMetadataRecord(node);
  const manualRaw =
    metadata.manualRecoveryTier ??
    metadata.manualTier ??
    metadata.userRecoveryTier ??
    metadata.userCriticalityTier;
  const parsed = Number(manualRaw);
  if (!Number.isFinite(parsed)) return null;
  const tier = Math.round(parsed);
  return tier >= 1 && tier <= 4 ? tier : null;
}

export function classifyServiceCriticality(
  node: InfraNodeAttrs,
  blastRadius: BlastRadiusResult | null,
): CriticalityClassification {
  const signals: Signal[] = [];
  const metadata = readMetadataRecord(node);

  const manualTier = getManualTier(node);
  if (manualTier != null) {
    return {
      tier: manualTier,
      confidence: 0.98,
      signals: [`Override manuel: Tier ${manualTier}`],
      impactCategory: tierToImpactCategory(manualTier),
    };
  }

  if (blastRadius && blastRadius.totalServices > 1) {
    let tierFromBlast = 4;
    if (blastRadius.impactRatio > 0.5) tierFromBlast = 1;
    else if (blastRadius.impactRatio > 0.25) tierFromBlast = 2;
    else if (blastRadius.impactRatio > 0.1) tierFromBlast = 3;

    signals.push({
      tier: tierFromBlast,
      weight: 0.4,
      signal: `Blast radius: ${Math.round(blastRadius.impactRatio * 100)}%`,
    });
  }

  const typeHint = getTypeHint(node);
  if (typeHint != null) {
    signals.push({ tier: typeHint, weight: 0.25, signal: `Type: ${node.type}` });
  }

  const nameHint = getCriticalityFromName(node.name || '');
  if (nameHint != null) {
    signals.push({ tier: nameHint, weight: 0.15, signal: `Nom: ${node.name}` });
  }

  const tagHint = getCriticalityFromTags({
    ...normalizeTags(metadata.tags),
    ...normalizeTags(node.tags),
  });
  if (tagHint != null) {
    const tagPairs = Object.entries({
      ...normalizeTags(metadata.tags),
      ...normalizeTags(node.tags),
    })
      .slice(0, 4)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    signals.push({ tier: tagHint, weight: 0.2, signal: `Tags: ${tagPairs || 'present'}` });
  }

  if (signals.length === 0) {
    return {
      tier: 3,
      confidence: 0.3,
      signals: ['Aucun signal - defaut Tier 3'],
      impactCategory: 'medium',
    };
  }

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0) || 1;
  const weightedTier = signals.reduce((sum, signal) => sum + signal.tier * signal.weight, 0) / totalWeight;
  const tier = clampTier(weightedTier);
  const confidence = Math.min(0.95, 0.3 + signals.length * 0.15);

  return {
    tier,
    confidence,
    signals: signals.map((signal) => signal.signal),
    impactCategory: tierToImpactCategory(tier),
  };
}

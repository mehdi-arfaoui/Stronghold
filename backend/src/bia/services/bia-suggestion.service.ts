import type { GraphInstance } from '../../graph/graphService.js';
import type { InfraNodeAttrs } from '../../graph/types.js';
import {
  BIA_REFERENCE_DATA,
  type BiaCriticalityLevel,
  type BiaReferenceEntry,
} from '../data/bia-reference-data.js';

export interface BIASuggestion {
  rto: number;
  rpo: number;
  mtpd: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string[];
  adjustments: {
    backupFrequency?: string;
    replication?: string;
    dependencies?: string;
    spof?: string;
  };
}

interface SuggestionContext {
  graph: GraphInstance;
  explicitCriticalityScore?: number;
  tier?: number;
}

export interface TierConsistencyServiceInput {
  tier: number;
  rtoMinutes: number;
  rpoMinutes: number;
}

const MAX_RTO_RPO_BY_TIER: Record<number, { rtoMinutes: number; rpoMinutes: number }> = {
  1: { rtoMinutes: 15, rpoMinutes: 5 },
  2: { rtoMinutes: 60, rpoMinutes: 15 },
  3: { rtoMinutes: 240, rpoMinutes: 60 },
  4: { rtoMinutes: 1440, rpoMinutes: 1440 },
};

const TIER_TARGET_BOUNDS: Record<
  number,
  {
    rtoMinutes: { min: number; max: number };
    rpoMinutes: { min: number; max: number };
    mtpdMinutes: { min: number; max: number };
  }
> = {
  1: {
    rtoMinutes: { min: 5, max: 15 },
    rpoMinutes: { min: 1, max: 5 },
    mtpdMinutes: { min: 120, max: 240 },
  },
  2: {
    rtoMinutes: { min: 30, max: 60 },
    rpoMinutes: { min: 10, max: 15 },
    mtpdMinutes: { min: 360, max: 720 },
  },
  3: {
    rtoMinutes: { min: 120, max: 240 },
    rpoMinutes: { min: 45, max: 60 },
    mtpdMinutes: { min: 1440, max: 2880 },
  },
  4: {
    rtoMinutes: { min: 720, max: 1440 },
    rpoMinutes: { min: 240, max: 1440 },
    mtpdMinutes: { min: 2880, max: 4320 },
  },
};

export function validateRTORPOConsistency(
  services: TierConsistencyServiceInput[],
): TierConsistencyServiceInput[] {
  const fallback = MAX_RTO_RPO_BY_TIER[4]!;
  return services.map((service) => {
    const maxByTier = MAX_RTO_RPO_BY_TIER[service.tier] ?? fallback;
    return {
      ...service,
      rtoMinutes: Math.min(service.rtoMinutes, maxByTier.rtoMinutes),
      rpoMinutes: Math.min(service.rpoMinutes, maxByTier.rpoMinutes),
    };
  });
}

const clampMinimum = (value: number, min = 1) => Math.max(min, Math.round(value));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

const toText = (value: unknown) => String(value ?? '').toLowerCase();

const backupToMinutes = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  const str = toText(value).replace(/\s+/g, ' ').trim();
  if (!str) return undefined;
  if (str.includes('real-time') || str.includes('realtime') || str.includes('continuous')) return 1;

  const match = str.match(/(\d+)\s*(min|minute|minutes|h|hr|hour|hours|d|day|days)/i);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = String(match[2] ?? '').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  if (unit.startsWith('min')) return amount;
  if (unit.startsWith('h')) return amount * 60;
  if (unit.startsWith('d')) return amount * 1440;
  return undefined;
};

const getCriticalityLevel = (score: number): BiaCriticalityLevel => {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
};

function deterministicOffset(seed: string, spread: number): number {
  if (spread <= 0) return 0;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1_000_003;
  }
  const centered = (hash % (spread * 2 + 1)) - spread;
  return centered;
}

function resolveServiceBias(node: InfraNodeAttrs): { rto: number; rpo: number; mtpd: number } {
  const type = String(node.type || '').toUpperCase();
  const name = String(node.name || '').toLowerCase();

  if (type === 'DATABASE') {
    return { rto: 0.75, rpo: 0.45, mtpd: 0.65 };
  }
  if (type === 'API_GATEWAY' || type === 'LOAD_BALANCER' || type === 'DNS' || type === 'CDN') {
    return { rto: 0.6, rpo: 1, mtpd: 0.75 };
  }
  if (type === 'SERVERLESS' || type === 'MESSAGE_QUEUE') {
    return { rto: 0.9, rpo: 0.85, mtpd: 0.85 };
  }
  if (name.includes('monitor') || name.includes('observability') || name.includes('logging')) {
    return { rto: 1.2, rpo: 1.25, mtpd: 1.15 };
  }
  if (type === 'SAAS_SERVICE' || type === 'THIRD_PARTY_API') {
    return { rto: 1.15, rpo: 1.2, mtpd: 1.1 };
  }
  return { rto: 0.9, rpo: 0.9, mtpd: 0.9 };
}

function alignMetricsToTier(
  node: InfraNodeAttrs,
  tier: number,
  metrics: { rto: number; rpo: number; mtpd: number },
): { rto: number; rpo: number; mtpd: number } {
  const bounds = TIER_TARGET_BOUNDS[tier] ?? TIER_TARGET_BOUNDS[4]!;
  const bias = resolveServiceBias(node);
  const seed = `${node.id}:${node.name}:${node.type}`;
  const nextRto = clamp(
    metrics.rto * bias.rto + deterministicOffset(`${seed}:rto`, 6),
    bounds.rtoMinutes.min,
    bounds.rtoMinutes.max,
  );
  const nextRpo = clamp(
    metrics.rpo * bias.rpo + deterministicOffset(`${seed}:rpo`, tier === 4 ? 180 : 4),
    bounds.rpoMinutes.min,
    bounds.rpoMinutes.max,
  );
  const nextMtpd = clamp(
    metrics.mtpd * bias.mtpd + deterministicOffset(`${seed}:mtpd`, tier === 4 ? 360 : tier === 3 ? 240 : 30),
    bounds.mtpdMinutes.min,
    bounds.mtpdMinutes.max,
  );

  if (tier === 1 && String(node.type || '').toUpperCase() !== 'DATABASE') {
    return {
      rto: nextRto,
      rpo: clamp(nextRpo, 3, bounds.rpoMinutes.max),
      mtpd: nextMtpd,
    };
  }

  return {
    rto: nextRto,
    rpo: nextRpo,
    mtpd: nextMtpd,
  };
}

const matchReference = (
  node: InfraNodeAttrs,
): { reference: BiaReferenceEntry; keywordHit?: string; score: number } => {
  const haystacks = [node.name, node.type, ...Object.keys(node.tags ?? {}), ...Object.values(node.tags ?? {})]
    .map(toText)
    .join(' ');

  const scored = BIA_REFERENCE_DATA.map((entry, index) => {
    const typeMatch = entry.nodeTypes.length > 0 && entry.nodeTypes.includes(node.type);
    const keywordHit = entry.keywords.find((keyword) => haystacks.includes(keyword.toLowerCase()));

    let score = 0;
    if (typeMatch) score += 3;
    if (keywordHit) score += 2;
    if (entry.nodeTypes.length === 0) score += 0.1;

    return { entry, keywordHit, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const best = scored[0];
  const fallbackReference = BIA_REFERENCE_DATA[BIA_REFERENCE_DATA.length - 1] as BiaReferenceEntry;
  const result: { reference: BiaReferenceEntry; keywordHit?: string; score: number } = {
    reference: best?.entry ?? fallbackReference,
    score: best?.score ?? 0,
  };

  if (best?.keywordHit) {
    result.keywordHit = best.keywordHit;
  }

  return result;
};

export class BIASuggestionService {
  suggestForNode(node: InfraNodeAttrs, context: SuggestionContext): BIASuggestion {
    const reasoning: string[] = [];
    const adjustments: BIASuggestion['adjustments'] = {};
    let signalCount = 0;

    const { reference, keywordHit, score } = matchReference(node);
    if (score > 0) signalCount += 1;
    if (keywordHit) signalCount += 1;

    reasoning.push(`Categorie metier: ${reference.category}.`);
    if (reference.keywords.length > 0) {
      reasoning.push(`Mots-cles de reference: ${reference.keywords.join(', ')}.`);
    }
    if (keywordHit) {
      reasoning.push(`Mot-cle detecte: "${keywordHit}".`);
    } else if (reference.keywords.length > 0) {
      reasoning.push('Aucun mot-cle direct detecte, correspondance par type de composant.');
    }
    reasoning.push(`Contexte metier: ${reference.description}`);

    const rawCriticalityScore = Number(node.criticalityScore ?? context.explicitCriticalityScore ?? 30);
    const criticalityScore = Number.isFinite(rawCriticalityScore) ? rawCriticalityScore : 30;
    const criticalityLevel = getCriticalityLevel(criticalityScore);
    reasoning.push(`Criticite detectee: ${criticalityLevel} (score ${criticalityScore}).`);
    signalCount += 1;

    let rto = reference.rto[criticalityLevel];
    let rpo = reference.rpo[criticalityLevel];
    let mtpd = reference.mtpd[criticalityLevel];

    const metadata = node.metadata ?? {};
    const tags = node.tags ?? {};

    const backupValue =
      backupToMinutes(metadata.backupFrequencyMinutes) ??
      backupToMinutes(metadata.backupFrequency) ??
      backupToMinutes((tags as Record<string, unknown>).backup) ??
      backupToMinutes((tags as Record<string, unknown>).backup_frequency);

    if (backupValue !== undefined) {
      rpo = Math.min(rpo, backupValue);
      adjustments.backupFrequency = `Backup detecte (~${backupValue} min) -> RPO aligne a ${rpo} min.`;
      reasoning.push(adjustments.backupFrequency);
      signalCount += 1;
    }

    const azText = [
      toText(metadata.multiAz),
      toText(metadata.isMultiAZ),
      toText(tags.multi_az),
      toText(tags.multiaz),
    ].join(' ');
    const isMultiAZ = azText.includes('true') || azText.includes('yes') || azText.includes('enabled');
    const replicaCount = Number(metadata.replicaCount ?? metadata.replicas ?? tags.replicas ?? 0);

    if (isMultiAZ) {
      rto = clampMinimum(rto * 0.5);
      adjustments.replication = `Multi-AZ active -> RTO reduit de 50% (${rto} min).`;
      reasoning.push(adjustments.replication);
      signalCount += 1;
    } else if (Number.isFinite(replicaCount) && replicaCount > 0) {
      rto = clampMinimum(rto * 0.7);
      adjustments.replication = `Replica detecte (${replicaCount}) -> RTO reduit de 30% (${rto} min).`;
      reasoning.push(adjustments.replication);
      signalCount += 1;
    }

    const dependents = Math.max(Number(node.dependentsCount ?? 0), context.graph.inDegree(node.id) || 0);

    if (dependents > 5) {
      rto = clampMinimum(rto * 0.7);
      mtpd = clampMinimum(mtpd * 0.7);
      adjustments.dependencies = `Dependants eleves (${dependents}) -> RTO et MTPD reduits de 30%.`;
      reasoning.push(adjustments.dependencies);
      signalCount += 1;
    }

    const isSPOF = Boolean(node.isSPOF) || String(metadata.spof ?? '').toLowerCase() === 'true';
    if (isSPOF) {
      mtpd = clampMinimum(mtpd * 0.5);
      adjustments.spof = 'SPOF detecte -> MTPD reduit de 50% pour renforcer l urgence de traitement.';
      reasoning.push(adjustments.spof);
      signalCount += 1;
    }

    const confidence: BIASuggestion['confidence'] =
      signalCount >= 3 ? 'high' : signalCount === 2 ? 'medium' : 'low';

    if (typeof context.tier === 'number' && Number.isFinite(context.tier)) {
      const [bounded] = validateRTORPOConsistency([
        {
          tier: context.tier,
          rtoMinutes: rto,
          rpoMinutes: rpo,
        },
      ]);

      if (bounded) {
        if (bounded.rtoMinutes < rto || bounded.rpoMinutes < rpo) {
          const maxByTier = MAX_RTO_RPO_BY_TIER[context.tier] ?? MAX_RTO_RPO_BY_TIER[4]!;
          reasoning.push(
            `Cohérence tier appliquee (Tier ${context.tier}): RTO <= ${maxByTier.rtoMinutes} min, RPO <= ${maxByTier.rpoMinutes} min.`,
          );
        }
        rto = bounded.rtoMinutes;
        rpo = bounded.rpoMinutes;
      }

      const tierAligned = alignMetricsToTier(node, context.tier, {
        rto,
        rpo,
        mtpd,
      });
      if (tierAligned.rto !== rto || tierAligned.rpo !== rpo || tierAligned.mtpd !== mtpd) {
        const bounds = TIER_TARGET_BOUNDS[context.tier] ?? TIER_TARGET_BOUNDS[4]!;
        reasoning.push(
          `Profil Tier ${context.tier} applique: RTO ${bounds.rtoMinutes.min}-${bounds.rtoMinutes.max} min, ` +
            `RPO ${bounds.rpoMinutes.min}-${bounds.rpoMinutes.max} min, ` +
            `MTPD ${Math.round(bounds.mtpdMinutes.min / 60)}-${Math.round(bounds.mtpdMinutes.max / 60)} h.`,
        );
      }
      rto = tierAligned.rto;
      rpo = tierAligned.rpo;
      mtpd = tierAligned.mtpd;
    }

    return {
      rto,
      rpo,
      mtpd,
      confidence,
      reasoning,
      adjustments,
    };
  }
}

export const biaSuggestionService = new BIASuggestionService();

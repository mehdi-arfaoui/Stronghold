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
  1: { rtoMinutes: 15, rpoMinutes: 1 },
  2: { rtoMinutes: 60, rpoMinutes: 15 },
  3: { rtoMinutes: 240, rpoMinutes: 60 },
  4: { rtoMinutes: 1440, rpoMinutes: 720 },
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

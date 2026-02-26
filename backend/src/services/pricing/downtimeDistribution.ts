import type { BlastRadiusResult } from '../../graph/blastRadiusEngine.js';

export type DowntimeCostSource =
  | 'blast_radius'
  | 'override'
  | 'not_configured'
  | 'fallback_criticality';

export interface ServiceDowntimeCost {
  serviceNodeId: string;
  serviceName: string;
  downtimeCostPerHour: number;
  impactFactor: number;
  source: DowntimeCostSource;
  sourceLabel: string;
  rationale: string;
  blastRadius?: {
    directDependents: number;
    transitiveDependents: number;
    totalServices: number;
    impactedServices: string[];
  };
}

type CriticalityLevel = 'critical' | 'high' | 'medium' | 'low';

const DISTRIBUTION_CONFIG = {
  MIN_IMPACT_FACTOR: 0.05,
  MAX_IMPACT_FACTOR: 0.9,
  CRITICALITY_BONUS: {
    critical: 0.15,
    high: 0.08,
    medium: 0.03,
    low: 0,
  } as Record<CriticalityLevel, number>,
  CRITICALITY_FALLBACK: {
    critical: 0.7,
    high: 0.4,
    medium: 0.2,
    low: 0.05,
  } as Record<CriticalityLevel, number>,
};

export function normalizeCriticalityLevel(value: unknown): CriticalityLevel {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'low') return 'low';
  return 'medium';
}

type ServiceForDistribution = {
  nodeId: string;
  name: string;
  criticality: CriticalityLevel | string;
};

type FinancialProfileForDistribution = {
  estimatedDowntimeCostPerHour?: number | null;
  serviceOverrides?: Array<{
    nodeId: string;
    customDowntimeCostPerHour?: number | null;
  }> | null;
} | null;

export function calculateServiceDowntimeCosts(
  blastRadiusResults: BlastRadiusResult[],
  services: ServiceForDistribution[],
  financialProfile: FinancialProfileForDistribution,
): ServiceDowntimeCost[] {
  const globalCost = Number(financialProfile?.estimatedDowntimeCostPerHour || 0);
  const hasGlobalCost = Number.isFinite(globalCost) && globalCost > 0;
  const blastByNodeId = new Map(blastRadiusResults.map((item) => [item.nodeId, item]));
  const hasGraphSignal = blastRadiusResults.some(
    (item) => item.directDependents > 0 || item.transitiveDependents > 0,
  );

  return services.map((service) => {
    const override = financialProfile?.serviceOverrides?.find(
      (entry) =>
        entry.nodeId === service.nodeId &&
        Number.isFinite(Number(entry.customDowntimeCostPerHour)) &&
        Number(entry.customDowntimeCostPerHour) > 0,
    );

    if (override?.customDowntimeCostPerHour != null && Number(override.customDowntimeCostPerHour) > 0) {
      return {
        serviceNodeId: service.nodeId,
        serviceName: service.name,
        downtimeCostPerHour: Math.round(Number(override.customDowntimeCostPerHour)),
        impactFactor: 1,
        source: 'override',
        sourceLabel: 'Personnalise',
        rationale: 'Valeur definie manuellement',
      };
    }

    if (!hasGlobalCost) {
      return {
        serviceNodeId: service.nodeId,
        serviceName: service.name,
        downtimeCostPerHour: 0,
        impactFactor: 0,
        source: 'not_configured',
        sourceLabel: '—',
        rationale: 'Profil financier non configure',
      };
    }

    const criticality = normalizeCriticalityLevel(service.criticality);
    const blast = blastByNodeId.get(service.nodeId);

    if (blast && blast.totalServices > 1 && hasGraphSignal) {
      const rawFactor = blast.impactRatio + DISTRIBUTION_CONFIG.CRITICALITY_BONUS[criticality];
      const clampedFactor = Math.max(
        DISTRIBUTION_CONFIG.MIN_IMPACT_FACTOR,
        Math.min(DISTRIBUTION_CONFIG.MAX_IMPACT_FACTOR, rawFactor),
      );
      const impactedBase = Math.max(1, blast.totalServices - 1);

      return {
        serviceNodeId: service.nodeId,
        serviceName: service.name,
        downtimeCostPerHour: Math.round(globalCost * clampedFactor),
        impactFactor: clampedFactor,
        source: 'blast_radius',
        sourceLabel: `${Math.round(clampedFactor * 100)}% - ${blast.transitiveDependents}/${impactedBase} impactes`,
        rationale: blast.rationale,
        blastRadius: {
          directDependents: blast.directDependents,
          transitiveDependents: blast.transitiveDependents,
          totalServices: blast.totalServices,
          impactedServices: blast.impactedServices,
        },
      };
    }

    const fallbackFactor = DISTRIBUTION_CONFIG.CRITICALITY_FALLBACK[criticality];
    return {
      serviceNodeId: service.nodeId,
      serviceName: service.name,
      downtimeCostPerHour: Math.round(globalCost * fallbackFactor),
      impactFactor: fallbackFactor,
      source: 'fallback_criticality',
      sourceLabel: `${Math.round(fallbackFactor * 100)}% (criticite seule - graphe incomplet)`,
      rationale: `Pas assez de dependances detectees pour ${service.name}. Distribution basee sur la criticite "${criticality}".`,
    };
  });
}


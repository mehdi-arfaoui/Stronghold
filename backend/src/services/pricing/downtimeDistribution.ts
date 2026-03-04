import type { BlastRadiusResult } from '../../graph/blastRadiusEngine.js';
import { estimateServiceMonthlyProductionCost } from '../company-financial-profile.service.js';

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
  WEIGHT_SPLIT: {
    criticality: 0.4,
    serviceType: 0.3,
    blastRadius: 0.2,
    infrastructureCost: 0.1,
  },
  CRITICALITY_WEIGHTS: {
    critical: 1.6,
    high: 1.15,
    medium: 0.7,
    low: 0.25,
  } as Record<CriticalityLevel, number>,
  SERVICE_TYPE_WEIGHTS: {
    DATABASE: 1.4,
    CACHE: 1.1,
    API_GATEWAY: 1.0,
    LOAD_BALANCER: 0.95,
    VM: 0.9,
    APPLICATION: 0.9,
    MICROSERVICE: 0.85,
    PHYSICAL_SERVER: 0.9,
    CONTAINER: 0.8,
    KUBERNETES_CLUSTER: 0.8,
    KUBERNETES_SERVICE: 0.8,
    KUBERNETES_POD: 0.78,
    SERVERLESS: 0.45,
    MESSAGE_QUEUE: 0.35,
    OBJECT_STORAGE: 0.12,
    FILE_STORAGE: 0.18,
    THIRD_PARTY_API: 0.7,
    SAAS_SERVICE: 0.75,
    CDN: 0.35,
    DNS: 0.35,
    FIREWALL: 0.25,
    NETWORK_DEVICE: 0.2,
    VPC: 0.15,
    SUBNET: 0.12,
  } as Record<string, number>,
  DEFAULT_SERVICE_TYPE_WEIGHT: 0.6,
  BLAST_BASELINE_WEIGHT: 0.15,
  BLAST_RANGE_WEIGHT: 0.85,
  INFRA_BASELINE_WEIGHT: 0.1,
  INFRA_RANGE_WEIGHT: 0.9,
  RAW_WEIGHT_FLOOR: 0.05,
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
  nodeType?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown> | null;
  estimatedMonthlyCost?: number | null;
};

type FinancialProfileForDistribution = {
  estimatedDowntimeCostPerHour?: number | null;
  serviceOverrides?: Array<{
    nodeId: string;
    customDowntimeCostPerHour?: number | null;
  }> | null;
} | null;

type DistributedServiceContext = {
  service: ServiceForDistribution;
  criticality: CriticalityLevel;
  typeWeight: number;
  blastWeight: number;
  blast: BlastRadiusResult | undefined;
  usesBlastSignal: boolean;
  monthlyInfrastructureCost: number;
  rawWeight: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function formatMonthlyCost(amount: number): string {
  return `${roundMoney(Math.max(0, amount))} EUR/mois`;
}

function resolveTypeWeight(nodeType: string | null | undefined): number {
  const normalized = String(nodeType || '').trim().toUpperCase();
  if (!normalized) return DISTRIBUTION_CONFIG.DEFAULT_SERVICE_TYPE_WEIGHT;
  return (
    DISTRIBUTION_CONFIG.SERVICE_TYPE_WEIGHTS[normalized] ??
    DISTRIBUTION_CONFIG.DEFAULT_SERVICE_TYPE_WEIGHT
  );
}

function resolveMonthlyInfrastructureCost(service: ServiceForDistribution): number {
  const storedMonthlyCost = Number(service.estimatedMonthlyCost);
  if (Number.isFinite(storedMonthlyCost) && storedMonthlyCost > 0) {
    return storedMonthlyCost;
  }

  const estimate = estimateServiceMonthlyProductionCost({
    type: String(service.nodeType || 'APPLICATION'),
    provider: service.provider ?? 'unknown',
    metadata: service.metadata ?? {},
    criticalityScore: null,
    impactCategory: null,
  });
  return Math.max(0, Number(estimate.estimatedMonthlyCost) || 0);
}

function allocateBudgetByWeight(
  services: Array<{
    nodeId: string;
    rawWeight: number;
    serviceName: string;
  }>,
  totalBudget: number,
): Map<string, number> {
  const roundedBudget = Math.max(0, Math.round(totalBudget));
  if (services.length === 0 || roundedBudget <= 0) {
    return new Map(services.map((service) => [service.nodeId, 0]));
  }

  const totalWeight = services.reduce((sum, service) => sum + service.rawWeight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    const uniformShare = Math.floor(roundedBudget / services.length);
    const remainder = roundedBudget - uniformShare * services.length;
    return new Map(
      services
        .slice()
        .sort((left, right) => left.serviceName.localeCompare(right.serviceName))
        .map((service, index) => [service.nodeId, uniformShare + (index < remainder ? 1 : 0)]),
    );
  }

  const allocations = services.map((service) => {
    const exactShare = (roundedBudget * service.rawWeight) / totalWeight;
    const allocated = Math.floor(exactShare);
    return {
      ...service,
      allocated,
      remainder: exactShare - allocated,
    };
  });

  const distributionOrder = allocations
    .slice()
    .sort((left, right) => {
      if (right.remainder !== left.remainder) return right.remainder - left.remainder;
      if (right.rawWeight !== left.rawWeight) return right.rawWeight - left.rawWeight;
      return left.serviceName.localeCompare(right.serviceName);
    });

  let remaining = roundedBudget - allocations.reduce((sum, service) => sum + service.allocated, 0);
  for (const service of distributionOrder) {
    if (remaining <= 0) break;
    const match = allocations.find((entry) => entry.nodeId === service.nodeId);
    if (!match) continue;
    match.allocated += 1;
    remaining -= 1;
  }

  return new Map(allocations.map((service) => [service.nodeId, service.allocated]));
}

export function calculateServiceDowntimeCosts(
  blastRadiusResults: BlastRadiusResult[],
  services: ServiceForDistribution[],
  financialProfile: FinancialProfileForDistribution,
): ServiceDowntimeCost[] {
  const globalCost = Number(financialProfile?.estimatedDowntimeCostPerHour || 0);
  const hasGlobalCost = Number.isFinite(globalCost) && globalCost > 0;
  const roundedGlobalCost = Math.max(0, Math.round(globalCost));
  const blastByNodeId = new Map(blastRadiusResults.map((item) => [item.nodeId, item]));
  const hasGraphSignal = blastRadiusResults.some(
    (item) => item.directDependents > 0 || item.transitiveDependents > 0,
  );

  const overrideByNodeId = new Map(
    (financialProfile?.serviceOverrides || [])
      .filter(
        (entry) =>
          Number.isFinite(Number(entry.customDowntimeCostPerHour)) &&
          Number(entry.customDowntimeCostPerHour) > 0,
      )
      .map((entry) => [entry.nodeId, Math.round(Number(entry.customDowntimeCostPerHour))]),
  );

  const distributedServices: DistributedServiceContext[] = hasGlobalCost
    ? services
        .filter((service) => !overrideByNodeId.has(service.nodeId))
        .map((service) => {
          const criticality = normalizeCriticalityLevel(service.criticality);
          const blast = blastByNodeId.get(service.nodeId);
          const usesBlastSignal = Boolean(blast && blast.totalServices > 1 && hasGraphSignal);
          const normalizedBlastRatio = usesBlastSignal ? clamp(blast!.impactRatio, 0, 1) : 0;
          const blastWeight =
            DISTRIBUTION_CONFIG.BLAST_BASELINE_WEIGHT +
            DISTRIBUTION_CONFIG.BLAST_RANGE_WEIGHT * normalizedBlastRatio;
          const monthlyInfrastructureCost = resolveMonthlyInfrastructureCost(service);
          return {
            service,
            criticality,
            typeWeight: resolveTypeWeight(service.nodeType),
            blastWeight,
            blast,
            usesBlastSignal,
            monthlyInfrastructureCost,
            rawWeight: 0,
          };
        })
    : [];

  const maxMonthlyInfrastructureCost = Math.max(
    1,
    ...distributedServices.map((service) => service.monthlyInfrastructureCost),
  );

  const weightedServices = distributedServices.map((service) => {
    const normalizedInfraCost =
      maxMonthlyInfrastructureCost > 0
        ? Math.log1p(service.monthlyInfrastructureCost) / Math.log1p(maxMonthlyInfrastructureCost)
        : 0;
    const infrastructureWeight =
      DISTRIBUTION_CONFIG.INFRA_BASELINE_WEIGHT +
      DISTRIBUTION_CONFIG.INFRA_RANGE_WEIGHT * clamp(normalizedInfraCost, 0, 1);
    const rawWeight = Math.max(
      DISTRIBUTION_CONFIG.RAW_WEIGHT_FLOOR,
      DISTRIBUTION_CONFIG.CRITICALITY_WEIGHTS[service.criticality] *
        DISTRIBUTION_CONFIG.WEIGHT_SPLIT.criticality +
        service.typeWeight * DISTRIBUTION_CONFIG.WEIGHT_SPLIT.serviceType +
        service.blastWeight * DISTRIBUTION_CONFIG.WEIGHT_SPLIT.blastRadius +
        infrastructureWeight * DISTRIBUTION_CONFIG.WEIGHT_SPLIT.infrastructureCost,
    );

    return {
      ...service,
      rawWeight,
    };
  });

  const totalOverrideCost = Array.from(overrideByNodeId.values()).reduce((sum, value) => sum + value, 0);
  const remainingBudget = Math.max(0, roundedGlobalCost - totalOverrideCost);
  const allocatedBudgetByNodeId = allocateBudgetByWeight(
    weightedServices.map((service) => ({
      nodeId: service.service.nodeId,
      rawWeight: service.rawWeight,
      serviceName: service.service.name,
    })),
    remainingBudget,
  );
  const weightedServiceByNodeId = new Map(
    weightedServices.map((service) => [service.service.nodeId, service]),
  );

  return services.map((service) => {
    const overrideCost = overrideByNodeId.get(service.nodeId);
    if (overrideCost != null && overrideCost > 0) {
      return {
        serviceNodeId: service.nodeId,
        serviceName: service.name,
        downtimeCostPerHour: overrideCost,
        impactFactor: roundedGlobalCost > 0 ? clamp(overrideCost / roundedGlobalCost, 0, 1) : 1,
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
        sourceLabel: 'â€”',
        rationale: 'Profil financier non configure',
      };
    }

    const weightedService = weightedServiceByNodeId.get(service.nodeId);
    const allocatedCost = weightedService ? allocatedBudgetByNodeId.get(service.nodeId) || 0 : 0;
    const impactFactor = roundedGlobalCost > 0 ? clamp(allocatedCost / roundedGlobalCost, 0, 1) : 0;
    const criticality =
      weightedService?.criticality ?? normalizeCriticalityLevel(service.criticality);
    const typeLabel = String(service.nodeType || 'APPLICATION').toUpperCase();
    const monthlyCost =
      weightedService?.monthlyInfrastructureCost ?? resolveMonthlyInfrastructureCost(service);

    if (weightedService?.usesBlastSignal && weightedService.blast) {
      const impactedBase = Math.max(1, weightedService.blast.totalServices - 1);
      return {
        serviceNodeId: service.nodeId,
        serviceName: service.name,
        downtimeCostPerHour: allocatedCost,
        impactFactor,
        source: 'blast_radius',
        sourceLabel: `${Math.round(impactFactor * 100)}% - repartition multi-critere (${weightedService.blast.transitiveDependents}/${impactedBase} impactes)`,
        rationale: `${weightedService.blast.rationale}. Part normalisee sur criticite (${criticality}), type (${typeLabel}), blast radius et cout infra estime (${formatMonthlyCost(monthlyCost)}).`,
        blastRadius: {
          directDependents: weightedService.blast.directDependents,
          transitiveDependents: weightedService.blast.transitiveDependents,
          totalServices: weightedService.blast.totalServices,
          impactedServices: weightedService.blast.impactedServices,
        },
      };
    }

    return {
      serviceNodeId: service.nodeId,
      serviceName: service.name,
      downtimeCostPerHour: allocatedCost,
      impactFactor,
      source: 'fallback_criticality',
      sourceLabel: `${Math.round(impactFactor * 100)}% - repartition tier/type/cout infra`,
      rationale: `Pas assez de dependances detectees pour ${service.name}. Repartition normalisee sur criticite (${criticality}), type (${typeLabel}) et cout infra estime (${formatMonthlyCost(monthlyCost)}).`,
    };
  });
}

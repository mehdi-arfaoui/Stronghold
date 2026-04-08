import type { Criticality, ServicePosture } from '../services/index.js';
import type { ScanSnapshot } from './history-types.js';
import type { FindingLifecycle, TrackedFinding } from './finding-lifecycle-types.js';

const SEVERITY_FACTORS = {
  critical: 4,
  high: 2,
  medium: 1,
  low: 0.5,
} as const;

const CRITICALITY_FACTORS: Record<Criticality, number> = {
  critical: 4,
  high: 2,
  medium: 1,
  low: 0.5,
};

export interface FindingDebt {
  readonly findingKey: string;
  readonly ruleId: string;
  readonly nodeId: string;
  readonly severity: keyof typeof SEVERITY_FACTORS;
  readonly ageInDays: number;
  readonly severityFactor: number;
  readonly serviceCriticalityFactor: number;
  readonly debt: number;
  readonly isRecurrent: boolean;
}

export interface ServiceDebt {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly totalDebt: number;
  readonly criticalDebt: number;
  readonly findingDebts: readonly FindingDebt[];
  readonly trend: 'increasing' | 'stable' | 'decreasing';
}

export interface CalculateServiceDebtInput {
  readonly servicePosture?: ServicePosture | null;
  readonly trackedFindings: readonly TrackedFinding[];
  readonly findingLifecycles: readonly FindingLifecycle[];
  readonly previousDebt?: readonly ServiceDebt[];
}

export function calculateServiceDebt(input: CalculateServiceDebtInput): readonly ServiceDebt[] {
  const services = input.servicePosture?.services ?? [];
  const lifecycleByKey = new Map(
    input.findingLifecycles.map((lifecycle) => [lifecycle.findingKey, lifecycle] as const),
  );
  const previousDebtByService = new Map(
    (input.previousDebt ?? []).map((service) => [service.serviceId, service.totalDebt] as const),
  );

  return services
    .map((service) => {
      const serviceCriticalityFactor = CRITICALITY_FACTORS[service.service.criticality];
      const findingDebts = input.trackedFindings
        .filter((finding) => finding.serviceId === service.service.id)
        .map((finding) => {
          const lifecycle = lifecycleByKey.get(finding.findingKey);
          const ageInDays = lifecycle?.ageInDays ?? 0;
          const severityFactor = SEVERITY_FACTORS[finding.severity];
          const recurrenceMultiplier = lifecycle?.isRecurrent ? 1.5 : 1;
          const debt = ageInDays * severityFactor * serviceCriticalityFactor * recurrenceMultiplier;

          return {
            findingKey: finding.findingKey,
            ruleId: finding.ruleId,
            nodeId: finding.nodeId,
            severity: finding.severity,
            ageInDays,
            severityFactor,
            serviceCriticalityFactor,
            debt,
            isRecurrent: lifecycle?.isRecurrent ?? false,
          } satisfies FindingDebt;
        })
        .sort((left, right) => right.debt - left.debt || left.findingKey.localeCompare(right.findingKey));
      const totalDebt = findingDebts.reduce((sum, finding) => sum + finding.debt, 0);
      const criticalDebt = findingDebts
        .filter((finding) => finding.severity === 'critical')
        .reduce((sum, finding) => sum + finding.debt, 0);

      return {
        serviceId: service.service.id,
        serviceName: service.service.name,
        totalDebt,
        criticalDebt,
        findingDebts,
        trend: resolveDebtTrend(totalDebt, previousDebtByService.get(service.service.id) ?? 0),
      } satisfies ServiceDebt;
    })
    .sort((left, right) => right.totalDebt - left.totalDebt || left.serviceName.localeCompare(right.serviceName));
}

export function applyDebtToSnapshot(
  snapshot: ScanSnapshot,
  serviceDebt: readonly ServiceDebt[],
): ScanSnapshot {
  const debtByService = new Map(serviceDebt.map((service) => [service.serviceId, service.totalDebt] as const));

  return {
    ...snapshot,
    totalDebt: serviceDebt.reduce((sum, service) => sum + service.totalDebt, 0),
    services: snapshot.services.map((service) => ({
      ...service,
      ...(debtByService.has(service.serviceId) ? { debt: debtByService.get(service.serviceId) ?? 0 } : {}),
    })),
  };
}

function resolveDebtTrend(
  currentDebt: number,
  previousDebt: number,
): ServiceDebt['trend'] {
  if (previousDebt === 0) {
    return currentDebt === 0 ? 'stable' : 'increasing';
  }

  if (currentDebt < previousDebt * 0.9) {
    return 'decreasing';
  }
  if (currentDebt > previousDebt * 1.1) {
    return 'increasing';
  }
  return 'stable';
}

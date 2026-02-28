import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { simulationsApi } from '@/api/simulations.api';
import { useSimulationStore } from '@/stores/simulation.store';
import type {
  Simulation,
  SimulationConfig,
  SimulationRecommendation,
  SimulationResult,
} from '@/types/simulation.types';

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object';
}

function mapRecommendation(raw: unknown, index: number): SimulationRecommendation {
  const rec = isObject(raw) ? raw : {};
  const priorityRaw = String(rec.priority ?? 'P2');
  const priority: SimulationRecommendation['priority'] =
    priorityRaw === 'P0' || priorityRaw === 'P1' || priorityRaw === 'P2' ? priorityRaw : 'P2';
  const effortRaw = String(rec.effort ?? 'medium');
  const effort: SimulationRecommendation['effort'] =
    effortRaw === 'low' || effortRaw === 'medium' || effortRaw === 'high' ? effortRaw : 'medium';
  const categoryRaw = String(rec.category ?? 'process');
  const category: SimulationRecommendation['category'] =
    categoryRaw === 'failover' ||
    categoryRaw === 'backup' ||
    categoryRaw === 'redundancy' ||
    categoryRaw === 'isolation' ||
    categoryRaw === 'monitoring' ||
    categoryRaw === 'process'
      ? categoryRaw
      : 'process';

  return {
    id: String(rec.id ?? `rec-${index}`),
    priority,
    title: String(rec.title ?? 'Recommendation'),
    description: String(rec.description ?? ''),
    action: String(rec.action ?? rec.title ?? 'Investigate and remediate'),
    estimatedRto: Number(rec.estimatedRto ?? 0),
    affectedNodes: Array.isArray(rec.affectedNodes)
      ? rec.affectedNodes.map((n, i) => String(n ?? `node-${i}`))
      : [],
    category,
    effort,
    normativeReference: rec.normativeReference ? String(rec.normativeReference) : undefined,
  };
}

function mapEngineResultToUiResult(raw: UnknownRecord): SimulationResult {
  const directlyAffected = Array.isArray(raw.directlyAffected) ? raw.directlyAffected : [];
  const cascadeImpacted = Array.isArray(raw.cascadeImpacted) ? raw.cascadeImpacted : [];
  const businessImpact = Array.isArray(raw.businessImpact) ? raw.businessImpact : [];
  const metrics = isObject(raw.metrics) ? raw.metrics : {};
  const recommendationsRaw = Array.isArray(raw.recommendations) ? raw.recommendations : [];
  const blastRadiusMetricsRaw = isObject(raw.blastRadiusMetrics) ? raw.blastRadiusMetrics : {};
  const warRoomDataRaw = isObject(raw.warRoomData) ? raw.warRoomData : {};
  const warRoomFinancialRaw = isObject(raw.warRoomFinancial) ? raw.warRoomFinancial : {};

  const affectedNodes = [
    ...directlyAffected.map((node, index) => {
      const n = isObject(node) ? node : {};
      return {
        nodeId: String(n.id ?? `direct-${index}`),
        nodeName: String(n.name ?? 'Node'),
        nodeType: String(n.type ?? 'UNKNOWN'),
        status: 'down' as const,
        cascadeLevel: 0,
      };
    }),
    ...cascadeImpacted.map((node, index) => {
      const n = isObject(node) ? node : {};
      return {
        nodeId: String(n.id ?? `cascade-${index}`),
        nodeName: String(n.name ?? 'Node'),
        nodeType: String(n.type ?? 'UNKNOWN'),
        status: n.status === 'degraded' ? ('degraded' as const) : ('down' as const),
        cascadeLevel: Number(n.cascadeDepth ?? n.level ?? 1),
      };
    }),
  ];

  const mappedRecommendations = recommendationsRaw.map((rec, index) => mapRecommendation(rec, index));

  return {
    nodesDown: affectedNodes.filter((n) => n.status === 'down').length,
    nodesDegraded: affectedNodes.filter((n) => n.status === 'degraded').length,
    nodesHealthy: 0,
    infrastructureImpact: Number(metrics.percentageInfraAffected ?? 0),
    estimatedDowntime: Number(metrics.estimatedDowntimeMinutes ?? 0),
    financialLoss: Number(metrics.estimatedFinancialLoss ?? 0),
    resilienceScoreBefore: 100,
    resilienceScoreAfter: Number(raw.postIncidentResilienceScore ?? 0),
    affectedNodes,
    impactedServices: businessImpact.map((service) => {
      const s = isObject(service) ? service : {};
      return {
        serviceName: String(s.serviceName ?? s.name ?? 'Service'),
        impact: s.impact === 'total_outage' ? ('total' as const) : ('degraded' as const),
        estimatedRTO: Number(s.estimatedRTO ?? 60),
      };
    }),
    recommendations: mappedRecommendations,
    blastRadiusMetrics: {
      totalNodesImpacted: Number(blastRadiusMetricsRaw.totalNodesImpacted ?? affectedNodes.length),
      totalNodesInGraph: Number(blastRadiusMetricsRaw.totalNodesInGraph ?? 0),
      impactPercentage: Number(blastRadiusMetricsRaw.impactPercentage ?? metrics.percentageInfraAffected ?? 0),
      criticalServicesImpacted: Number(blastRadiusMetricsRaw.criticalServicesImpacted ?? 0),
      estimatedDowntimeMinutes: Number(blastRadiusMetricsRaw.estimatedDowntimeMinutes ?? metrics.estimatedDowntimeMinutes ?? 0),
      propagationDepth: Number(blastRadiusMetricsRaw.propagationDepth ?? 0),
      recoveryComplexity:
        blastRadiusMetricsRaw.recoveryComplexity === 'medium' ||
        blastRadiusMetricsRaw.recoveryComplexity === 'high' ||
        blastRadiusMetricsRaw.recoveryComplexity === 'critical'
          ? blastRadiusMetricsRaw.recoveryComplexity
          : 'low',
    },
    warRoomData: {
      propagationTimeline: Array.isArray(warRoomDataRaw.propagationTimeline)
        ? warRoomDataRaw.propagationTimeline.map((event, index) => {
            const e = isObject(event) ? event : {};
            const delaySeconds = Number(
              e.delaySeconds ?? (Number(e.timestampMinutes ?? index) * 60),
            );
            const impactTypeRaw = String(e.impactType ?? 'initial_failure');
            return {
              timestampMinutes: Number(e.timestampMinutes ?? index),
              delaySeconds,
              nodeId: String(e.nodeId ?? `node-${index}`),
              nodeName: String(e.nodeName ?? 'Node'),
              nodeType: String(e.nodeType ?? 'UNKNOWN'),
              impactType:
                impactTypeRaw === 'direct' || impactTypeRaw === 'direct_cascade'
                  ? ('direct_cascade' as const)
                  : impactTypeRaw === 'cascade' || impactTypeRaw === 'indirect_cascade'
                    ? ('indirect_cascade' as const)
                    : impactTypeRaw === 'degraded'
                      ? ('degraded' as const)
                      : ('initial_failure' as const),
              impactSeverity:
                e.impactSeverity === 'major' || e.impactSeverity === 'minor'
                  ? e.impactSeverity
                  : ('critical' as const),
              edgeType: String(e.edgeType ?? 'default'),
              parentNodeId: e.parentNodeId ? String(e.parentNodeId) : null,
              parentNodeName: e.parentNodeName ? String(e.parentNodeName) : null,
              description: String(e.description ?? 'Propagation event'),
            };
          })
        : [],
      impactedNodes: Array.isArray(warRoomDataRaw.impactedNodes)
        ? warRoomDataRaw.impactedNodes.map((node, index) => {
            const n = isObject(node) ? node : {};
            const statusRaw = String(n.status ?? 'at_risk');
            return {
              id: String(n.id ?? `impacted-${index}`),
              name: String(n.name ?? 'Node'),
              type: String(n.type ?? 'UNKNOWN'),
              status:
                statusRaw === 'down' ||
                statusRaw === 'degraded' ||
                statusRaw === 'healthy' ||
                statusRaw === 'at_risk'
                  ? statusRaw
                  : ('at_risk' as const),
              impactedAt: Number(n.impactedAt ?? 0),
              impactedAtSeconds: Number(
                n.impactedAtSeconds ?? (Number(n.impactedAt ?? 0) * 60),
              ),
              estimatedRecovery: Number(n.estimatedRecovery ?? 60),
            };
          })
        : [],
      remediationActions: Array.isArray(warRoomDataRaw.remediationActions)
        ? warRoomDataRaw.remediationActions.map((action, index) => {
            const a = isObject(action) ? action : {};
            const statusRaw = String(a.status ?? 'pending');
            const priorityRaw = String(a.priority ?? 'P2');
            return {
              id: String(a.id ?? `action-${index}`),
              title: String(a.title ?? 'Remediation action'),
              status:
                statusRaw === 'in_progress' || statusRaw === 'completed'
                  ? statusRaw
                  : ('pending' as const),
              priority:
                priorityRaw === 'P0' || priorityRaw === 'P1' || priorityRaw === 'P2'
                  ? priorityRaw
                  : ('P2' as const),
            };
          })
        : [],
    },
    warRoomFinancial: {
      hourlyDowntimeCost: Number(warRoomFinancialRaw.hourlyDowntimeCost ?? 0),
      recoveryCostEstimate: Number(warRoomFinancialRaw.recoveryCostEstimate ?? 0),
      projectedBusinessLoss: Number(
        warRoomFinancialRaw.projectedBusinessLoss ?? metrics.estimatedFinancialLoss ?? 0,
      ),
      totalDurationSeconds: Number(
        warRoomFinancialRaw.totalDurationSeconds ??
          (Number(warRoomFinancialRaw.totalDurationMinutes ?? metrics.estimatedDowntimeMinutes ?? 0) *
            60),
      ),
      totalDurationMinutes: Number(
        warRoomFinancialRaw.totalDurationMinutes ?? metrics.estimatedDowntimeMinutes ?? 0,
      ),
      costConfidence:
        warRoomFinancialRaw.costConfidence === 'reliable' ||
        warRoomFinancialRaw.costConfidence === 'approximate'
          ? warRoomFinancialRaw.costConfidence
          : ('gross' as const),
      costConfidenceLabel: String(
        warRoomFinancialRaw.costConfidenceLabel ??
          'Estimation grossiere - configurez le profil financier',
      ),
      biaCoverageRatio: Number(warRoomFinancialRaw.biaCoverageRatio ?? 0),
      trackedNodeCount: Number(warRoomFinancialRaw.trackedNodeCount ?? 0),
      cumulativeLossTimeline: Array.isArray(warRoomFinancialRaw.cumulativeLossTimeline)
        ? warRoomFinancialRaw.cumulativeLossTimeline.map((row, index) => {
            const item = isObject(row) ? row : {};
            return {
              timestampMinutes: Number(item.timestampMinutes ?? index),
              timestampSeconds: Number(
                item.timestampSeconds ?? (Number(item.timestampMinutes ?? index) * 60),
              ),
              cumulativeBusinessLoss: Number(item.cumulativeBusinessLoss ?? 0),
              activeHourlyCost: Number(item.activeHourlyCost ?? 0),
            };
          })
        : [],
      nodeCostBreakdown: Array.isArray(warRoomFinancialRaw.nodeCostBreakdown)
        ? warRoomFinancialRaw.nodeCostBreakdown.map((row, index) => {
            const item = isObject(row) ? row : {};
            return {
              nodeId: String(item.nodeId ?? `node-${index}`),
              nodeName: String(item.nodeName ?? 'Node'),
              nodeType: String(item.nodeType ?? 'UNKNOWN'),
              costPerHour: Number(item.costPerHour ?? 0),
              totalCost: Number(item.totalCost ?? 0),
              recoveryCost: Number(item.recoveryCost ?? 0),
              rtoMinutes: Number(item.rtoMinutes ?? 0),
              downtimeMinutes: Number(item.downtimeMinutes ?? 0),
              downtimeSeconds: Number(
                item.downtimeSeconds ?? (Number(item.downtimeMinutes ?? 0) * 60),
              ),
              impactedAtSeconds: Number(item.impactedAtSeconds ?? 0),
              costSource:
                item.costSource === 'bia_configured' ||
                item.costSource === 'infra_estimated'
                  ? item.costSource
                  : item.costSource === 'fallback'
                    ? 'fallback'
                    : undefined,
              costSourceLabel: item.costSourceLabel
                ? String(item.costSourceLabel)
                : undefined,
              recoveryStrategy: item.recoveryStrategy
                ? String(item.recoveryStrategy)
                : undefined,
              monthlyDrCost: Number(item.monthlyDrCost ?? 0),
              recoveryActivationFactor: Number(item.recoveryActivationFactor ?? 0),
            };
          })
        : [],
    },
    cascadeSteps: cascadeImpacted.map((node, index) => {
      const n = isObject(node) ? node : {};
      return {
        step: index + 1,
        description: String(n.reason ?? n.cascadeReason ?? n.name ?? 'Propagation'),
        nodesAffected: [String(n.id ?? `cascade-${index}`)],
      };
    }),
  };
}

function normalizeSimulation(raw: unknown): Simulation | null {
  if (!isObject(raw)) return null;

  if (raw.result && isObject(raw.result)) {
    return raw as unknown as Simulation;
  }

  const hasEngineShape = Array.isArray(raw.directlyAffected) || Array.isArray(raw.cascadeImpacted);
  if (hasEngineShape) {
    const scenario = isObject(raw.scenario) ? raw.scenario : {};
    return {
      id: String(raw.id ?? `sim-${Date.now()}`),
      name: String(scenario.name ?? 'Simulation'),
      scenarioType: String(scenario.scenarioType ?? 'custom') as Simulation['scenarioType'],
      status: 'completed',
      params: isObject(scenario.params) ? scenario.params : {},
      result: mapEngineResultToUiResult(raw),
      createdAt: String(raw.executedAt ?? new Date().toISOString()),
      completedAt: String(raw.executedAt ?? new Date().toISOString()),
    };
  }

  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Simulation'),
    scenarioType: String(raw.scenarioType ?? 'custom') as Simulation['scenarioType'],
    status: String(raw.status ?? 'completed') as Simulation['status'],
    params: isObject(raw.params) ? raw.params : {},
    result: isObject(raw.result) ? (raw.result as unknown as SimulationResult) : undefined,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
  };
}

function normalizeSimulationList(raw: unknown): Simulation[] {
  if (Array.isArray(raw)) {
    return raw.map(normalizeSimulation).filter((s): s is Simulation => !!s);
  }

  if (isObject(raw) && Array.isArray(raw.simulations)) {
    return raw.simulations.map(normalizeSimulation).filter((s): s is Simulation => !!s);
  }

  return [];
}

export function useSimulation(id?: string) {
  const queryClient = useQueryClient();
  const { setActiveSimulation } = useSimulationStore();

  const simulationQuery = useQuery({
    queryKey: ['simulation', id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await simulationsApi.getById(id);
      const normalized = normalizeSimulation(data);
      if (normalized) {
        setActiveSimulation(normalized);
      }
      return normalized;
    },
    enabled: !!id,
  });

  const simulationsListQuery = useQuery({
    queryKey: ['simulations'],
    queryFn: async () => {
      const { data } = await simulationsApi.getAll();
      return normalizeSimulationList(data);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (config: SimulationConfig) => {
      const { data } = await simulationsApi.create(config);
      return normalizeSimulation(data);
    },
    onSuccess: (simulation) => {
      if (simulation) {
        setActiveSimulation(simulation);
      }
      queryClient.invalidateQueries({ queryKey: ['simulations'] });
    },
  });

  return {
    simulationQuery,
    simulationsListQuery,
    createMutation,
    simulation: simulationQuery.data ?? null,
    simulations: simulationsListQuery.data ?? [],
    simulationsLoading: simulationsListQuery.isLoading,
    createSimulation: async (config: SimulationConfig) => createMutation.mutateAsync(config),
    isCreating: createMutation.isPending,
  };
}

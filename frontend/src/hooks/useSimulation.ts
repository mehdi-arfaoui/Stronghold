import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { simulationsApi } from '@/api/simulations.api';
import { useSimulationStore } from '@/stores/simulation.store';
import type { Simulation, SimulationConfig, SimulationResult } from '@/types/simulation.types';

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object';
}

function mapEngineResultToUiResult(raw: UnknownRecord): SimulationResult {
  const directlyAffected = Array.isArray(raw.directlyAffected) ? raw.directlyAffected : [];
  const cascadeImpacted = Array.isArray(raw.cascadeImpacted) ? raw.cascadeImpacted : [];
  const businessImpact = Array.isArray(raw.businessImpact) ? raw.businessImpact : [];
  const metrics = isObject(raw.metrics) ? raw.metrics : {};
  const recommendations = Array.isArray(raw.recommendations) ? raw.recommendations : [];

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
        status: n.status === 'degraded' ? 'degraded' as const : 'down' as const,
        cascadeLevel: Number(n.level ?? 1),
      };
    }),
  ];

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
        serviceName: String(s.name ?? 'Service'),
        impact: s.impactLevel === 'critical' ? 'total' as const : 'degraded' as const,
        estimatedRTO: Number(s.estimatedRTO ?? 60),
      };
    }),
    recommendations: recommendations.map((rec) => {
      if (!isObject(rec)) return String(rec);
      return String(rec.message ?? rec.action ?? 'Recommendation');
    }),
    cascadeSteps: cascadeImpacted.map((node, index) => {
      const n = isObject(node) ? node : {};
      return {
        step: index + 1,
        description: String(n.reason ?? n.name ?? 'Propagation'),
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
    return raw.simulations
      .map(normalizeSimulation)
      .filter((s): s is Simulation => !!s);
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
    simulation: simulationQuery.data,
    simulationLoading: simulationQuery.isLoading,
    simulations: simulationsListQuery.data ?? [],
    simulationsLoading: simulationsListQuery.isLoading,
    createSimulation: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}

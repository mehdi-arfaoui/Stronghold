import type { GraphInstance } from '../graph/graphService.js';
import type { InfraNodeAttrs } from '../graph/types.js';
import { NodeType } from '../graph/types.js';

export interface RecoveryPriority {
  nodeId: string;
  nodeName: string;
  score: number;
  tier: 'T0' | 'T1' | 'T2' | 'T3';
  rto: number;
  dependentCount: number;
  criticalityScore: number;
  reasoning: string;
}

const SERVICE_TYPES = new Set<string>([
  NodeType.APPLICATION,
  NodeType.MICROSERVICE,
  NodeType.API_GATEWAY,
  NodeType.LOAD_BALANCER,
  NodeType.SERVERLESS,
]);

function scoreCriticality(raw?: number | null): number {
  const normalized = Number(raw ?? 0);
  if (normalized > 0 && normalized <= 5) {
    return (normalized / 5) * 100;
  }

  return Math.max(0, Math.min(100, normalized));
}

function scoreInverseRto(rtoMinutes: number): number {
  const safeRto = Math.max(rtoMinutes, 1);
  return Math.max(0, Math.min(100, (1 / safeRto) * 240));
}

function scoreFinancialImpact(rawImpact?: number | null): number {
  const value = Math.max(0, Number(rawImpact ?? 0));
  return Math.max(0, Math.min(100, value / 1000));
}

function tierFromRto(rto: number): RecoveryPriority['tier'] {
  if (rto < 60) return 'T0';
  if (rto < 240) return 'T1';
  if (rto < 1440) return 'T2';
  return 'T3';
}

export function computeRecoveryPriorities(graph: GraphInstance): RecoveryPriority[] {
  const services: RecoveryPriority[] = [];

  graph.forEachNode((nodeId: string, attrs: unknown) => {
    const node = attrs as InfraNodeAttrs;
    if (!SERVICE_TYPES.has(node.type)) return;

    const dependentCount = Math.max(graph.inDegree(nodeId), 0);
    const dependentScore = Math.min(100, dependentCount * 10);

    const rto =
      Number(node.validatedRTO ?? node.suggestedRTO ?? 240) ||
      240;
    const inverseRtoScore = scoreInverseRto(rto);
    const criticality = scoreCriticality(node.criticalityScore ?? null);
    const financialImpact = scoreFinancialImpact(node.financialImpactPerHour ?? null);

    const score =
      criticality * 0.35 +
      dependentScore * 0.25 +
      inverseRtoScore * 0.25 +
      financialImpact * 0.15;

    services.push({
      nodeId,
      nodeName: node.name ?? nodeId,
      score: Math.round(Math.max(0, Math.min(100, score)) * 10) / 10,
      tier: tierFromRto(rto),
      rto,
      dependentCount,
      criticalityScore: Math.round(criticality * 10) / 10,
      reasoning: `Criticité ${Math.round(criticality)} + dépendants ${dependentCount} + inverse RTO ${Math.round(inverseRtoScore)} + impact financier ${Math.round(financialImpact)}.`,
    });
  });

  return services.sort((a, b) => b.score - a.score);
}

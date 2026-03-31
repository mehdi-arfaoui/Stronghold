import type { GraphAnalysisReport } from '@stronghold-dr/core';

export interface SerializedGraphAnalysis {
  readonly timestamp: string;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly spofs: GraphAnalysisReport['spofs'];
  readonly criticalityScores: Record<string, number>;
  readonly redundancyIssues: GraphAnalysisReport['redundancyIssues'];
  readonly regionalRisks: GraphAnalysisReport['regionalRisks'];
  readonly circularDeps: GraphAnalysisReport['circularDeps'];
  readonly cascadeChains: GraphAnalysisReport['cascadeChains'];
  readonly resilienceScore: number;
}

export function serializeAnalysis(report: GraphAnalysisReport): SerializedGraphAnalysis {
  return {
    timestamp: report.timestamp.toISOString(),
    totalNodes: report.totalNodes,
    totalEdges: report.totalEdges,
    spofs: report.spofs,
    criticalityScores: Object.fromEntries(report.criticalityScores.entries()),
    redundancyIssues: report.redundancyIssues,
    regionalRisks: report.regionalRisks,
    circularDeps: report.circularDeps,
    cascadeChains: report.cascadeChains,
    resilienceScore: report.resilienceScore,
  };
}

export function deserializeAnalysis(
  report: SerializedGraphAnalysis,
): GraphAnalysisReport {
  return {
    timestamp: new Date(report.timestamp),
    totalNodes: report.totalNodes,
    totalEdges: report.totalEdges,
    spofs: [...report.spofs],
    criticalityScores: new Map(Object.entries(report.criticalityScores)),
    redundancyIssues: [...report.redundancyIssues],
    regionalRisks: [...report.regionalRisks],
    circularDeps: [...report.circularDeps],
    cascadeChains: [...report.cascadeChains],
    resilienceScore: report.resilienceScore,
  };
}

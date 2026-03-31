import {
  allValidationRules,
  analyzeFullGraph,
  generateDRPlan,
  runValidation,
  type GraphAnalysisReport,
  type InfraNode,
} from '@stronghold-dr/core';

import { buildGraph, snapshotEdges, snapshotNodes } from './graph-builder.js';
import type { ScanResults, SerializedGraphAnalysis, StoredScanEdge } from '../storage/file-store.js';

export interface ScanPipelineInput {
  readonly provider: string;
  readonly regions: readonly string[];
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<StoredScanEdge>;
  readonly timestamp: string;
  readonly warnings?: readonly string[];
  readonly isDemo?: boolean;
  readonly onStage?: (stage: 'graph' | 'validation' | 'plan') => void | Promise<void>;
}

export async function runScanPipeline(input: ScanPipelineInput): Promise<ScanResults> {
  await input.onStage?.('graph');
  const graph = buildGraph(input.nodes, input.edges);
  const analysis = await analyzeFullGraph(graph);
  const analyzedNodes = snapshotNodes(graph);
  const analyzedEdges = snapshotEdges(graph);
  await input.onStage?.('validation');
  const validationReport = runValidation(analyzedNodes, analyzedEdges, allValidationRules);
  await input.onStage?.('plan');
  const drpPlan = generateDRPlan({
    graph,
    analysis,
    provider: input.provider,
    generatedAt: new Date(input.timestamp),
  });

  return {
    timestamp: input.timestamp,
    provider: input.provider,
    regions: [...input.regions],
    nodes: analyzedNodes,
    edges: analyzedEdges,
    analysis: serializeAnalysis(analysis),
    validationReport,
    drpPlan,
    ...(input.warnings && input.warnings.length > 0 ? { warnings: [...input.warnings] } : {}),
    ...(input.isDemo ? { isDemo: true } : {}),
  };
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

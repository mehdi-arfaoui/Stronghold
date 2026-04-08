import {
  allValidationRules,
  analyzeFullGraph,
  buildServicePosture,
  generateDRPlan,
  generateRecommendations,
  type GraphOverrides,
  runValidation,
  type GraphAnalysisReport,
  type InfraNode,
  loadManualServices,
  type Service,
} from '@stronghold-dr/core';

import { preparePipelineGraph } from './graph-adjustments.js';
import { buildGraph, snapshotEdges, snapshotNodes } from './graph-builder.js';
import type { ScanResults, SerializedGraphAnalysis, StoredScanEdge } from '../storage/file-store.js';

export interface ScanPipelineInput {
  readonly provider: string;
  readonly regions: readonly string[];
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<StoredScanEdge>;
  readonly timestamp: string;
  readonly graphOverrides?: GraphOverrides | null;
  readonly scanMetadata?: ScanResults['scanMetadata'];
  readonly warnings?: readonly string[];
  readonly isDemo?: boolean;
  readonly servicesFilePath?: string;
  readonly previousAssignments?: readonly Service[];
  readonly onStage?: (stage: 'graph' | 'validation' | 'plan') => void | Promise<void>;
  readonly onServiceLog?: (message: string) => void;
}

export async function runScanPipeline(input: ScanPipelineInput): Promise<ScanResults> {
  await input.onStage?.('graph');
  const prepared = preparePipelineGraph({
    nodes: input.nodes,
    edges: input.edges,
    graphOverrides: input.graphOverrides,
  });
  const allWarnings = [...(input.warnings ?? []), ...prepared.warnings];
  const graph = buildGraph(prepared.nodes, prepared.edges);
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
  const recommendations = generateRecommendations({
    nodes: analyzedNodes,
    validationReport,
    drpPlan,
    isDemo: input.isDemo,
  });
  const manualServices = input.servicesFilePath
    ? loadManualServices(analyzedNodes, {
        filePath: input.servicesFilePath,
        previousAssignments: input.previousAssignments,
      })
    : null;
  const serviceWarnings = [
    ...(manualServices?.warnings ?? []),
    ...formatNewMatchesWarnings(manualServices?.newMatches ?? []),
  ];
  const servicePosture = buildServicePosture({
    nodes: analyzedNodes,
    edges: analyzedEdges,
    validationReport,
    recommendations,
    manualServices: manualServices?.services,
    onLog: input.onServiceLog,
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
    servicePosture,
    ...(input.scanMetadata ? { scanMetadata: input.scanMetadata } : {}),
    ...(allWarnings.length > 0 || serviceWarnings.length > 0
      ? { warnings: [...allWarnings, ...serviceWarnings] }
      : {}),
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

function formatNewMatchesWarnings(
  matches: ReadonlyArray<{
    readonly serviceId: string;
    readonly serviceName: string;
    readonly resourceIds: readonly string[];
  }>,
): readonly string[] {
  return matches.map(
    (match) =>
      `${match.resourceIds.length} new resource${match.resourceIds.length === 1 ? '' : 's'} matched service "${match.serviceName}" since the previous assignment review.`,
  );
}

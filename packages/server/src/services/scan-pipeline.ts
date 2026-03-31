import {
  allValidationRules,
  analyzeFullGraph,
  generateDRPlan,
  type DRPlan,
  type GraphAnalysisReport,
  type InfraNode,
  runValidation,
  type ScanEdge,
  type ValidationReport,
} from '@stronghold-dr/core';

import { serializeAnalysis, type SerializedGraphAnalysis } from './analysis-serialization.js';
import { buildGraph, snapshotEdges, snapshotNodes } from './graph-builder.js';

export interface ScanPipelineInput {
  readonly provider: string;
  readonly regions: readonly string[];
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ScanEdge>;
  readonly timestamp: Date;
}

export interface ScanPipelineArtifacts {
  readonly graph: ReturnType<typeof buildGraph>;
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ScanEdge>;
  readonly analysis: GraphAnalysisReport;
  readonly serializedAnalysis: SerializedGraphAnalysis;
  readonly validationReport: ValidationReport;
  readonly drPlan: DRPlan;
}

// TODO: Extract the scan -> graph -> validation -> DRP pipeline into a shared
// module used by both packages/cli/src/pipeline and packages/server/src/services.
// For v0.1, duplicating the orchestration is acceptable because the core owns
// all business logic and only the call order is repeated here.
export async function runScanPipeline(
  input: ScanPipelineInput,
): Promise<ScanPipelineArtifacts> {
  const graph = buildGraph(input.nodes, input.edges);
  const analysis = await analyzeFullGraph(graph);
  const analyzedNodes = snapshotNodes(graph);
  const analyzedEdges = snapshotEdges(graph);
  const validationReport = runValidation(analyzedNodes, analyzedEdges, allValidationRules);
  const drPlan = generateDRPlan({
    graph,
    analysis,
    provider: input.provider,
    generatedAt: input.timestamp,
  });

  return {
    graph,
    nodes: analyzedNodes,
    edges: analyzedEdges,
    analysis,
    serializedAnalysis: serializeAnalysis(analysis),
    validationReport,
    drPlan,
  };
}

/**
 * Main graph analysis engine — orchestrates SPOF detection,
 * criticality scoring, redundancy analysis, regional risks,
 * circular dependency detection, and cascade chain analysis.
 */

import type {
  InfraNodeAttrs,
  GraphAnalysisReport,
  RegionalRisk,
  CircularDependency,
  CascadeChain,
} from '../types/index.js';
import type { CloudServiceResolver } from '../ports/cloud-service-resolver.js';
import type { GraphInstance } from './graph-instance.js';
import { getBlastRadius } from './graph-utils.js';
import { DEFAULT_RESOLVER } from './analysis-helpers.js';
import { detectSPOFs } from './spof-detection.js';
import { analyzeRedundancy } from './redundancy-analysis.js';
import { computeCriticality } from './criticality-scoring.js';

export async function analyzeFullGraph(
  graph: GraphInstance,
  resolver: CloudServiceResolver = DEFAULT_RESOLVER,
): Promise<GraphAnalysisReport> {
  const spofs = detectSPOFs(graph, resolver);
  const criticalityScores = computeCriticality(graph, resolver);
  const redundancyIssues = analyzeRedundancy(graph, resolver);
  const regionalRisks = analyzeRegionalConcentration(graph, criticalityScores);
  const circularDeps = detectCircularDependencies(graph);
  const cascadeChains = analyzeCascadeChains(graph);

  const report: GraphAnalysisReport = {
    timestamp: new Date(),
    totalNodes: graph.order,
    totalEdges: graph.size,
    spofs,
    criticalityScores,
    redundancyIssues,
    regionalRisks,
    circularDeps,
    cascadeChains,
    resilienceScore: 0,
  };

  (report as { resilienceScore: number }).resilienceScore = computeOverallResilience(report);

  graph.forEachNode((nodeId) => {
    const score = criticalityScores.get(nodeId) ?? 0;
    graph.setNodeAttribute(nodeId, 'criticalityScore', score);
    graph.setNodeAttribute(
      nodeId,
      'isSPOF',
      spofs.some((s) => s.nodeId === nodeId),
    );
    graph.setNodeAttribute(nodeId, 'dependentsCount', graph.inDegree(nodeId));
    graph.setNodeAttribute(nodeId, 'dependenciesCount', graph.outDegree(nodeId));
  });

  graph.forEachNode((nodeId) => {
    const blast = getBlastRadius(graph, nodeId);
    graph.setNodeAttribute(nodeId, 'blastRadius', blast.length);
  });

  return report;
}

function analyzeRegionalConcentration(
  graph: GraphInstance,
  criticalityScores: Map<string, number>,
): RegionalRisk[] {
  const regionMap = new Map<string, { total: number; critical: number; nodes: string[] }>();

  graph.forEachNode((nodeId, rawAttrs) => {
    const a = rawAttrs as unknown as InfraNodeAttrs;
    if (!a.region) return;
    if (!regionMap.has(a.region)) {
      regionMap.set(a.region, { total: 0, critical: 0, nodes: [] });
    }
    const entry = regionMap.get(a.region)!;
    entry.total++;
    entry.nodes.push(a.name);
    if ((criticalityScores.get(nodeId) ?? 0) > 70) entry.critical++;
  });

  const risks: RegionalRisk[] = [];
  const totalNodes = graph.order;
  if (totalNodes === 0) return risks;

  for (const [region, data] of regionMap) {
    const concentration = data.total / totalNodes;
    if (concentration > 0.7) {
      risks.push({
        region,
        concentration: Math.round(concentration * 100),
        totalNodes: data.total,
        criticalNodes: data.critical,
        risk: 'critical',
        recommendation: `${Math.round(concentration * 100)}% of infrastructure is concentrated in ${region}. Consider multi-region distribution.`,
      });
    } else if (concentration > 0.5) {
      risks.push({
        region,
        concentration: Math.round(concentration * 100),
        totalNodes: data.total,
        criticalNodes: data.critical,
        risk: 'high',
        recommendation: `High concentration in ${region}. Plan critical service distribution across regions.`,
      });
    }
  }
  return risks;
}

function detectCircularDependencies(graph: GraphInstance): CircularDependency[] {
  const cycles: CircularDependency[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  const dfs = (nodeId: string): void => {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    for (const neighbor of graph.outNeighbors(nodeId)) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart >= 0) {
          const cycleNodes = path.slice(cycleStart).map((id) => ({
            id,
            name: (graph.getNodeAttributes(id) as unknown as InfraNodeAttrs).name,
          }));
          if (cycleNodes.length > 1) {
            const key = cycleNodes
              .map((n) => n.id)
              .sort()
              .join(',');
            if (
              !cycles.some(
                (c) =>
                  c.nodes
                    .map((n) => n.id)
                    .sort()
                    .join(',') === key,
              )
            ) {
              cycles.push({ nodes: cycleNodes, length: cycleNodes.length });
            }
          }
        }
      }
    }

    path.pop();
    inStack.delete(nodeId);
  };

  graph.forEachNode((nodeId) => {
    if (!visited.has(nodeId)) dfs(nodeId);
  });

  return cycles;
}

const MAX_CASCADE_ANALYSIS_NODES = 20;

function analyzeCascadeChains(graph: GraphInstance): CascadeChain[] {
  const chains: CascadeChain[] = [];
  const nodesByInDegree: Array<{ id: string; inDeg: number }> = [];

  graph.forEachNode((nodeId) => {
    nodesByInDegree.push({ id: nodeId, inDeg: graph.inDegree(nodeId) });
  });
  nodesByInDegree.sort((a, b) => b.inDeg - a.inDeg);

  for (const { id } of nodesByInDegree.slice(0, MAX_CASCADE_ANALYSIS_NODES)) {
    const blast = getBlastRadius(graph, id);
    if (blast.length > 2) {
      const attrs = graph.getNodeAttributes(id) as unknown as InfraNodeAttrs;
      chains.push({
        sourceNodeId: id,
        sourceNodeName: attrs.name,
        depth: Math.max(...blast.map(() => 1), 0),
        totalImpacted: blast.length,
        impactedNodes: blast.slice(0, 50).map((n, i) => ({
          id: n.id,
          name: n.name,
          depth: i + 1,
        })),
      });
    }
  }

  return chains.sort((a, b) => b.totalImpacted - a.totalImpacted);
}

function computeOverallResilience(report: GraphAnalysisReport): number {
  let score = 100;

  const criticalSPOFs = report.spofs.filter((s) => s.severity === 'critical').length;
  const highSPOFs = report.spofs.filter((s) => s.severity === 'high').length;
  score -= Math.min(30, criticalSPOFs * 10 + highSPOFs * 5);

  if (report.redundancyIssues.length > 0) {
    const avg =
      report.redundancyIssues.reduce((sum, i) => sum + i.redundancyScore, 0) /
      report.redundancyIssues.length;
    score -= Math.round((1 - avg / 100) * 25);
  }

  const hasCriticalRegional = report.regionalRisks.some((r) => r.risk === 'critical');
  if (hasCriticalRegional) score -= 20;
  else if (report.regionalRisks.some((r) => r.risk === 'high')) score -= 10;

  score -= Math.min(15, report.circularDeps.length * 5);

  return Math.max(0, Math.min(100, score));
}

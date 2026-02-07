// ============================================================
// GraphAnalysisEngine — SPOF detection, criticality, redundancy
// ============================================================

import type {
  InfraNodeAttrs,
  InfraEdgeAttrs,
  GraphAnalysisReport,
  SPOFReport,
  RedundancyIssue,
  RedundancyCheck,
  RegionalRisk,
  CircularDependency,
  CascadeChain,
} from './types.js';
import { NodeType, EdgeType } from './types.js';
import type { GraphInstance } from './graphService.js';
import { getBlastRadius } from './graphService.js';

// =====================================================
//  MAIN ANALYSIS
// =====================================================

export async function analyzeFullGraph(graph: GraphInstance): Promise<GraphAnalysisReport> {
  const spofs = detectSPOFs(graph);
  const criticalityScores = computeCriticality(graph);
  const redundancyIssues = analyzeRedundancy(graph);
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

  report.resilienceScore = computeOverallResilience(report);

  // Persist scores on nodes
  graph.forEachNode((nodeId: string) => {
    const score = criticalityScores.get(nodeId) || 0;
    graph.setNodeAttribute(nodeId, 'criticalityScore', score);
    graph.setNodeAttribute(nodeId, 'isSPOF', spofs.some(s => s.nodeId === nodeId));
    graph.setNodeAttribute(nodeId, 'dependentsCount', graph.inDegree(nodeId));
    graph.setNodeAttribute(nodeId, 'dependenciesCount', graph.outDegree(nodeId));
  });

  // Set blast radius on each node
  graph.forEachNode((nodeId: string) => {
    const blast = getBlastRadius(graph, nodeId);
    graph.setNodeAttribute(nodeId, 'blastRadius', blast.length);
  });

  return report;
}

// =====================================================
//  SPOF DETECTION (Tarjan's articulation points)
// =====================================================

function detectSPOFs(graph: GraphInstance): SPOFReport[] {
  const spofs: SPOFReport[] = [];

  if (graph.order === 0) return spofs;

  // Find articulation points
  const articulationPoints = findArticulationPoints(graph);

  // For each articulation point, compute blast radius
  for (const nodeId of articulationPoints) {
    const blast = getBlastRadius(graph, nodeId);
    const attrs = graph.getNodeAttributes(nodeId) as InfraNodeAttrs;

    let severity: 'critical' | 'high' | 'medium' | 'low';
    const ratio = graph.order > 0 ? blast.length / graph.order : 0;

    if (ratio > 0.5) severity = 'critical';
    else if (ratio > 0.2) severity = 'high';
    else if (blast.length > 5) severity = 'medium';
    else severity = 'low';

    spofs.push({
      nodeId,
      nodeName: attrs.name,
      nodeType: attrs.type,
      severity,
      blastRadius: blast.length,
      impactedServices: blast.map(n => n.name),
      recommendation: generateSPOFRecommendation(attrs, blast.length),
    });
  }

  // Also check high fan-in nodes that aren't articulation points
  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    const inDeg = graph.inDegree(nodeId);
    if (inDeg > 10 && !articulationPoints.has(nodeId)) {
      spofs.push({
        nodeId,
        nodeName: a.name,
        nodeType: a.type,
        severity: 'medium',
        blastRadius: inDeg,
        impactedServices: graph.inNeighbors(nodeId).map(
          (id: string) => (graph.getNodeAttributes(id) as InfraNodeAttrs).name
        ),
        recommendation: `${a.name} has ${inDeg} direct dependents. Consider adding a load balancer or replication.`,
      });
    }
  });

  return spofs.sort((a, b) => b.blastRadius - a.blastRadius);
}

function findArticulationPoints(graph: GraphInstance): Set<string> {
  const visited = new Set<string>();
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const ap = new Set<string>();
  let time = 0;

  const dfs = (u: string) => {
    let children = 0;
    visited.add(u);
    disc.set(u, time);
    low.set(u, time);
    time++;

    // Treat as undirected for articulation point detection
    const neighbors = new Set([...graph.outNeighbors(u), ...graph.inNeighbors(u)]);

    for (const v of neighbors) {
      if (!visited.has(v)) {
        children++;
        parent.set(v, u);
        dfs(v);

        low.set(u, Math.min(low.get(u)!, low.get(v)!));

        // Root with 2+ children
        if (parent.get(u) === null && children > 1) {
          ap.add(u);
        }
        // Non-root with low[v] >= disc[u]
        if (parent.get(u) !== null && low.get(v)! >= disc.get(u)!) {
          ap.add(u);
        }
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  };

  graph.forEachNode((nodeId: string) => {
    if (!visited.has(nodeId)) {
      parent.set(nodeId, null);
      dfs(nodeId);
    }
  });

  return ap;
}

function generateSPOFRecommendation(node: InfraNodeAttrs, blastRadius: number): string {
  const type = node.type;
  if (type === NodeType.DATABASE) {
    return `Add read replicas and enable Multi-AZ for ${node.name} to eliminate this SPOF (blast radius: ${blastRadius} services).`;
  }
  if (type === NodeType.LOAD_BALANCER || type === NodeType.API_GATEWAY) {
    return `Deploy ${node.name} across multiple availability zones (blast radius: ${blastRadius} services).`;
  }
  if (type === NodeType.DNS) {
    return `Configure DNS failover with a secondary provider for ${node.name} (blast radius: ${blastRadius} services).`;
  }
  if (type === NodeType.CACHE) {
    return `Enable replication and cluster mode for ${node.name} (blast radius: ${blastRadius} services).`;
  }
  return `${node.name} (${type}) is a single point of failure affecting ${blastRadius} services. Add redundancy.`;
}

// =====================================================
//  CRITICALITY SCORING
// =====================================================

function computeCriticality(graph: GraphInstance): Map<string, number> {
  const scores = new Map<string, number>();

  if (graph.order === 0) return scores;

  // Simple betweenness approximation using BFS from each node
  const betweenness = computeSimpleBetweenness(graph);
  const maxBetweenness = Math.max(...Array.from(betweenness.values()), 1);

  let maxFanIn = 1;
  graph.forEachNode((nodeId: string) => {
    maxFanIn = Math.max(maxFanIn, graph.inDegree(nodeId));
  });

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    const bc = ((betweenness.get(nodeId) || 0) / maxBetweenness) * 40;
    const fanIn = graph.inDegree(nodeId);
    const fanInScore = (fanIn / maxFanIn) * 25;
    const typeScore = getTypeWeight(a.type) * 20;
    const redundancy = getNodeRedundancyScore(nodeId, graph);
    const redundancyPenalty = (1 - redundancy / 100) * 15;

    scores.set(nodeId, Math.round(bc + fanInScore + typeScore + redundancyPenalty));
  });

  return scores;
}

function computeSimpleBetweenness(graph: GraphInstance): Map<string, number> {
  const betweenness = new Map<string, number>();
  graph.forEachNode((nodeId: string) => betweenness.set(nodeId, 0));

  // Sample nodes for large graphs
  const allNodes = graph.nodes();
  const sampleSize = Math.min(allNodes.length, 100);
  const sampledNodes = allNodes.slice(0, sampleSize);

  for (const source of sampledNodes) {
    // BFS
    const queue = [source];
    const dist = new Map<string, number>([[source, 0]]);
    const paths = new Map<string, number>([[source, 1]]);
    const order: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      const neighbors = new Set([...graph.outNeighbors(current), ...graph.inNeighbors(current)]);
      for (const neighbor of neighbors) {
        if (!dist.has(neighbor)) {
          dist.set(neighbor, dist.get(current)! + 1);
          paths.set(neighbor, 0);
          queue.push(neighbor);
        }
        if (dist.get(neighbor) === dist.get(current)! + 1) {
          paths.set(neighbor, (paths.get(neighbor) || 0) + (paths.get(current) || 0));
        }
      }
    }

    // Accumulate
    const delta = new Map<string, number>();
    graph.forEachNode((nodeId: string) => delta.set(nodeId, 0));

    while (order.length > 0) {
      const w = order.pop()!;
      if (w === source) continue;
      const neighbors = new Set([...graph.outNeighbors(w), ...graph.inNeighbors(w)]);
      for (const v of neighbors) {
        if (dist.get(v) === dist.get(w)! - 1) {
          const contribution = ((paths.get(v) || 0) / (paths.get(w) || 1)) * (1 + (delta.get(w) || 0));
          delta.set(v, (delta.get(v) || 0) + contribution);
        }
      }
      betweenness.set(w, (betweenness.get(w) || 0) + (delta.get(w) || 0));
    }
  }

  return betweenness;
}

function getTypeWeight(type: string): number {
  const weights: Record<string, number> = {
    [NodeType.DATABASE]: 1.0,
    [NodeType.CACHE]: 0.9,
    [NodeType.MESSAGE_QUEUE]: 0.85,
    [NodeType.API_GATEWAY]: 0.8,
    [NodeType.LOAD_BALANCER]: 0.8,
    [NodeType.DNS]: 0.8,
    [NodeType.KUBERNETES_CLUSTER]: 0.75,
    [NodeType.VM]: 0.6,
    [NodeType.CONTAINER]: 0.5,
    [NodeType.SERVERLESS]: 0.4,
    [NodeType.OBJECT_STORAGE]: 0.3,
    [NodeType.VPC]: 0.3,
    [NodeType.SUBNET]: 0.2,
    [NodeType.CDN]: 0.4,
    [NodeType.FIREWALL]: 0.7,
    [NodeType.APPLICATION]: 0.6,
    [NodeType.MICROSERVICE]: 0.55,
    [NodeType.THIRD_PARTY_API]: 0.5,
    [NodeType.SAAS_SERVICE]: 0.45,
    [NodeType.PHYSICAL_SERVER]: 0.6,
    [NodeType.NETWORK_DEVICE]: 0.65,
    [NodeType.FILE_STORAGE]: 0.35,
    [NodeType.REGION]: 0.1,
    [NodeType.AVAILABILITY_ZONE]: 0.1,
    [NodeType.DATA_CENTER]: 0.15,
  };
  return weights[type] || 0.5;
}

function getNodeRedundancyScore(nodeId: string, graph: GraphInstance): number {
  const attrs = graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
  let score = 100;

  // No Multi-AZ for DB/Cache
  if ([NodeType.DATABASE, NodeType.CACHE].includes(attrs.type as NodeType)) {
    if (!attrs.metadata?.isMultiAZ) score -= 25;
    if ((attrs.metadata?.replicaCount as number || 0) === 0) score -= 25;
  }

  // No load balancer in front
  if ([NodeType.VM, NodeType.CONTAINER, NodeType.APPLICATION, NodeType.MICROSERVICE].includes(attrs.type as NodeType)) {
    const hasLB = graph.inNeighbors(nodeId).some((id: string) => {
      const n = graph.getNodeAttributes(id) as InfraNodeAttrs;
      return n.type === NodeType.LOAD_BALANCER;
    });
    if (!hasLB) score -= 25;
  }

  // Check backup edges
  const hasBackup = graph.outEdges(nodeId).some((edgeKey: string) => {
    const edgeAttrs = graph.getEdgeAttributes(edgeKey) as InfraEdgeAttrs;
    return edgeAttrs.type === EdgeType.BACKS_UP_TO;
  });
  if (!hasBackup && [NodeType.DATABASE, NodeType.OBJECT_STORAGE].includes(attrs.type as NodeType)) {
    score -= 25;
  }

  return Math.max(0, score);
}

// =====================================================
//  REDUNDANCY ANALYSIS
// =====================================================

function analyzeRedundancy(graph: GraphInstance): RedundancyIssue[] {
  const issues: RedundancyIssue[] = [];

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    const checks: RedundancyCheck[] = [];

    // Multi-AZ check
    if (!a.metadata?.isMultiAZ &&
      [NodeType.DATABASE, NodeType.CACHE].includes(a.type as NodeType)) {
      checks.push({
        check: 'multi_az',
        passed: false,
        recommendation: `Enable Multi-AZ for ${a.name}`,
        impact: 'high',
      });
    }

    // Read replicas
    if (a.type === NodeType.DATABASE && ((a.metadata?.replicaCount as number) || 0) === 0) {
      checks.push({
        check: 'read_replicas',
        passed: false,
        recommendation: `Add at least one read replica for ${a.name}`,
        impact: 'high',
      });
    }

    // Load balancer
    if ([NodeType.VM, NodeType.CONTAINER].includes(a.type as NodeType)) {
      const hasLB = graph.inNeighbors(nodeId).some(
        (id: string) => (graph.getNodeAttributes(id) as InfraNodeAttrs).type === NodeType.LOAD_BALANCER
      );
      if (!hasLB) {
        checks.push({
          check: 'load_balancer',
          passed: false,
          recommendation: `${a.name} is not behind a load balancer`,
          impact: 'medium',
        });
      }
    }

    // Single region concentration for dependents
    const dependents = graph.inNeighbors(nodeId);
    if (dependents.length > 3) {
      const regions = new Set(
        dependents
          .map(id => (graph.getNodeAttributes(id) as InfraNodeAttrs).region)
          .filter(Boolean)
      );
      if (regions.size === 1) {
        checks.push({
          check: 'single_region',
          passed: false,
          recommendation: `${a.name} and its ${dependents.length} dependents are all in region ${[...regions][0]}`,
          impact: 'high',
        });
      }
    }

    // Backup check
    const hasBackup = graph.outEdges(nodeId).some(edgeKey => {
      return (graph.getEdgeAttributes(edgeKey) as InfraEdgeAttrs).type === EdgeType.BACKS_UP_TO;
    });
    if (!hasBackup && [NodeType.DATABASE, NodeType.OBJECT_STORAGE].includes(a.type as NodeType)) {
      checks.push({
        check: 'backup',
        passed: false,
        recommendation: `No backup detected for ${a.name}`,
        impact: 'critical',
      });
    }

    const failedChecks = checks.filter(c => !c.passed);
    if (failedChecks.length > 0) {
      issues.push({
        nodeId,
        nodeName: a.name,
        nodeType: a.type,
        redundancyScore: Math.max(0, 100 - failedChecks.length * 25),
        failedChecks,
      });
    }
  });

  return issues;
}

// =====================================================
//  REGIONAL CONCENTRATION
// =====================================================

function analyzeRegionalConcentration(graph: GraphInstance, criticalityScores: Map<string, number>): RegionalRisk[] {
  const regionMap = new Map<string, { total: number; critical: number; nodes: string[] }>();

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    if (!a.region) return;
    if (!regionMap.has(a.region)) {
      regionMap.set(a.region, { total: 0, critical: 0, nodes: [] });
    }
    const entry = regionMap.get(a.region)!;
    entry.total++;
    entry.nodes.push(a.name);
    if ((criticalityScores.get(nodeId) || 0) > 70) {
      entry.critical++;
    }
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

// =====================================================
//  CIRCULAR DEPENDENCIES
// =====================================================

function detectCircularDependencies(graph: GraphInstance): CircularDependency[] {
  const cycles: CircularDependency[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  const dfs = (nodeId: string) => {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    for (const neighbor of graph.outNeighbors(nodeId)) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart >= 0) {
          const cycleNodes = path.slice(cycleStart).map(id => ({
            id,
            name: (graph.getNodeAttributes(id) as InfraNodeAttrs).name,
          }));
          // Only add if cycle length > 1 and not already recorded
          if (cycleNodes.length > 1) {
            const key = cycleNodes.map(n => n.id).sort().join(',');
            if (!cycles.some(c => c.nodes.map(n => n.id).sort().join(',') === key)) {
              cycles.push({ nodes: cycleNodes, length: cycleNodes.length });
            }
          }
        }
      }
    }

    path.pop();
    inStack.delete(nodeId);
  };

  graph.forEachNode((nodeId: string) => {
    if (!visited.has(nodeId)) {
      dfs(nodeId);
    }
  });

  return cycles;
}

// =====================================================
//  CASCADE CHAINS
// =====================================================

function analyzeCascadeChains(graph: GraphInstance): CascadeChain[] {
  const chains: CascadeChain[] = [];

  // Analyze top nodes by in-degree (most depended upon)
  const nodesByInDegree: Array<{ id: string; inDeg: number }> = [];
  graph.forEachNode((nodeId: string) => {
    nodesByInDegree.push({ id: nodeId, inDeg: graph.inDegree(nodeId) });
  });
  nodesByInDegree.sort((a, b) => b.inDeg - a.inDeg);

  // Analyze top 20 nodes
  for (const { id } of nodesByInDegree.slice(0, 20)) {
    const blast = getBlastRadius(graph, id);
    if (blast.length > 2) {
      const attrs = graph.getNodeAttributes(id) as InfraNodeAttrs;
      chains.push({
        sourceNodeId: id,
        sourceNodeName: attrs.name,
        depth: Math.max(...blast.map(() => 1), 0), // simplified
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

// =====================================================
//  OVERALL RESILIENCE SCORE
// =====================================================

function computeOverallResilience(report: GraphAnalysisReport): number {
  let score = 100;

  // SPOF critiques: -10 per critical, -5 per high
  const criticalSPOFs = report.spofs.filter(s => s.severity === 'critical').length;
  const highSPOFs = report.spofs.filter(s => s.severity === 'high').length;
  score -= Math.min(30, criticalSPOFs * 10 + highSPOFs * 5);

  // Redundancy average
  if (report.redundancyIssues.length > 0) {
    const avgRedundancy = report.redundancyIssues.reduce(
      (sum, i) => sum + i.redundancyScore, 0
    ) / report.redundancyIssues.length;
    score -= Math.round((1 - avgRedundancy / 100) * 25);
  }

  // Regional concentration
  const hasCriticalRegional = report.regionalRisks.some(r => r.risk === 'critical');
  if (hasCriticalRegional) score -= 20;
  else if (report.regionalRisks.some(r => r.risk === 'high')) score -= 10;

  // Circular dependencies
  score -= Math.min(15, report.circularDeps.length * 5);

  return Math.max(0, Math.min(100, score));
}

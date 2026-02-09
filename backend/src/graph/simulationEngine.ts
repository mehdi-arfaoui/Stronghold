// ============================================================
// SimulationEngine — What-if scenario simulation on graph
// ============================================================

import { randomUUID } from 'crypto';
import type {
  InfraNodeAttrs,
  SimulationScenario,
  SimulationResult,
  SimulationBusinessImpact,
  SimulationRecommendation,
  CascadeNode,
  ScenarioTemplate,
} from './types.js';
import { NodeType } from './types.js';
import type { GraphInstance } from './graphService.js';
import { cloneGraph, calculateCascade } from './graphService.js';

// =====================================================
//  PREDEFINED SCENARIO TEMPLATES
// =====================================================

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: 'region_loss',
    name: 'Complete Region Loss',
    description: 'Simulates total loss of a cloud region (e.g., AWS eu-west-1)',
    icon: 'globe',
    params: [{ name: 'region', type: 'select', options: 'dynamic_from_graph' }],
  },
  {
    id: 'az_loss',
    name: 'Availability Zone Loss',
    description: 'Simulates loss of a single AZ (e.g., eu-west-1a)',
    icon: 'building',
    params: [{ name: 'az', type: 'select', options: 'dynamic_from_graph' }],
  },
  {
    id: 'ransomware',
    name: 'Ransomware Attack',
    description: 'Simulates encryption of all servers of a given type/tag',
    icon: 'lock',
    params: [
      { name: 'targetType', type: 'select', options: Object.values(NodeType) },
      { name: 'targetTag', type: 'string', optional: true },
    ],
  },
  {
    id: 'database_failure',
    name: 'Database Failure',
    description: 'Simulates failure of one or more databases',
    icon: 'database',
    params: [{ name: 'databases', type: 'multi_select', options: 'dynamic_databases' }],
  },
  {
    id: 'network_partition',
    name: 'Network Partition',
    description: 'Simulates loss of connectivity between two VPCs/subnets',
    icon: 'plug',
    params: [
      { name: 'vpcA', type: 'select', options: 'dynamic_vpcs' },
      { name: 'vpcB', type: 'select', options: 'dynamic_vpcs' },
    ],
  },
  {
    id: 'third_party_outage',
    name: 'Third-Party Service Outage',
    description: 'Simulates unavailability of an external service (API, SaaS)',
    icon: 'cloud',
    params: [{ name: 'service', type: 'select', options: 'dynamic_third_party' }],
  },
  {
    id: 'dns_failure',
    name: 'DNS Failure',
    description: 'Simulates a DNS service failure',
    icon: 'signal',
    params: [],
  },
  {
    id: 'custom',
    name: 'Custom Scenario',
    description: 'Manually select nodes to disable',
    icon: 'crosshair',
    params: [{ name: 'nodes', type: 'multi_select', options: 'dynamic_all_nodes' }],
  },
];

// =====================================================
//  RUN SIMULATION
// =====================================================

export function runSimulation(
  graph: GraphInstance,
  scenario: SimulationScenario
): SimulationResult {
  // 1. Clone the graph
  const simGraph = cloneGraph(graph);

  // 2. Apply scenario — identify affected nodes
  const affectedNodeIds = applyScenario(simGraph, scenario) || [];
  const affectedNodes = affectedNodeIds
    .filter(id => simGraph.hasNode(id))
    .map(id => {
      const attrs = simGraph.getNodeAttributes(id) as InfraNodeAttrs;
      return { id, name: attrs.name, type: attrs.type, status: 'down' };
    });

  // 3. Calculate cascade
  const cascade = calculateCascade(simGraph, affectedNodeIds);

  // 4. Identify impacted business services
  const businessImpact = identifyBusinessImpact(simGraph, affectedNodeIds, cascade);

  // 5. Calculate metrics
  const totalAffected = affectedNodeIds.length + cascade.length;
  const totalNodes = graph.order;
  const percentageAffected = totalNodes > 0 ? (totalAffected / totalNodes) * 100 : 0;

  const totalOutageCount = cascade.filter(c => c.status === 'down').length + affectedNodeIds.length;
  const degradedCount = cascade.filter(c => c.status === 'degraded').length;

  // Estimate financial loss
  const financialLoss = businessImpact.reduce(
    (sum, s) => sum + s.financialImpactPerHour, 0
  );

  // Estimate downtime based on worst-case RTO
  const maxRTO = businessImpact.length > 0
    ? Math.max(...businessImpact.map(s => s.estimatedRTO))
    : 60;

  // 6. Generate recommendations
  const recommendations = generateRecommendations(scenario, affectedNodes, cascade);

  // 7. Post-incident resilience score
  const postIncidentScore = calculatePostIncidentScore(totalAffected, totalNodes, cascade);

  return {
    id: randomUUID(),
    scenario,
    executedAt: new Date(),
    directlyAffected: affectedNodes,
    cascadeImpacted: cascade,
    businessImpact,
    metrics: {
      totalNodesAffected: totalAffected,
      percentageInfraAffected: Math.round(percentageAffected * 10) / 10,
      estimatedDowntimeMinutes: maxRTO,
      estimatedFinancialLoss: financialLoss,
      servicesWithTotalOutage: totalOutageCount,
      servicesWithDegradation: degradedCount,
    },
    recommendations,
    postIncidentResilienceScore: postIncidentScore,
  };
}

// =====================================================
//  APPLY SCENARIO
// =====================================================

function applyScenario(graph: GraphInstance, scenario: SimulationScenario): string[] {
  const params = scenario.params;

  switch (scenario.scenarioType) {
    case 'region_loss':
      return removeNodesByRegion(graph, params.region as string);

    case 'az_loss':
      return removeNodesByAZ(graph, params.az as string);

    case 'ransomware':
      return removeNodesByTypeOrTag(
        graph,
        params.targetType as string,
        params.targetTag as string | undefined
      );

    case 'database_failure':
      return params.databases as string[];

    case 'network_partition':
      return removeEdgesBetween(graph, params.vpcA as string, params.vpcB as string);

    case 'third_party_outage':
      return [params.service as string];

    case 'dns_failure':
      return removeNodesByType(graph, NodeType.DNS);

    case 'custom':
      return (params.nodes as string[]) || [];

    default:
      return [];
  }
}

function removeNodesByRegion(graph: GraphInstance, region: string): string[] {
  const affected: string[] = [];
  graph.forEachNode((nodeId: string, attrs: any) => {
    if ((attrs as InfraNodeAttrs).region === region) {
      affected.push(nodeId);
    }
  });
  return affected;
}

function removeNodesByAZ(graph: GraphInstance, az: string): string[] {
  const affected: string[] = [];
  graph.forEachNode((nodeId: string, attrs: any) => {
    if ((attrs as InfraNodeAttrs).availabilityZone === az) {
      affected.push(nodeId);
    }
  });
  return affected;
}

function removeNodesByType(graph: GraphInstance, type: string): string[] {
  const affected: string[] = [];
  graph.forEachNode((nodeId: string, attrs: any) => {
    if ((attrs as InfraNodeAttrs).type === type) {
      affected.push(nodeId);
    }
  });
  return affected;
}

function removeNodesByTypeOrTag(
  graph: GraphInstance,
  targetType: string,
  targetTag?: string
): string[] {
  const affected: string[] = [];
  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    const typeMatch = a.type === targetType;
    const tagMatch = targetTag
      ? Object.values(a.tags || {}).some(v => v === targetTag)
      : true;
    if (typeMatch && tagMatch) {
      affected.push(nodeId);
    }
  });
  return affected;
}

function removeEdgesBetween(graph: GraphInstance, vpcA: string, vpcB: string): string[] {
  // Find nodes in each VPC and remove cross-edges
  const nodesA = new Set<string>();
  const nodesB = new Set<string>();

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    const vpc = (a.metadata?.vpcId as string) || '';
    if (vpc === vpcA || nodeId === vpcA) nodesA.add(nodeId);
    if (vpc === vpcB || nodeId === vpcB) nodesB.add(nodeId);
  });

  // Remove edges between the two groups — return affected nodes on the "cut" boundary
  const affected: string[] = [];
  const edgesToRemove: string[] = [];

  graph.forEachEdge((edgeKey: string, _attrs: any, source: string, target: string) => {
    if ((nodesA.has(source) && nodesB.has(target)) ||
      (nodesB.has(source) && nodesA.has(target))) {
      edgesToRemove.push(edgeKey);
      affected.push(target);
    }
  });

  for (const edgeKey of edgesToRemove) {
    if (graph.hasEdge(edgeKey)) {
      graph.dropEdge(edgeKey);
    }
  }

  return [...new Set(affected)];
}

// =====================================================
//  BUSINESS IMPACT
// =====================================================

function identifyBusinessImpact(
  graph: GraphInstance,
  affectedNodeIds: string[],
  cascade: CascadeNode[]
): SimulationBusinessImpact[] {
  const allAffected = new Set([
    ...affectedNodeIds,
    ...cascade.map(c => c.id),
  ]);

  const businessTypes = new Set([
    NodeType.APPLICATION,
    NodeType.MICROSERVICE,
    NodeType.API_GATEWAY,
    NodeType.LOAD_BALANCER,
    NodeType.SERVERLESS,
  ]);

  const impacts: SimulationBusinessImpact[] = [];

  for (const nodeId of allAffected) {
    if (!graph.hasNode(nodeId)) continue;
    const attrs = graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
    if (!businessTypes.has(attrs.type as NodeType)) continue;

    const isDirectlyAffected = affectedNodeIds.includes(nodeId);
    const cascadeInfo = cascade.find(c => c.id === nodeId);

    let impact: 'total_outage' | 'degraded' | 'partial';
    if (isDirectlyAffected || cascadeInfo?.status === 'down') {
      impact = 'total_outage';
    } else if (cascadeInfo?.status === 'degraded') {
      impact = 'degraded';
    } else {
      impact = 'partial';
    }

    // Estimate RTO based on type
    let estimatedRTO: number;
    if (attrs.validatedRTO) {
      estimatedRTO = attrs.validatedRTO;
    } else if (attrs.suggestedRTO) {
      estimatedRTO = attrs.suggestedRTO;
    } else {
      estimatedRTO = impact === 'total_outage' ? 120 : 30;
    }

    impacts.push({
      serviceId: nodeId,
      serviceName: attrs.name,
      impact,
      estimatedRTO,
      estimatedRPO: attrs.validatedRPO || attrs.suggestedRPO || 60,
      financialImpactPerHour: attrs.financialImpactPerHour || 200,
    });
  }

  return impacts.sort((a, b) => {
    const impactOrder = { total_outage: 0, degraded: 1, partial: 2 };
    return impactOrder[a.impact] - impactOrder[b.impact];
  });
}

// =====================================================
//  RECOMMENDATIONS
// =====================================================

function generateRecommendations(
  scenario: SimulationScenario,
  affectedNodes: Array<{ id: string; name: string; type: string }>,
  cascade: CascadeNode[]
): SimulationRecommendation[] {
  const recs: SimulationRecommendation[] = [];

  // Region loss → multi-region
  if (scenario.scenarioType === 'region_loss') {
    recs.push({
      title: 'Deploy critical services in multiple regions',
      description: `${affectedNodes.length} nodes are in a single region. Deploy active-passive or active-active across 2+ regions.`,
      priority: 'strategic',
      effort: 'high',
      estimatedRiskReduction: 40,
    });
  }

  // Database failure → replication
  if (scenario.scenarioType === 'database_failure') {
    recs.push({
      title: 'Enable database replication and automated failover',
      description: 'Configure read replicas with automated failover to minimize downtime.',
      priority: 'immediate',
      effort: 'medium',
      estimatedRiskReduction: 30,
    });
  }

  // High cascade depth → circuit breakers
  const maxDepth = cascade.length > 0 ? Math.max(...cascade.map(c => c.cascadeDepth)) : 0;
  if (maxDepth > 3) {
    recs.push({
      title: 'Implement circuit breakers to limit cascade failures',
      description: `Cascade reached depth ${maxDepth}. Add circuit breakers between service layers to contain failures.`,
      priority: 'planned',
      effort: 'medium',
      estimatedRiskReduction: 25,
    });
  }

  // Many nodes affected → improve monitoring
  if (affectedNodes.length + cascade.length > 10) {
    recs.push({
      title: 'Enhance monitoring and alerting',
      description: 'Set up automated health checks and alerting for early detection of cascading failures.',
      priority: 'planned',
      effort: 'low',
      estimatedRiskReduction: 15,
    });
  }

  // DNS failure → redundant DNS
  if (scenario.scenarioType === 'dns_failure') {
    recs.push({
      title: 'Configure redundant DNS with secondary provider',
      description: 'Use a secondary DNS provider as failover to prevent DNS-related outages.',
      priority: 'immediate',
      effort: 'low',
      estimatedRiskReduction: 35,
    });
  }

  // Third party → fallback
  if (scenario.scenarioType === 'third_party_outage') {
    recs.push({
      title: 'Implement fallback mechanisms for external dependencies',
      description: 'Add circuit breakers, caching, and degraded mode for third-party service dependencies.',
      priority: 'planned',
      effort: 'medium',
      estimatedRiskReduction: 20,
    });
  }

  // Generic: always recommend documented runbook
  recs.push({
    title: 'Create and test recovery runbook for this scenario',
    description: 'Document step-by-step recovery procedures and validate them through tabletop exercises.',
    priority: 'planned',
    effort: 'low',
    estimatedRiskReduction: 10,
  });

  return recs;
}

// =====================================================
//  POST-INCIDENT SCORE
// =====================================================

function calculatePostIncidentScore(
  totalAffected: number,
  totalNodes: number,
  cascade: CascadeNode[]
): number {
  if (totalNodes === 0) return 100;

  const percentAffected = totalAffected / totalNodes;
  const cascadeDepth = cascade.length > 0 ? Math.max(...cascade.map(c => c.cascadeDepth)) : 0;

  let score = 100;
  score -= Math.round(percentAffected * 60);
  score -= Math.min(20, cascadeDepth * 5);
  score -= Math.min(20, cascade.filter(c => c.status === 'down').length * 2);

  return Math.max(0, Math.min(100, score));
}

// =====================================================
//  DYNAMIC OPTIONS FOR TEMPLATES
// =====================================================

export function getScenarioOptions(graph: GraphInstance): Record<string, string[]> {
  const regions = new Set<string>();
  const azs = new Set<string>();
  const databases: string[] = [];
  const vpcs: string[] = [];
  const thirdParty: string[] = [];
  const allNodes: string[] = [];

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    allNodes.push(nodeId);
    if (a.region) regions.add(a.region);
    if (a.availabilityZone) azs.add(a.availabilityZone);
    if (a.type === NodeType.DATABASE) databases.push(nodeId);
    if (a.type === NodeType.VPC) vpcs.push(nodeId);
    if (a.type === NodeType.THIRD_PARTY_API || a.type === NodeType.SAAS_SERVICE) {
      thirdParty.push(nodeId);
    }
  });

  return {
    regions: Array.from(regions),
    azs: Array.from(azs),
    databases,
    vpcs,
    thirdParty,
    allNodes,
  };
}

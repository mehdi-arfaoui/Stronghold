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
import { buildSimulationPropagation } from './simulationPropagation.js';

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
  const fallbackCascade = calculateCascade(simGraph, affectedNodeIds);

  // 4. Identify impacted business services
  const preliminaryBusinessImpact = identifyBusinessImpact(simGraph, affectedNodeIds, fallbackCascade);

  const propagation = buildSimulationPropagation({
    graph: simGraph,
    initialFailureNodeIds: affectedNodeIds,
    businessImpact: preliminaryBusinessImpact,
    scenarioType: scenario.scenarioType,
  });
  const cascade = propagation.cascadeNodes.length > 0 ? propagation.cascadeNodes : fallbackCascade;
  const businessImpact = identifyBusinessImpact(simGraph, affectedNodeIds, cascade);

  // 5. Calculate metrics
  const totalAffected = affectedNodeIds.length + cascade.length;
  const totalNodes = graph.order;
  const percentageAffected = totalNodes > 0 ? (totalAffected / totalNodes) * 100 : 0;

  const totalOutageCount = cascade.filter(c => c.status === 'down').length + affectedNodeIds.length;
  const degradedCount = cascade.filter(c => c.status === 'degraded').length;

  // Estimate downtime based on worst-case RTO
  const maxRTO = businessImpact.length > 0
    ? Math.max(...businessImpact.map(s => s.estimatedRTO))
    : 60;

  // Scenario total cost = sum(impacted nodes hourly cost) x estimated downtime (hours).
  // This follows the financial model shown in Simulation/War Room.
  const impactedNodeIdsForCost = new Set<string>([
    ...affectedNodeIds,
    ...cascade.map((node) => node.id),
  ]);
  const hourlyLoss = Array.from(impactedNodeIdsForCost).reduce((sum, nodeId) => {
    if (!simGraph.hasNode(nodeId)) return sum;
    const attrs = simGraph.getNodeAttributes(nodeId) as InfraNodeAttrs;
    const nodeHourlyCost = Number(attrs.financialImpactPerHour);
    return sum + (Number.isFinite(nodeHourlyCost) && nodeHourlyCost > 0 ? nodeHourlyCost : 200);
  }, 0);
  const estimatedDowntimeHours = Math.max(maxRTO / 60, 1);
  const financialLoss = Math.round(hourlyLoss * estimatedDowntimeHours);

  // 6. Build blast-radius/war-room data and recommendations
  const blastRadiusMetrics = buildBlastRadiusMetrics(totalAffected, totalNodes, businessImpact, maxRTO, cascade);
  const warRoomData = buildWarRoomData(
    affectedNodes,
    cascade,
    businessImpact,
    propagation.propagationTimeline,
    propagation.impactedNodes,
  );
  const recommendations = generateRecommendations(graph, affectedNodes, cascade, businessImpact, maxRTO);

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
    blastRadiusMetrics,
    recommendations,
    warRoomData,
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
      return removeNodesForRansomware(
        graph,
        params.targetType as string | undefined,
        params.targetTypes as unknown,
        params.targetTag as string | undefined,
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

function normalizeRansomwareTargetTypes(
  targetType: string | undefined,
  targetTypes: unknown,
): string[] {
  const normalized = new Set<string>();

  if (typeof targetType === 'string' && targetType.trim().length > 0) {
    normalized.add(targetType.trim().toUpperCase());
  }

  if (Array.isArray(targetTypes)) {
    for (const entry of targetTypes) {
      if (typeof entry !== 'string') continue;
      const value = entry.trim().toUpperCase();
      if (value.length > 0) {
        normalized.add(value);
      }
    }
  }

  if (normalized.size > 0) {
    return Array.from(normalized);
  }

  return ['DATABASE', 'OBJECT_STORAGE', 'FILE_STORAGE', 'VM'];
}

function removeNodesForRansomware(
  graph: GraphInstance,
  targetType: string | undefined,
  targetTypes: unknown,
  targetTag?: string,
): string[] {
  const initialTargets = normalizeRansomwareTargetTypes(targetType, targetTypes);
  const impacted = removeNodesByTypesOrTag(graph, initialTargets, targetTag);
  if (impacted.length > 0) return impacted;

  // Fallback: if no explicit match, target the main data-bearing components.
  const fallbackTargets = ['DATABASE', 'OBJECT_STORAGE', 'FILE_STORAGE', 'VM', 'APPLICATION', 'MICROSERVICE'];
  return removeNodesByTypesOrTag(graph, fallbackTargets);
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

function removeNodesByTypesOrTag(
  graph: GraphInstance,
  targetTypes: string[],
  targetTag?: string
): string[] {
  const affected: string[] = [];
  const normalizedTypes = new Set(
    targetTypes
      .map((entry) => String(entry || '').trim().toUpperCase())
      .filter((entry) => entry.length > 0),
  );
  if (normalizedTypes.size === 0) {
    return affected;
  }

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    const typeMatch = normalizedTypes.has(String(a.type || '').toUpperCase());
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
  graph: GraphInstance,
  affectedNodes: Array<{ id: string; name: string; type: string }>,
  cascade: CascadeNode[],
  businessImpact: SimulationBusinessImpact[],
  estimatedDowntimeMinutes: number
): SimulationRecommendation[] {
  const recs: SimulationRecommendation[] = [];
  const seen = new Set<string>();
  const impactedNodeIds = [...affectedNodes.map((n) => n.id), ...cascade.map((n) => n.id)];

  const pushRec = (rec: Omit<SimulationRecommendation, 'id'>) => {
    const key = `${rec.priority}:${rec.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    recs.push({ id: randomUUID(), ...rec });
  };

  const impactedSpofs = affectedNodes.filter((node) => {
    if (!graph.hasNode(node.id)) return false;
    const attrs = graph.getNodeAttributes(node.id) as InfraNodeAttrs;
    return Boolean(attrs.isSPOF);
  });

  for (const spofNode of impactedSpofs) {
    pushRec({
      priority: 'P0',
      title: `Ajouter redondance pour ${spofNode.name}`,
      description: `${spofNode.name} est marque comme SPOF et se trouve dans la zone d'impact de la simulation.`,
      action: `Deployer une instance secondaire et valider le basculement pour ${spofNode.name}.`,
      estimatedRto: 30,
      affectedNodes: [spofNode.id],
      category: 'redundancy',
      effort: 'medium',
      normativeReference: 'ISO 22301 A.8.4',
    });
  }

  const impactedSet = new Set(impactedNodeIds);
  graph.forEachNode((nodeId: string, attrs: any) => {
    if (!impactedSet.has(nodeId)) return;
    const a = attrs as InfraNodeAttrs;
    const inBackupScope = a.type === NodeType.DATABASE || a.type === NodeType.OBJECT_STORAGE;
    const hasBackup =
      Boolean(a.tags?.backup) ||
      Boolean(a.tags?.snapshot) ||
      Boolean((a.metadata as Record<string, unknown> | undefined)?.backupEnabled);

    if (inBackupScope && !hasBackup) {
      pushRec({
        priority: 'P1',
        title: `Backup cross-region pour ${a.name}`,
        description: `${a.name} n'a pas de backup detecte alors qu'il est impacte par le scenario.`,
        action: `Activer snapshots chiffrés cross-region pour ${a.name} et tester la restauration.`,
        estimatedRto: 90,
        affectedNodes: [nodeId],
        category: 'backup',
        effort: 'medium',
        normativeReference: 'ISO 27001 A.12.3',
      });
    }
  });

  const maxDepth = cascade.length > 0 ? Math.max(...cascade.map((c) => c.cascadeDepth)) : 0;
  if (maxDepth > 3) {
    pushRec({
      priority: 'P1',
      title: 'Reduire la chaine de dependances',
      description: `La propagation atteint une profondeur de ${maxDepth} niveaux sans protection suffisante.`,
      action: 'Introduire des ruptures de chaines (bulkheads/circuit breakers) et de la redondance sur les niveaux intermediaires.',
      estimatedRto: Math.max(estimatedDowntimeMinutes - 20, 30),
      affectedNodes: cascade.filter((n) => n.cascadeDepth >= 3).map((n) => n.id),
      category: 'isolation',
      effort: 'high',
      normativeReference: 'NIST SP 800-34 Rev.1',
    });
  }

  const breachedServices = businessImpact.filter((service) => {
    if (!graph.hasNode(service.serviceId)) return false;
    const attrs = graph.getNodeAttributes(service.serviceId) as InfraNodeAttrs;
    const mtpd = attrs.validatedMTPD ?? attrs.suggestedMTPD;
    return typeof mtpd === 'number' && service.estimatedRTO > mtpd;
  });

  if (breachedServices.length > 0) {
    pushRec({
      priority: 'P0',
      title: 'Plan de reprise insuffisant',
      description: `${breachedServices.length} service(s) critiques ont un RTO superieur au MTPD.`,
      action: 'Mettre a jour le runbook de reprise avec objectifs RTO/MTPD alignes et valider en exercice.',
      estimatedRto: Math.max(...breachedServices.map((s) => s.estimatedRTO)),
      affectedNodes: breachedServices.map((s) => s.serviceId),
      category: 'process',
      effort: 'medium',
      normativeReference: 'ISO 22301 8.4.4',
    });
  }

  if (recs.length === 0) {
    pushRec({
      priority: 'P2',
      title: 'Maintenir la posture de resilience',
      description: "Aucun risque majeur supplementaire n'a ete detecte pour ce scenario.",
      action: 'Continuer les tests de bascule trimestriels et la supervision proactive.',
      estimatedRto: estimatedDowntimeMinutes,
      affectedNodes: impactedNodeIds,
      category: 'monitoring',
      effort: 'low',
      normativeReference: 'ISO 22301 9.1',
    });
  }

  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  return recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

function buildBlastRadiusMetrics(
  totalAffected: number,
  totalNodes: number,
  businessImpact: SimulationBusinessImpact[],
  estimatedDowntimeMinutes: number,
  cascade: CascadeNode[]
): SimulationResult['blastRadiusMetrics'] {
  const impactPercentage = totalNodes > 0 ? Math.round((totalAffected / totalNodes) * 1000) / 10 : 0;
  const criticalServicesImpacted = businessImpact.filter((service) => service.impact === 'total_outage').length;
  const propagationDepth = cascade.length > 0 ? Math.max(...cascade.map((node) => node.cascadeDepth)) : 0;

  let recoveryComplexity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (impactPercentage >= 60 || propagationDepth >= 6) recoveryComplexity = 'critical';
  else if (impactPercentage >= 35 || propagationDepth >= 4) recoveryComplexity = 'high';
  else if (impactPercentage >= 15 || propagationDepth >= 2) recoveryComplexity = 'medium';

  return {
    totalNodesImpacted: totalAffected,
    totalNodesInGraph: totalNodes,
    impactPercentage,
    criticalServicesImpacted,
    estimatedDowntimeMinutes,
    propagationDepth,
    recoveryComplexity,
  };
}

function buildWarRoomData(
  affectedNodes: Array<{ id: string; name: string; type: string }>,
  cascade: CascadeNode[],
  businessImpact: SimulationBusinessImpact[],
  propagationTimeline: SimulationResult['warRoomData']['propagationTimeline'],
  impactedNodesFromPropagation: SimulationResult['warRoomData']['impactedNodes'],
): SimulationResult['warRoomData'] {
  const impactedNodes = impactedNodesFromPropagation.length > 0
    ? impactedNodesFromPropagation
    : [
        ...affectedNodes.map((node) => ({
          id: node.id,
          name: node.name,
          type: node.type,
          status: 'down' as const,
          impactedAt: 0,
          impactedAtSeconds: 0,
          estimatedRecovery: 60,
        })),
        ...cascade.map((node) => ({
          id: node.id,
          name: node.name,
          type: node.type,
          status: node.status,
          impactedAt: node.cascadeDepth,
          impactedAtSeconds: node.cascadeDepth * 60,
          estimatedRecovery: node.status === 'down' ? 120 : 45,
        })),
      ];

  const remediationActions: NonNullable<SimulationResult['warRoomData']>['remediationActions'] = businessImpact.slice(0, 5).map((service, index) => ({
    id: randomUUID(),
    title: `Restaurer ${service.serviceName}`,
    status: index === 0 ? 'in_progress' as const : 'pending' as const,
    priority: service.impact === 'total_outage' ? 'P0' as const : 'P1' as const,
  }));

  if (remediationActions.length === 0) {
    remediationActions.push({
      id: randomUUID(),
      title: 'Valider les canaux de communication de crise',
      status: 'pending',
      priority: 'P2',
    });
  }

  return {
    propagationTimeline,
    impactedNodes,
    remediationActions,
  };
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

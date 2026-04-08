/**
 * Graph scenario engine — runs what-if disruption scenarios on the infrastructure graph.
 * Orchestrates scenario selection, cascade propagation, business impact,
 * recommendations, and war room data generation.
 */

import { randomUUID } from 'crypto';
import type {
  InfraNodeAttrs,
  SimulationScenario,
  SimulationResult,
  SimulationBusinessImpact,
  SimulationRecommendation,
  CascadeNode,
} from '../types/index.js';
import { NodeType } from '../types/index.js';
import type { GraphInstance } from './graph-instance.js';
import { cloneGraph, calculateCascade } from './graph-utils.js';
import { buildSimulationPropagation } from './graph-scenario-propagation.js';
import { applyScenario } from './graph-scenario-selection.js';

export function runSimulation(
  graph: GraphInstance,
  scenario: SimulationScenario,
): SimulationResult {
  const simGraph = cloneGraph(graph);
  const affectedNodeIds = applyScenario(simGraph, scenario) || [];
  const affectedNodes = affectedNodeIds
    .filter((id) => simGraph.hasNode(id))
    .map((id) => {
      const attrs = simGraph.getNodeAttributes(id) as unknown as InfraNodeAttrs;
      return { id, name: attrs.name, type: attrs.type, status: 'down' };
    });

  const fallbackCascade = calculateCascade(simGraph, affectedNodeIds);
  const prelimBiz = identifyBusinessImpact(simGraph, affectedNodeIds, fallbackCascade);
  const propagation = buildSimulationPropagation({
    graph: simGraph,
    initialFailureNodeIds: affectedNodeIds,
    businessImpact: prelimBiz,
    scenarioType: scenario.scenarioType,
  });
  const cascade = propagation.cascadeNodes.length > 0 ? propagation.cascadeNodes : fallbackCascade;
  const businessImpact = identifyBusinessImpact(simGraph, affectedNodeIds, cascade);

  const totalAffected = affectedNodeIds.length + cascade.length;
  const totalNodes = graph.order;
  const pct = totalNodes > 0 ? (totalAffected / totalNodes) * 100 : 0;
  const totalOutage = cascade.filter((c) => c.status === 'down').length + affectedNodeIds.length;
  const degradedCount = cascade.filter((c) => c.status === 'degraded').length;
  const maxRTO =
    businessImpact.length > 0 ? Math.max(...businessImpact.map((s) => s.estimatedRTO)) : 60;

  const costIds = new Set([...affectedNodeIds, ...cascade.map((n) => n.id)]);
  const hourlyLoss = Array.from(costIds).reduce((sum, nodeId) => {
    if (!simGraph.hasNode(nodeId)) return sum;
    const a = simGraph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
    const cost = Number(a.financialImpactPerHour);
    return sum + (Number.isFinite(cost) && cost > 0 ? cost : 200);
  }, 0);
  const financialLoss = Math.round(hourlyLoss * Math.max(maxRTO / 60, 1));

  const blastRadiusMetrics = buildBlastRadiusMetrics(
    totalAffected,
    totalNodes,
    businessImpact,
    maxRTO,
    cascade,
  );
  const warRoomData = buildWarRoomData(
    affectedNodes,
    cascade,
    businessImpact,
    propagation.propagationTimeline,
    propagation.impactedNodes,
  );
  const recommendations = generateRecommendations(
    graph,
    affectedNodes,
    cascade,
    businessImpact,
    maxRTO,
  );

  return {
    id: randomUUID(),
    scenario,
    executedAt: new Date(),
    directlyAffected: affectedNodes,
    cascadeImpacted: cascade,
    businessImpact,
    metrics: {
      totalNodesAffected: totalAffected,
      percentageInfraAffected: Math.round(pct * 10) / 10,
      estimatedDowntimeMinutes: maxRTO,
      estimatedFinancialLoss: financialLoss,
      servicesWithTotalOutage: totalOutage,
      servicesWithDegradation: degradedCount,
    },
    blastRadiusMetrics,
    recommendations,
    warRoomData,
    postIncidentResilienceScore: calculatePostIncidentScore(totalAffected, totalNodes, cascade),
  };
}

export const analyzeGraphScenario = runSimulation;

function identifyBusinessImpact(
  graph: GraphInstance,
  affectedNodeIds: string[],
  cascade: CascadeNode[],
): SimulationBusinessImpact[] {
  const allAffected = new Set([...affectedNodeIds, ...cascade.map((c) => c.id)]);
  const bizTypes = new Set([
    NodeType.APPLICATION,
    NodeType.MICROSERVICE,
    NodeType.API_GATEWAY,
    NodeType.LOAD_BALANCER,
    NodeType.SERVERLESS,
  ]);
  const impacts: SimulationBusinessImpact[] = [];
  for (const nodeId of allAffected) {
    if (!graph.hasNode(nodeId)) continue;
    const attrs = graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
    if (!bizTypes.has(attrs.type as NodeType)) continue;
    const isDirect = affectedNodeIds.includes(nodeId);
    const ci = cascade.find((c) => c.id === nodeId);
    const impact: 'total_outage' | 'degraded' | 'partial' =
      isDirect || ci?.status === 'down'
        ? 'total_outage'
        : ci?.status === 'degraded'
          ? 'degraded'
          : 'partial';
    const estimatedRTO =
      attrs.validatedRTO ?? attrs.suggestedRTO ?? (impact === 'total_outage' ? 120 : 30);
    impacts.push({
      serviceId: nodeId,
      serviceName: attrs.name,
      impact,
      estimatedRTO,
      estimatedRPO: attrs.validatedRPO ?? attrs.suggestedRPO ?? 60,
      financialImpactPerHour: attrs.financialImpactPerHour ?? 200,
    });
  }
  const order = { total_outage: 0, degraded: 1, partial: 2 };
  return impacts.sort((a, b) => order[a.impact] - order[b.impact]);
}

function buildBlastRadiusMetrics(
  totalAffected: number,
  totalNodes: number,
  businessImpact: SimulationBusinessImpact[],
  maxRTO: number,
  cascade: CascadeNode[],
): SimulationResult['blastRadiusMetrics'] {
  const pct = totalNodes > 0 ? Math.round((totalAffected / totalNodes) * 1000) / 10 : 0;
  const critCount = businessImpact.filter((s) => s.impact === 'total_outage').length;
  const depth = cascade.length > 0 ? Math.max(...cascade.map((n) => n.cascadeDepth)) : 0;
  let complexity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (pct >= 60 || depth >= 6) complexity = 'critical';
  else if (pct >= 35 || depth >= 4) complexity = 'high';
  else if (pct >= 15 || depth >= 2) complexity = 'medium';
  return {
    totalNodesImpacted: totalAffected,
    totalNodesInGraph: totalNodes,
    impactPercentage: pct,
    criticalServicesImpacted: critCount,
    estimatedDowntimeMinutes: maxRTO,
    propagationDepth: depth,
    recoveryComplexity: complexity,
  };
}

function buildWarRoomData(
  affectedNodes: Array<{ id: string; name: string; type: string }>,
  cascade: CascadeNode[],
  businessImpact: SimulationBusinessImpact[],
  propagationTimeline: SimulationResult['warRoomData']['propagationTimeline'],
  impactedNodesFromProp: SimulationResult['warRoomData']['impactedNodes'],
): SimulationResult['warRoomData'] {
  const impactedNodes =
    impactedNodesFromProp.length > 0
      ? impactedNodesFromProp
      : [
          ...affectedNodes.map((n) => ({
            id: n.id,
            name: n.name,
            type: n.type,
            status: 'down' as const,
            impactedAt: 0,
            impactedAtSeconds: 0,
            estimatedRecovery: 60,
          })),
          ...cascade.map((n) => ({
            id: n.id,
            name: n.name,
            type: n.type,
            status: n.status,
            impactedAt: n.cascadeDepth,
            impactedAtSeconds: n.cascadeDepth * 60,
            estimatedRecovery: n.status === 'down' ? 120 : 45,
          })),
        ];
  const actions = businessImpact.slice(0, 5).map((s, i) => ({
    id: randomUUID(),
    title: `Restaurer ${s.serviceName}`,
    status: (i === 0 ? 'in_progress' : 'pending') as 'in_progress' | 'pending',
    priority: (s.impact === 'total_outage' ? 'P0' : 'P1') as 'P0' | 'P1',
  }));
  const remediationActions =
    actions.length > 0
      ? actions
      : [
          {
            id: randomUUID(),
            title: 'Valider les canaux de communication de crise',
            status: 'pending' as const,
            priority: 'P2' as const,
          },
        ];
  return { propagationTimeline, impactedNodes, remediationActions };
}

function generateRecommendations(
  graph: GraphInstance,
  affectedNodes: Array<{ id: string; name: string; type: string }>,
  cascade: CascadeNode[],
  businessImpact: SimulationBusinessImpact[],
  maxRTO: number,
): SimulationRecommendation[] {
  const recs: SimulationRecommendation[] = [];
  const seen = new Set<string>();
  const push = (rec: Omit<SimulationRecommendation, 'id'>): void => {
    const key = `${rec.priority}:${rec.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    recs.push({ id: randomUUID(), ...rec });
  };
  const impactedIds = [...affectedNodes.map((n) => n.id), ...cascade.map((n) => n.id)];
  for (const node of affectedNodes) {
    if (!graph.hasNode(node.id)) continue;
    const a = graph.getNodeAttributes(node.id) as unknown as InfraNodeAttrs;
    if (a.isSPOF)
      push({
        priority: 'P0',
        title: `Ajouter redondance pour ${node.name}`,
        description: `${node.name} est marque comme SPOF et se trouve dans la zone d'impact du scenario.`,
        action: `Deployer une instance secondaire et valider le basculement pour ${node.name}.`,
        estimatedRto: 30,
        affectedNodes: [node.id],
        category: 'redundancy',
        effort: 'medium',
        normativeReference: 'ISO 22301 A.8.4',
      });
  }
  addBackupRecs(graph, impactedIds, push);
  addCascadeRec(cascade, maxRTO, push);
  addMtpdRec(graph, businessImpact, push);
  if (recs.length === 0)
    push({
      priority: 'P2',
      title: 'Maintenir la posture de resilience',
      description: "Aucun risque majeur supplementaire n'a ete detecte pour ce scenario.",
      action: 'Continuer les tests de bascule trimestriels et la supervision proactive.',
      estimatedRto: maxRTO,
      affectedNodes: impactedIds,
      category: 'monitoring',
      effort: 'low',
      normativeReference: 'ISO 22301 9.1',
    });
  const order = { P0: 0, P1: 1, P2: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}

function addBackupRecs(
  graph: GraphInstance,
  ids: string[],
  push: (r: Omit<SimulationRecommendation, 'id'>) => void,
): void {
  const impSet = new Set(ids);
  graph.forEachNode((nodeId, raw) => {
    if (!impSet.has(nodeId)) return;
    const a = raw as unknown as InfraNodeAttrs;
    const inScope = a.type === NodeType.DATABASE || a.type === NodeType.OBJECT_STORAGE;
    const hasBk =
      Boolean(a.tags?.backup) ||
      Boolean(a.tags?.snapshot) ||
      Boolean((a.metadata as Record<string, unknown> | undefined)?.backupEnabled);
    if (inScope && !hasBk)
      push({
        priority: 'P1',
        title: `Backup cross-region pour ${a.name}`,
        description: `${a.name} n'a pas de backup detecte alors qu'il est impacte par le scenario.`,
        action: `Activer snapshots chiffres cross-region pour ${a.name} et tester la restauration.`,
        estimatedRto: 90,
        affectedNodes: [nodeId],
        category: 'backup',
        effort: 'medium',
        normativeReference: 'ISO 27001 A.12.3',
      });
  });
}

function addCascadeRec(
  cascade: CascadeNode[],
  maxRTO: number,
  push: (r: Omit<SimulationRecommendation, 'id'>) => void,
): void {
  const depth = cascade.length > 0 ? Math.max(...cascade.map((c) => c.cascadeDepth)) : 0;
  if (depth <= 3) return;
  push({
    priority: 'P1',
    title: 'Reduire la chaine de dependances',
    description: `La propagation atteint une profondeur de ${depth} niveaux sans protection suffisante.`,
    action:
      'Introduire des ruptures de chaines (bulkheads/circuit breakers) et de la redondance sur les niveaux intermediaires.',
    estimatedRto: Math.max(maxRTO - 20, 30),
    affectedNodes: cascade.filter((n) => n.cascadeDepth >= 3).map((n) => n.id),
    category: 'isolation',
    effort: 'high',
    normativeReference: 'NIST SP 800-34 Rev.1',
  });
}

function addMtpdRec(
  graph: GraphInstance,
  biz: SimulationBusinessImpact[],
  push: (r: Omit<SimulationRecommendation, 'id'>) => void,
): void {
  const breached = biz.filter((s) => {
    if (!graph.hasNode(s.serviceId)) return false;
    const a = graph.getNodeAttributes(s.serviceId) as unknown as InfraNodeAttrs;
    const mtpd = a.validatedMTPD ?? a.suggestedMTPD;
    return typeof mtpd === 'number' && s.estimatedRTO > mtpd;
  });
  if (breached.length === 0) return;
  push({
    priority: 'P0',
    title: 'Plan de reprise insuffisant',
    description: `${breached.length} service(s) critiques ont un RTO superieur au MTPD.`,
    action:
      'Mettre a jour le runbook de reprise avec objectifs RTO/MTPD alignes et valider en exercice.',
    estimatedRto: Math.max(...breached.map((s) => s.estimatedRTO)),
    affectedNodes: breached.map((s) => s.serviceId),
    category: 'process',
    effort: 'medium',
    normativeReference: 'ISO 22301 8.4.4',
  });
}

function calculatePostIncidentScore(
  totalAffected: number,
  totalNodes: number,
  cascade: CascadeNode[],
): number {
  if (totalNodes === 0) return 100;
  let score = 100;
  score -= Math.round((totalAffected / totalNodes) * 60);
  const depth = cascade.length > 0 ? Math.max(...cascade.map((c) => c.cascadeDepth)) : 0;
  score -= Math.min(20, depth * 5);
  score -= Math.min(20, cascade.filter((c) => c.status === 'down').length * 2);
  return Math.max(0, Math.min(100, score));
}

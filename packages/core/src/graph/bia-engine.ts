/**
 * BIA Engine — auto-generates Business Impact Analysis from
 * graph structure and analysis report.
 */

import type {
  InfraNodeAttrs,
  GraphAnalysisReport,
  BIAMetrics,
  BIAProcessResult,
  BIAReportResult,
  WeakPoint,
  FinancialImpact,
} from '../types/index.js';
import { NodeType } from '../types/index.js';
import type { GraphInstance } from './graph-instance.js';
import { getSubgraph } from './graph-utils.js';
import { isAnalyzableServiceNode } from './service-classification.js';

export type GenerateBiaOptions = {
  readonly preservedTierByServiceNodeId?: ReadonlyMap<string, number>;
};

export function generateBIA(
  graph: GraphInstance,
  _analysis: GraphAnalysisReport,
  options: GenerateBiaOptions = {},
): BIAReportResult {
  const businessServices = identifyBusinessServices(graph);
  const processes: BIAProcessResult[] = [];

  for (const service of businessServices) {
    const depChain = getSubgraph(graph, service.id, 10);
    const metrics = calculateMetrics(service, depChain);
    const classifiedTier = extractClassifiedTier(service, options);
    const financialImpact = estimateFinancialImpact(service);
    const weakPoints = identifyWeakPoints(depChain);

    processes.push({
      serviceNodeId: service.id,
      serviceName: service.name,
      serviceType: service.type,
      suggestedMAO: metrics.mao,
      suggestedMTPD: metrics.mtpd,
      suggestedRTO: metrics.rto,
      suggestedRPO: metrics.rpo,
      suggestedMBCO: metrics.mbco,
      impactCategory:
        classifiedTier != null ? impactCategoryFromTier(classifiedTier) : metrics.category,
      criticalityScore: service.criticalityScore || 0,
      recoveryTier: classifiedTier ?? 0,
      dependencyChain: depChain.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        isSPOF: n.isSPOF || false,
      })),
      weakPoints,
      financialImpact,
      validationStatus: 'pending',
    });
  }

  processes.sort((a, b) => b.criticalityScore - a.criticalityScore);
  const tiered = assignRecoveryTiers(processes);

  return {
    generatedAt: new Date(),
    processes: tiered,
    summary: {
      totalProcesses: tiered.length,
      tier1Count: tiered.filter((p) => p.recoveryTier === 1).length,
      tier2Count: tiered.filter((p) => p.recoveryTier === 2).length,
      tier3Count: tiered.filter((p) => p.recoveryTier === 3).length,
      tier4Count: tiered.filter((p) => p.recoveryTier === 4).length,
      totalEstimatedImpact: tiered.reduce((s, p) => s + p.financialImpact.estimatedCostPerHour, 0),
    },
  };
}

function identifyBusinessServices(graph: GraphInstance): InfraNodeAttrs[] {
  const services: InfraNodeAttrs[] = [];
  graph.forEachNode((_nodeId, rawAttrs) => {
    const a = rawAttrs as unknown as InfraNodeAttrs;
    if (isAnalyzableServiceNode(a)) services.push(a);
  });
  return services;
}

function readMetadataRecord(node: InfraNodeAttrs): Record<string, unknown> {
  if (!node.metadata || typeof node.metadata !== 'object' || Array.isArray(node.metadata))
    return {};
  return node.metadata as Record<string, unknown>;
}

function normalizeTierValue(rawTier: unknown): number | null {
  if (typeof rawTier === 'number' && Number.isFinite(rawTier)) {
    const rounded = Math.round(rawTier);
    return rounded >= 1 && rounded <= 4 ? rounded : null;
  }
  if (typeof rawTier !== 'string') return null;
  const trimmed = rawTier.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) {
    const rounded = Math.round(direct);
    return rounded >= 1 && rounded <= 4 ? rounded : null;
  }
  const tierMatch = trimmed.match(/(?:tier|t)\s*[-_ ]?([1-4])/i);
  if (tierMatch?.[1]) {
    const parsed = Number(tierMatch[1]);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 4) return parsed;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === 'critical') return 1;
  if (normalized === 'high') return 2;
  if (normalized === 'medium') return 3;
  if (normalized === 'low') return 4;
  return null;
}

function extractClassifiedTier(node: InfraNodeAttrs, options: GenerateBiaOptions): number | null {
  const metadata = readMetadataRecord(node);
  const rawClassification =
    metadata.criticalityClassification &&
    typeof metadata.criticalityClassification === 'object' &&
    !Array.isArray(metadata.criticalityClassification)
      ? (metadata.criticalityClassification as Record<string, unknown>)
      : null;
  const metaTier = normalizeTierValue(
    metadata.recoveryTier ?? metadata.criticalityTier ?? metadata.tier,
  );
  if (metaTier != null) return metaTier;
  const preserved = normalizeTierValue(options.preservedTierByServiceNodeId?.get(node.id));
  if (preserved != null) return preserved;
  return normalizeTierValue(rawClassification?.tier);
}

function impactCategoryFromTier(tier: number): BIAMetrics['category'] {
  if (tier <= 1) return 'critical';
  if (tier === 2) return 'high';
  if (tier === 3) return 'medium';
  return 'low';
}

function calculateMetrics(
  service: InfraNodeAttrs,
  depChain: { nodes: InfraNodeAttrs[] },
): BIAMetrics {
  let baseRTO = computeBaseRTO(service, depChain);
  baseRTO += depChain.nodes.filter((n) => n.isSPOF).length * 10;
  baseRTO += depChain.nodes.filter((n) => (n.redundancyScore || 100) < 30).length * 5;
  const rpo = computeRPO(service, depChain);
  const category = categorize(baseRTO);
  const mtpd = mtpdFromCategory(category);
  return { rto: baseRTO, rpo, mtpd, mao: mtpd + 60, mbco: 50, category };
}

function computeBaseRTO(service: InfraNodeAttrs, depChain: { nodes: InfraNodeAttrs[] }): number {
  switch (service.type) {
    case NodeType.DATABASE:
      return service.metadata?.isMultiAZ ? 20 : 60;
    case NodeType.APPLICATION:
    case NodeType.MICROSERVICE:
      return depChain.nodes.some((n) => n.type === NodeType.LOAD_BALANCER) ? 30 : 90;
    case NodeType.SERVERLESS:
      return 45;
    case NodeType.API_GATEWAY:
      return 15;
    case NodeType.LOAD_BALANCER:
      return 10;
    default:
      return 240;
  }
}

function computeRPO(service: InfraNodeAttrs, depChain: { nodes: InfraNodeAttrs[] }): number {
  const dbNodes = depChain.nodes.filter((n) => n.type === NodeType.DATABASE);
  if (dbNodes.length > 0)
    return dbNodes.some((n) => ((n.metadata?.replicaCount as number) || 0) > 0) ? 5 : 15;
  if (
    [NodeType.API_GATEWAY, NodeType.LOAD_BALANCER, NodeType.DNS].includes(service.type as NodeType)
  )
    return 60;
  if (service.type === NodeType.SERVERLESS || service.type === NodeType.MESSAGE_QUEUE) return 30;
  return 60;
}

function categorize(rto: number): 'critical' | 'high' | 'medium' | 'low' {
  if (rto <= 15) return 'critical';
  if (rto <= 60) return 'high';
  if (rto <= 240) return 'medium';
  return 'low';
}

function mtpdFromCategory(cat: string): number {
  if (cat === 'critical') return 240;
  if (cat === 'high') return 720;
  if (cat === 'medium') return 2_880;
  return 4_320;
}

function estimateFinancialImpact(service: InfraNodeAttrs): FinancialImpact {
  return {
    estimatedCostPerHour: 0,
    confidence: 'low',
    note: 'Business impact not estimated automatically. Configure a financial profile to compute downtime cost.',
    breakdown: {
      directDependents: service.dependentsCount || 0,
      serviceType: service.type,
      multiplier: 0,
    },
  };
}

function identifyWeakPoints(depChain: { nodes: InfraNodeAttrs[] }): WeakPoint[] {
  const weak: WeakPoint[] = [];
  for (const node of depChain.nodes) {
    if (node.isSPOF)
      weak.push({
        nodeId: node.id,
        nodeName: node.name,
        reason: 'Single Point of Failure',
        severity: 'critical',
      });
    if ((node.redundancyScore || 100) < 30)
      weak.push({
        nodeId: node.id,
        nodeName: node.name,
        reason: `Low redundancy score (${node.redundancyScore || 0}/100)`,
        severity: 'high',
      });
    if (node.type === NodeType.DATABASE && !node.metadata?.isMultiAZ)
      weak.push({
        nodeId: node.id,
        nodeName: node.name,
        reason: 'Database without Multi-AZ',
        severity: 'high',
      });
  }
  return weak;
}

function assignRecoveryTiers(processes: BIAProcessResult[]): BIAProcessResult[] {
  return processes.map((p) => ({
    ...p,
    recoveryTier:
      p.recoveryTier >= 1 && p.recoveryTier <= 4
        ? p.recoveryTier
        : p.suggestedRTO <= 60
          ? 1
          : p.suggestedRTO <= 240
            ? 2
            : p.suggestedRTO <= 1440
              ? 3
              : 4,
  }));
}

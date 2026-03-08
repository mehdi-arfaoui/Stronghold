// ============================================================
// BIAEngine — Auto-generate Business Impact Analysis from graph
// ============================================================

import type {
  InfraNodeAttrs,
  GraphAnalysisReport,
  BIAMetrics,
  BIAProcessResult,
  BIAReportResult,
  WeakPoint,
  FinancialImpact,
} from './types.js';
import { NodeType } from './types.js';
import type { GraphInstance } from './graphService.js';
import { getSubgraph } from './graphService.js';
import { isAnalyzableServiceNode } from './serviceClassification.js';

// =====================================================
//  MAIN BIA GENERATION
// =====================================================

export function generateBIA(
  graph: GraphInstance,
  analysis: GraphAnalysisReport,
  options: GenerateBiaOptions = {},
): BIAReportResult {
  // 1. Identify business services (front-facing nodes)
  const businessServices = identifyBusinessServices(graph);

  const processes: BIAProcessResult[] = [];

  for (const service of businessServices) {
    // 2. Get full dependency chain
    const depChain = getSubgraph(graph, service.id, 10);

    // 3. Calculate metrics
    const metrics = calculateMetrics(service, depChain, analysis);
    const classifiedTier = extractClassifiedTier(service, options);

    // 4. Financial impact
    const financialImpact = estimateFinancialImpact(service);

    // 5. Identify weak points
    const weakPoints = identifyWeakPoints(depChain, analysis);

    const process: BIAProcessResult = {
      serviceNodeId: service.id,
      serviceName: service.name,
      serviceType: service.type,
      suggestedMAO: metrics.mao,
      suggestedMTPD: metrics.mtpd,
      suggestedRTO: metrics.rto,
      suggestedRPO: metrics.rpo,
      suggestedMBCO: metrics.mbco,
      impactCategory: classifiedTier != null ? impactCategoryFromTier(classifiedTier) : metrics.category,
      criticalityScore: service.criticalityScore || 0,
      recoveryTier: classifiedTier ?? 0, // assigned below when classification is absent
      dependencyChain: depChain.nodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        isSPOF: n.isSPOF || false,
      })),
      weakPoints,
      financialImpact,
      validationStatus: 'pending',
    };

    processes.push(process);
  }

  // Sort by criticality
  processes.sort((a, b) => b.criticalityScore - a.criticalityScore);

  // Assign recovery tiers
  const tieredProcesses = assignRecoveryTiers(processes);

  const summary = {
    totalProcesses: tieredProcesses.length,
    tier1Count: tieredProcesses.filter(p => p.recoveryTier === 1).length,
    tier2Count: tieredProcesses.filter(p => p.recoveryTier === 2).length,
    tier3Count: tieredProcesses.filter(p => p.recoveryTier === 3).length,
    tier4Count: tieredProcesses.filter(p => p.recoveryTier === 4).length,
    totalEstimatedImpact: tieredProcesses.reduce(
      (sum, p) => sum + p.financialImpact.estimatedCostPerHour, 0
    ),
  };

  return {
    generatedAt: new Date(),
    processes: tieredProcesses,
    summary,
  };
}

// =====================================================
//  IDENTIFY BUSINESS SERVICES
// =====================================================

function identifyBusinessServices(graph: GraphInstance): InfraNodeAttrs[] {
  const services: InfraNodeAttrs[] = [];

  graph.forEachNode((_nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    if (isAnalyzableServiceNode(a)) {
      services.push(attrs as InfraNodeAttrs);
    }
  });

  return services;
}

function readMetadataRecord(node: InfraNodeAttrs): Record<string, unknown> {
  if (!node.metadata || typeof node.metadata !== 'object' || Array.isArray(node.metadata)) return {};
  return node.metadata as Record<string, unknown>;
}

export type GenerateBiaOptions = {
  preservedTierByServiceNodeId?: ReadonlyMap<string, number>;
};

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
  if (tierMatch) {
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

  const metadataTier = normalizeTierValue(
    metadata.recoveryTier ?? metadata.criticalityTier ?? metadata.tier,
  );
  if (metadataTier != null) return metadataTier;

  const preservedTier = normalizeTierValue(options.preservedTierByServiceNodeId?.get(node.id));
  if (preservedTier != null) return preservedTier;

  return normalizeTierValue(rawClassification?.tier);
}

function impactCategoryFromTier(tier: number): BIAMetrics['category'] {
  if (tier <= 1) return 'critical';
  if (tier === 2) return 'high';
  if (tier === 3) return 'medium';
  return 'low';
}

// =====================================================
//  CALCULATE METRICS
// =====================================================

function calculateMetrics(
  service: InfraNodeAttrs,
  depChain: { nodes: InfraNodeAttrs[]; edges: Array<{ source: string; target: string; type: string }> },
  analysis: GraphAnalysisReport
): BIAMetrics {
  // Base RTO by type
  let baseRTO: number;
  switch (service.type) {
    case NodeType.DATABASE:
      baseRTO = service.metadata?.isMultiAZ ? 20 : 60;
      break;
    case NodeType.APPLICATION:
    case NodeType.MICROSERVICE: {
      const hasLB = depChain.nodes.some(n => n.type === NodeType.LOAD_BALANCER);
      baseRTO = hasLB ? 30 : 90;
      break;
    }
    case NodeType.SERVERLESS:
      baseRTO = 45;
      break;
    case NodeType.API_GATEWAY:
      baseRTO = 15;
      break;
    case NodeType.LOAD_BALANCER:
      baseRTO = 10;
      break;
    default:
      baseRTO = 240;
  }

  // Adjust for SPOFs in chain
  const spofsInChain = depChain.nodes.filter(n => n.isSPOF);
  baseRTO += spofsInChain.length * 10;

  // Adjust for low redundancy
  const lowRedundancy = depChain.nodes.filter(
    n => (n.redundancyScore || 100) < 30
  );
  baseRTO += lowRedundancy.length * 5;

  // RPO calculation
  let rpo: number;
  const hasDatabases = depChain.nodes.some(n => n.type === NodeType.DATABASE);
  if (hasDatabases) {
    const dbNodes = depChain.nodes.filter(n => n.type === NodeType.DATABASE);
    const hasReplication = dbNodes.some(
      n => (n.metadata?.replicaCount as number || 0) > 0
    );
    rpo = hasReplication ? 5 : 15;
  } else if (
    service.type === NodeType.API_GATEWAY ||
    service.type === NodeType.LOAD_BALANCER ||
    service.type === NodeType.DNS
  ) {
    rpo = 60;
  } else if (service.type === NodeType.SERVERLESS || service.type === NodeType.MESSAGE_QUEUE) {
    rpo = 30;
  } else {
    rpo = 60;
  }

  // MTPD stays aligned with tier expectations instead of 2x RTO.
  let mtpd = 720;
  // MAO = MTPD + margin
  let mao = mtpd + 60;

  // Classification
  let category: 'critical' | 'high' | 'medium' | 'low';
  if (baseRTO <= 15) category = 'critical';
  else if (baseRTO <= 60) category = 'high';
  else if (baseRTO <= 240) category = 'medium';
  else category = 'low';

  if (category === 'critical') {
    mtpd = 240;
  } else if (category === 'high') {
    mtpd = 720;
  } else if (category === 'medium') {
    mtpd = 2_880;
  } else {
    mtpd = 4_320;
  }
  mao = mtpd + 60;

  return {
    rto: baseRTO,
    rpo,
    mtpd,
    mao,
    mbco: 50, // 50% minimum capacity by default
    category,
  };
}

// =====================================================
//  FINANCIAL IMPACT
// =====================================================

function estimateFinancialImpact(service: InfraNodeAttrs): FinancialImpact {
  const dependentsCount = service.dependentsCount || 0;

  return {
    estimatedCostPerHour: 0,
    confidence: 'low',
    note: 'Business impact not estimated automatically. Configure a financial profile to compute downtime cost.',
    breakdown: {
      directDependents: dependentsCount,
      serviceType: service.type,
      multiplier: 0,
    },
  };
}

// =====================================================
//  WEAK POINTS
// =====================================================

function identifyWeakPoints(
  depChain: { nodes: InfraNodeAttrs[] },
  analysis: GraphAnalysisReport
): WeakPoint[] {
  const weakPoints: WeakPoint[] = [];

  for (const node of depChain.nodes) {
    // SPOF
    if (node.isSPOF) {
      weakPoints.push({
        nodeId: node.id,
        nodeName: node.name,
        reason: 'Single Point of Failure',
        severity: 'critical',
      });
    }

    // Low redundancy
    if ((node.redundancyScore || 100) < 30) {
      weakPoints.push({
        nodeId: node.id,
        nodeName: node.name,
        reason: `Low redundancy score (${node.redundancyScore || 0}/100)`,
        severity: 'high',
      });
    }

    // No backup for DB
    if (node.type === NodeType.DATABASE && !node.metadata?.isMultiAZ) {
      weakPoints.push({
        nodeId: node.id,
        nodeName: node.name,
        reason: 'Database without Multi-AZ',
        severity: 'high',
      });
    }
  }

  return weakPoints;
}

// =====================================================
//  RECOVERY TIERS (ISO 22301)
// =====================================================

function assignRecoveryTiers(processes: BIAProcessResult[]): BIAProcessResult[] {
  return processes.map(p => ({
    ...p,
    recoveryTier: p.recoveryTier >= 1 && p.recoveryTier <= 4
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

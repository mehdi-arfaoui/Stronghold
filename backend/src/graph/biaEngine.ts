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
  analysis: GraphAnalysisReport
): BIAReportResult {
  // 1. Identify business services (front-facing nodes)
  const businessServices = identifyBusinessServices(graph);

  const processes: BIAProcessResult[] = [];

  for (const service of businessServices) {
    // 2. Get full dependency chain
    const depChain = getSubgraph(graph, service.id, 10);

    // 3. Calculate metrics
    const metrics = calculateMetrics(service, depChain, analysis);

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
      impactCategory: metrics.category,
      criticalityScore: service.criticalityScore || 0,
      recoveryTier: 4, // assigned below
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
      baseRTO = service.metadata?.isMultiAZ ? 15 : 120;
      break;
    case NodeType.APPLICATION:
    case NodeType.MICROSERVICE: {
      const hasLB = depChain.nodes.some(n => n.type === NodeType.LOAD_BALANCER);
      baseRTO = hasLB ? 10 : 60;
      break;
    }
    case NodeType.SERVERLESS:
      baseRTO = 5;
      break;
    case NodeType.API_GATEWAY:
      baseRTO = 10;
      break;
    case NodeType.LOAD_BALANCER:
      baseRTO = 15;
      break;
    default:
      baseRTO = 60;
  }

  // Adjust for SPOFs in chain
  const spofsInChain = depChain.nodes.filter(n => n.isSPOF);
  baseRTO += spofsInChain.length * 30;

  // Adjust for low redundancy
  const lowRedundancy = depChain.nodes.filter(
    n => (n.redundancyScore || 100) < 30
  );
  baseRTO += lowRedundancy.length * 15;

  // RPO calculation
  let rpo: number;
  const hasDatabases = depChain.nodes.some(n => n.type === NodeType.DATABASE);
  if (hasDatabases) {
    const dbNodes = depChain.nodes.filter(n => n.type === NodeType.DATABASE);
    const hasReplication = dbNodes.some(
      n => (n.metadata?.replicaCount as number || 0) > 0
    );
    rpo = hasReplication ? 1 : 60;
  } else {
    rpo = 240;
  }

  // MTPD = 2x RTO
  const mtpd = baseRTO * 2;
  // MAO = MTPD + margin
  const mao = mtpd + 60;

  // Classification
  let category: 'critical' | 'high' | 'medium' | 'low';
  if (baseRTO <= 30) category = 'critical';
  else if (baseRTO <= 120) category = 'high';
  else if (baseRTO <= 480) category = 'medium';
  else category = 'low';

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
    recoveryTier:
      p.suggestedRTO <= 60 ? 1 :
        p.suggestedRTO <= 240 ? 2 :
          p.suggestedRTO <= 1440 ? 3 :
            4,
  }));
}

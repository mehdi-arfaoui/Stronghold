// ============================================================
// PRA/PCA Intelligent Report Generator
// Aggregates ALL resilience data into a structured ISO 22301
// compliant report.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type { GraphInstance } from './graphService.js';
import * as GraphService from './graphService.js';
import { analyzeFullGraph } from './graphAnalysisEngine.js';
import { generateBIA } from './biaEngine.js';
import { detectRisks } from './riskDetectionEngine.js';
import { generateLandingZoneRecommendations } from './landingZoneService.js';
import type {
  GraphAnalysisReport,
  BIAReportResult,
  AutoDetectedRisk,
  LandingZoneReport,
} from './types.js';

export interface PraPcaReportConfig {
  includeSimulations?: string[];
  includeExercises?: string[];
  format: 'json' | 'pdf' | 'docx';
  sections?: string[];
}

export interface PraPcaReport {
  metadata: {
    generatedAt: Date;
    format: string;
    version: string;
    standard: string;
  };
  executiveSummary: {
    resilienceScore: number;
    totalInfrastructureNodes: number;
    totalDependencies: number;
    criticalSPOFs: number;
    tier1Services: number;
    tier2Services: number;
    topRisks: Array<{ title: string; probability: number; impact: number }>;
    overallAssessment: string;
  };
  sections: {
    scopeAndObjectives: ScopeSection;
    infrastructureMapping: InfrastructureSection;
    dependencyAnalysis: DependencySection;
    businessImpactAnalysis: BIASection;
    riskAssessment: RiskSection;
    simulationResults: SimulationSection;
    recoveryStrategy: RecoverySection;
    exerciseResults?: ExerciseSection;
    recommendations: RecommendationSection;
    actionPlan: ActionPlanSection;
  };
}

interface ScopeSection {
  title: string;
  content: string;
  inclusions: string[];
  exclusions: string[];
  methodology: string;
}

interface InfrastructureSection {
  title: string;
  totalNodes: number;
  nodesByType: Record<string, number>;
  nodesByProvider: Record<string, number>;
  nodesByRegion: Record<string, number>;
  criticalNodes: Array<{ id: string; name: string; type: string; criticalityScore: number }>;
}

interface DependencySection {
  title: string;
  totalEdges: number;
  spofs: Array<{ nodeName: string; severity: string; blastRadius: number; recommendation: string }>;
  circularDependencies: Array<{ nodes: string[]; length: number }>;
  cascadeChains: Array<{ sourceNode: string; impactedCount: number }>;
  redundancyIssues: Array<{ nodeName: string; failedChecks: string[] }>;
  regionalRisks: Array<{ region: string; concentration: number; risk: string }>;
}

interface BIASection {
  title: string;
  summary: {
    totalProcesses: number;
    tier1Count: number;
    tier2Count: number;
    tier3Count: number;
    tier4Count: number;
    totalFinancialExposure: number;
  };
  processes: Array<{
    serviceName: string;
    serviceType: string;
    recoveryTier: number;
    suggestedRTO: number;
    suggestedRPO: number;
    impactCategory: string;
    financialImpact: number;
    weakPoints: string[];
  }>;
  rtoRpoMatrix: Array<{
    tier: number;
    tierName: string;
    rtoRange: string;
    services: string[];
  }>;
}

interface RiskSection {
  title: string;
  totalRisks: number;
  risksBySeverity: Record<string, number>;
  risksByCategory: Record<string, number>;
  topRisks: Array<{
    title: string;
    category: string;
    probability: number;
    impact: number;
    riskScore: number;
    mitigations: string[];
  }>;
  riskMatrix: Array<Array<number>>;
}

interface SimulationSection {
  title: string;
  simulationsRun: number;
  scenarios: Array<{
    name: string;
    scenarioType: string;
    totalNodesAffected: number;
    percentageAffected: number;
    estimatedDowntime: number;
    estimatedFinancialLoss: number;
    postIncidentScore: number;
  }>;
  worstCase: {
    scenarioName: string;
    nodesAffected: number;
    financialLoss: number;
  } | null;
}

interface ExerciseSection {
  title: string;
  exercisesCompleted: number;
  exercises: Array<{
    name: string;
    type: string;
    date: Date;
    outcome: string;
  }>;
}

interface RecoverySection {
  title: string;
  strategies: Array<{
    serviceName: string;
    recoveryTier: number;
    strategy: string;
    estimatedCost: number;
    prerequisites: string[];
  }>;
  totalEstimatedCost: number;
  riskReductionPercentage: number;
}

interface RecommendationSection {
  title: string;
  immediate: string[];
  shortTerm: string[];
  longTerm: string[];
}

interface ActionPlanSection {
  title: string;
  actions: Array<{
    priority: 'critical' | 'high' | 'medium' | 'low';
    action: string;
    responsible: string;
    deadline: string;
    status: string;
  }>;
}

/**
 * Generates a comprehensive PRA/PCA report conforming to ISO 22301.
 */
export async function generatePraPcaReport(
  prisma: PrismaClient,
  tenantId: string,
  config: PraPcaReportConfig
): Promise<PraPcaReport> {
  // 1. Load graph and run analysis
  const graph = await GraphService.getGraph(prisma, tenantId);
  const analysis = await analyzeFullGraph(graph);
  const stats = GraphService.getGraphStats(graph);

  // 2. Generate BIA
  const bia = generateBIA(graph, analysis);

  // 3. Detect risks
  const risks = detectRisks(graph, analysis);

  // 4. Generate landing zone recommendations
  const landingZone = generateLandingZoneRecommendations(bia, analysis);

  // 5. Load simulations
  const simulations = await loadSimulations(prisma, tenantId, config.includeSimulations);

  // 6. Load exercises (if requested)
  const exercises = config.includeExercises
    ? await loadExercises(prisma, tenantId, config.includeExercises)
    : null;

  // 7. Build report
  const report = buildReport(graph, analysis, bia, risks, landingZone, simulations, exercises, stats, config);

  return report;
}

async function loadSimulations(prisma: PrismaClient, tenantId: string, ids?: string[]) {
  const where: any = { tenantId };
  if (ids && ids.length > 0) {
    where.id = { in: ids };
  }
  const query: any = { where, orderBy: { createdAt: 'desc' } };
  if (!ids) query.take = 10;
  return prisma.simulation.findMany(query);
}

async function loadExercises(prisma: PrismaClient, tenantId: string, ids?: string[]) {
  const where: any = { tenantId };
  if (ids && ids.length > 0) {
    where.id = { in: ids };
  }
  const query: any = { where, orderBy: { createdAt: 'desc' }, include: { results: true } };
  if (!ids) query.take = 10;
  return prisma.exercise.findMany(query);
}

function buildReport(
  graph: GraphInstance,
  analysis: GraphAnalysisReport,
  bia: BIAReportResult,
  risks: AutoDetectedRisk[],
  landingZone: LandingZoneReport,
  simulations: any[],
  exercises: any[] | null,
  stats: ReturnType<typeof GraphService.getGraphStats>,
  config: PraPcaReportConfig
): PraPcaReport {
  // Build critical nodes list
  const criticalNodes: Array<{ id: string; name: string; type: string; criticalityScore: number }> = [];
  const sortedScores = [...analysis.criticalityScores.entries()].sort((a, b) => b[1] - a[1]);
  for (const [nodeId, score] of sortedScores.slice(0, 20)) {
    if (!graph.hasNode(nodeId)) continue;
    const attrs = graph.getNodeAttributes(nodeId);
    criticalNodes.push({ id: nodeId, name: attrs.name, type: attrs.type, criticalityScore: score });
  }

  // BIA summary
  const tier1 = bia.processes.filter(p => p.recoveryTier === 1);
  const tier2 = bia.processes.filter(p => p.recoveryTier === 2);
  const tier3 = bia.processes.filter(p => p.recoveryTier === 3);
  const tier4 = bia.processes.filter(p => p.recoveryTier === 4);
  const totalFinancialExposure = bia.processes.reduce(
    (sum, p) => sum + (p.financialImpact?.estimatedCostPerHour || 0), 0
  );

  // Risk matrix (5x5)
  const riskMatrix = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
  for (const risk of risks) {
    const p = Math.min(Math.max(risk.probability - 1, 0), 4);
    const i = Math.min(Math.max(risk.impact - 1, 0), 4);
    riskMatrix[p]![i]!++;
  }

  const risksBySeverity: Record<string, number> = {};
  const risksByCategory: Record<string, number> = {};
  for (const risk of risks) {
    const score = risk.probability * risk.impact;
    const severity = score >= 15 ? 'critical' : score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low';
    risksBySeverity[severity] = (risksBySeverity[severity] || 0) + 1;
    risksByCategory[risk.category] = (risksByCategory[risk.category] || 0) + 1;
  }

  // Simulation summary
  const worstSim = simulations.length > 0
    ? simulations.reduce((worst, s) => (s.totalNodesAffected > (worst.totalNodesAffected || 0)) ? s : worst, simulations[0])
    : null;

  // Generate recommendations
  const immediate: string[] = [];
  const shortTerm: string[] = [];
  const longTerm: string[] = [];

  for (const spof of analysis.spofs.filter(s => s.severity === 'critical')) {
    immediate.push(`Remediate critical SPOF: ${spof.nodeName} — ${spof.recommendation}`);
  }
  for (const issue of analysis.redundancyIssues.filter(i => i.failedChecks.some(c => c.impact === 'critical'))) {
    immediate.push(`Add redundancy for ${issue.nodeName}: ${issue.failedChecks.map(c => c.recommendation).join('; ')}`);
  }
  for (const risk of analysis.regionalRisks.filter(r => r.risk === 'critical')) {
    shortTerm.push(`Reduce regional concentration in ${risk.region} (${risk.concentration}%)`);
  }
  for (const cycle of analysis.circularDeps) {
    shortTerm.push(`Break circular dependency: ${cycle.nodes.map(n => n.name).join(' → ')}`);
  }
  for (const rec of landingZone.recommendations.slice(0, 5)) {
    longTerm.push(`Implement ${rec.strategy} for ${rec.serviceName} (estimated cost: ${rec.estimatedCost}/month)`);
  }

  // Generate overall assessment
  const score = analysis.resilienceScore;
  let assessment: string;
  if (score >= 80) assessment = 'Infrastructure resilience is GOOD. Minor improvements recommended to reach optimal levels.';
  else if (score >= 60) assessment = 'Infrastructure resilience is ACCEPTABLE but has notable gaps. Several SPOFs and redundancy issues need attention.';
  else if (score >= 40) assessment = 'Infrastructure resilience is INADEQUATE. Significant risks exist. Immediate action required on critical SPOFs and redundancy gaps.';
  else assessment = 'Infrastructure resilience is CRITICAL. Major structural issues detected. Emergency remediation required.';

  // Action plan
  const actions: ActionPlanSection['actions'] = [];
  for (const rec of immediate) {
    actions.push({ priority: 'critical', action: rec, responsible: 'Infrastructure Team', deadline: '2 weeks', status: 'pending' });
  }
  for (const rec of shortTerm) {
    actions.push({ priority: 'high', action: rec, responsible: 'Architecture Team', deadline: '1 month', status: 'pending' });
  }
  for (const rec of longTerm) {
    actions.push({ priority: 'medium', action: rec, responsible: 'Platform Team', deadline: '3 months', status: 'pending' });
  }

  return {
    metadata: {
      generatedAt: new Date(),
      format: config.format,
      version: '1.0',
      standard: 'ISO 22301:2019',
    },
    executiveSummary: {
      resilienceScore: score,
      totalInfrastructureNodes: stats.totalNodes,
      totalDependencies: stats.totalEdges,
      criticalSPOFs: analysis.spofs.filter(s => s.severity === 'critical').length,
      tier1Services: tier1.length,
      tier2Services: tier2.length,
      topRisks: risks.slice(0, 5).map(r => ({ title: r.title, probability: r.probability, impact: r.impact })),
      overallAssessment: assessment,
    },
    sections: {
      scopeAndObjectives: {
        title: '1. Scope and Objectives',
        content: 'This PRA/PCA report provides a comprehensive assessment of IT infrastructure resilience, including business impact analysis, risk assessment, and recovery strategies.',
        inclusions: [
          `${stats.totalNodes} infrastructure nodes across ${Object.keys(stats.nodesByProvider).length} providers`,
          `${stats.totalEdges} mapped dependencies`,
          `${bia.processes.length} business services analyzed`,
          `${simulations.length} disaster scenarios simulated`,
        ],
        exclusions: ['Manual processes not mapped to infrastructure', 'Third-party SLA enforcement'],
        methodology: 'Automated graph-based analysis using Tarjan algorithm (SPOF detection), betweenness centrality (criticality scoring), BFS cascade simulation, and ISO 22301 compliant BIA methodology.',
      },
      infrastructureMapping: {
        title: '2. Infrastructure Mapping',
        totalNodes: stats.totalNodes,
        nodesByType: stats.nodesByType,
        nodesByProvider: stats.nodesByProvider,
        nodesByRegion: stats.nodesByRegion,
        criticalNodes,
      },
      dependencyAnalysis: {
        title: '3. Dependency Analysis',
        totalEdges: stats.totalEdges,
        spofs: analysis.spofs.map(s => ({
          nodeName: s.nodeName, severity: s.severity, blastRadius: s.blastRadius, recommendation: s.recommendation,
        })),
        circularDependencies: analysis.circularDeps.map(c => ({
          nodes: c.nodes.map(n => n.name), length: c.length,
        })),
        cascadeChains: analysis.cascadeChains.slice(0, 10).map(c => ({
          sourceNode: c.sourceNodeName, impactedCount: c.totalImpacted,
        })),
        redundancyIssues: analysis.redundancyIssues.map(i => ({
          nodeName: i.nodeName, failedChecks: i.failedChecks.map(c => c.check),
        })),
        regionalRisks: analysis.regionalRisks.map(r => ({
          region: r.region, concentration: r.concentration, risk: r.risk,
        })),
      },
      businessImpactAnalysis: {
        title: '4. Business Impact Analysis (BIA)',
        summary: {
          totalProcesses: bia.processes.length,
          tier1Count: tier1.length,
          tier2Count: tier2.length,
          tier3Count: tier3.length,
          tier4Count: tier4.length,
          totalFinancialExposure,
        },
        processes: bia.processes.map(p => ({
          serviceName: p.serviceName,
          serviceType: p.serviceType,
          recoveryTier: p.recoveryTier,
          suggestedRTO: p.suggestedRTO,
          suggestedRPO: p.suggestedRPO,
          impactCategory: p.impactCategory,
          financialImpact: p.financialImpact?.estimatedCostPerHour || 0,
          weakPoints: p.weakPoints.map(w => w.reason),
        })),
        rtoRpoMatrix: [
          { tier: 1, tierName: 'Mission Critical', rtoRange: '< 1 hour', services: tier1.map(p => p.serviceName) },
          { tier: 2, tierName: 'Business Critical', rtoRange: '1-4 hours', services: tier2.map(p => p.serviceName) },
          { tier: 3, tierName: 'Important', rtoRange: '4-24 hours', services: tier3.map(p => p.serviceName) },
          { tier: 4, tierName: 'Non-Critical', rtoRange: '> 24 hours', services: tier4.map(p => p.serviceName) },
        ],
      },
      riskAssessment: {
        title: '5. Risk Assessment',
        totalRisks: risks.length,
        risksBySeverity,
        risksByCategory,
        topRisks: risks
          .sort((a, b) => (b.probability * b.impact) - (a.probability * a.impact))
          .slice(0, 15)
          .map(r => ({
            title: r.title,
            category: r.category,
            probability: r.probability,
            impact: r.impact,
            riskScore: r.probability * r.impact,
            mitigations: r.mitigations.map(m => m.title),
          })),
        riskMatrix,
      },
      simulationResults: {
        title: '6. Simulation Results',
        simulationsRun: simulations.length,
        scenarios: simulations.map(s => ({
          name: s.name || s.scenarioType,
          scenarioType: s.scenarioType,
          totalNodesAffected: s.totalNodesAffected,
          percentageAffected: s.percentageAffected,
          estimatedDowntime: s.estimatedDowntime,
          estimatedFinancialLoss: s.estimatedFinancialLoss || 0,
          postIncidentScore: s.postIncidentScore,
        })),
        worstCase: worstSim ? {
          scenarioName: worstSim.name || worstSim.scenarioType,
          nodesAffected: worstSim.totalNodesAffected,
          financialLoss: worstSim.estimatedFinancialLoss || 0,
        } : null,
      },
      ...(exercises ? {
        exerciseResults: {
          title: '7. Exercise Results',
          exercisesCompleted: exercises.length,
          exercises: exercises.map((e: any) => ({
            name: e.name,
            type: e.type,
            date: e.createdAt,
            outcome: e.results?.[0]?.outcome || 'pending',
          })),
        },
      } : {}),
      recoveryStrategy: {
        title: '8. Recovery Strategy',
        strategies: landingZone.recommendations.map(r => ({
          serviceName: r.serviceName,
          recoveryTier: r.recoveryTier,
          strategy: r.strategy.type,
          estimatedCost: r.estimatedCost,
          prerequisites: r.prerequisites,
        })),
        totalEstimatedCost: landingZone.summary.estimatedTotalCost,
        riskReductionPercentage: landingZone.summary.estimatedRiskReduction,
      },
      recommendations: {
        title: '9. Recommendations',
        immediate,
        shortTerm,
        longTerm,
      },
      actionPlan: {
        title: '10. Action Plan',
        actions,
      },
    },
  };
}

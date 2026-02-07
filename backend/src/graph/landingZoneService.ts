// ============================================================
// LandingZoneRecommendationService — Recovery recommendations
// ============================================================

import type {
  BIAReportResult,
  BIAProcessResult,
  GraphAnalysisReport,
  LandingZoneItem,
  LandingZoneReport,
  RecoveryStrategy,
} from './types.js';

export function generateLandingZoneRecommendations(
  bia: BIAReportResult,
  analysis: GraphAnalysisReport
): LandingZoneReport {
  const recommendations: LandingZoneItem[] = [];

  for (const process of bia.processes) {
    const priorityScore = calculateMigrationPriority(process, analysis);
    const strategy = recommendStrategy(process);
    const estimatedCost = estimateMigrationCost(process, strategy);

    recommendations.push({
      serviceId: process.serviceNodeId,
      serviceName: process.serviceName,
      priorityScore,
      recoveryTier: process.recoveryTier,
      strategy,
      estimatedCost,
      riskOfInaction: process.financialImpact.estimatedCostPerHour,
      prerequisites: identifyPrerequisites(process),
    });
  }

  recommendations.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    generatedAt: new Date(),
    recommendations,
    summary: {
      totalServices: recommendations.length,
      tier1Count: recommendations.filter(r => r.recoveryTier === 1).length,
      estimatedTotalCost: recommendations.reduce((s, r) => s + r.estimatedCost, 0),
      estimatedRiskReduction: calculateOverallRiskReduction(recommendations),
    },
  };
}

function calculateMigrationPriority(
  process: BIAProcessResult,
  analysis: GraphAnalysisReport
): number {
  let score = 0;

  // Criticality weight (40%)
  score += (process.criticalityScore / 100) * 40;

  // Recovery tier (30%)
  const tierScores: Record<number, number> = { 1: 30, 2: 20, 3: 10, 4: 5 };
  score += tierScores[process.recoveryTier] || 0;

  // SPOF presence (20%)
  const hasSPOF = process.weakPoints.some(w => w.reason.includes('SPOF'));
  if (hasSPOF) score += 20;

  // Financial impact (10%)
  const maxImpact = Math.max(
    ...analysis.spofs.map(s => s.blastRadius),
    1
  );
  score += Math.min(10, (process.financialImpact.estimatedCostPerHour / (maxImpact * 100)) * 10);

  return Math.round(Math.min(100, score));
}

function recommendStrategy(process: BIAProcessResult): RecoveryStrategy {
  // Tier 1 → Active-Active
  if (process.recoveryTier === 1) {
    return {
      type: 'active_active',
      description: 'Active-active deployment across 2+ regions',
      targetRTO: 5,
      targetRPO: 0,
      components: [
        'Global load balancer (Route 53 / Azure Traffic Manager)',
        'Synchronous data replication',
        'Automatic health checks',
        'Automatic DNS failover',
      ],
    };
  }

  // Tier 2 → Warm Standby
  if (process.recoveryTier === 2) {
    return {
      type: 'warm_standby',
      description: 'Pre-provisioned standby infrastructure with rapid startup',
      targetRTO: 30,
      targetRPO: 15,
      components: [
        'IaC-ready infrastructure templates',
        'Asynchronous data replication',
        'Automated failover scripts',
        'Documented recovery runbook',
      ],
    };
  }

  // Tier 3 → Pilot Light
  if (process.recoveryTier === 3) {
    return {
      type: 'pilot_light',
      description: 'Replicated data with on-demand infrastructure provisioning',
      targetRTO: 120,
      targetRPO: 60,
      components: [
        'Regular data backups',
        'Validated IaC templates',
        'Documented provisioning procedure',
      ],
    };
  }

  // Tier 4 → Backup & Restore
  return {
    type: 'backup_restore',
    description: 'Restoration from backups',
    targetRTO: 1440,
    targetRPO: 1440,
    components: [
      'Automated daily backups',
      'Tested restoration procedure',
    ],
  };
}

function estimateMigrationCost(
  process: BIAProcessResult,
  strategy: RecoveryStrategy
): number {
  // Base cost by strategy type (monthly)
  const baseCosts: Record<string, number> = {
    active_active: 5000,
    warm_standby: 2000,
    pilot_light: 500,
    backup_restore: 100,
  };

  const base = baseCosts[strategy.type] || 500;

  // Multiply by dependency chain size (more deps = more to replicate)
  const chainMultiplier = Math.max(1, process.dependencyChain.length * 0.3);

  return Math.round(base * chainMultiplier);
}

function identifyPrerequisites(process: BIAProcessResult): string[] {
  const prereqs: string[] = [];

  // Check if databases need replication
  const hasDB = process.dependencyChain.some(n => n.type === 'DATABASE');
  if (hasDB) {
    prereqs.push('Configure database replication to target region');
  }

  // Check for stateful services
  const hasStateful = process.dependencyChain.some(n =>
    ['DATABASE', 'CACHE', 'FILE_STORAGE', 'OBJECT_STORAGE'].includes(n.type)
  );
  if (hasStateful) {
    prereqs.push('Set up data synchronization pipeline');
  }

  // Check for SPOF
  if (process.weakPoints.some(w => w.reason.includes('SPOF'))) {
    prereqs.push('Resolve single points of failure before migration');
  }

  // Always: IaC
  prereqs.push('Ensure infrastructure-as-code coverage for all components');

  // Always: testing
  prereqs.push('Validate recovery procedure through tabletop exercise');

  return prereqs;
}

function calculateOverallRiskReduction(recommendations: LandingZoneItem[]): number {
  if (recommendations.length === 0) return 0;

  // Weighted average of risk reduction by tier
  let totalWeight = 0;
  let weightedReduction = 0;

  for (const rec of recommendations) {
    const weight = rec.recoveryTier === 1 ? 4 : rec.recoveryTier === 2 ? 3 : rec.recoveryTier === 3 ? 2 : 1;
    const strategyReduction: Record<string, number> = {
      active_active: 90,
      warm_standby: 70,
      pilot_light: 50,
      backup_restore: 30,
    };
    totalWeight += weight;
    weightedReduction += (strategyReduction[rec.strategy.type] || 30) * weight;
  }

  return totalWeight > 0 ? Math.round(weightedReduction / totalWeight) : 0;
}

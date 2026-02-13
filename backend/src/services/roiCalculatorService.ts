// ============================================================
// ROI Calculator Service — Financial impact & ROI calculations
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { DOWNTIME_COSTS, COMPANY_SIZE_PROFILES, type CompanySizeKey } from '../constants/market-data.js';
import { RECOVERY_STRATEGY_COSTS, type RecoveryStrategyKey } from '../constants/cloud-recovery-costs.js';
import { calculateComplianceCoverage } from '../constants/compliance-mapping.js';

export interface SPOFRiskDetail {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  provider: string;
  rtoMinutes: number;
  dependentServices: number;
  blastRadius: number;
  failureProbability: number;
  annualExpectedLoss: number;
  recommendedStrategy: string;
  remediationMonthlyCost: { min: number; max: number; median: number };
}

export interface ROIReport {
  annualSavings: number;
  roiPercentage: number;
  paybackPeriodMonths: number;
  breakdown: {
    currentAnnualRisk: number;
    riskReduction: number;
    annualRemediationCost: number;
    netBenefit: number;
  };
  riskDetails: {
    spofCount: number;
    avgRtoHours: number;
    hourlyCost: number;
    annualExpectedLoss: number;
    perSpof: SPOFRiskDetail[];
  };
  remediationDetails: {
    monthlyCloudCost: number;
    monthlySubscription: number;
    totalMonthlyCost: number;
  };
  complianceCoverage: Record<string, { total: number; covered: number; percentage: number }>;
  methodology: {
    downtimeCostSource: string;
    riskReductionAssumption: string;
    spofFailureProbability: string;
    calculationDetails: string;
    disclaimer: string;
  };
}

// Failure probabilities by node type (source: Uptime Institute 2024, Gartner 2024)
const FAILURE_PROBABILITY_BY_TYPE: Record<string, { annual: number; source: string }> = {
  DATABASE:        { annual: 0.12, source: 'Uptime Institute 2024 — base de donnees sans replica' },
  CACHE:           { annual: 0.18, source: 'Redis Labs 2024 — instance unique sans cluster' },
  PHYSICAL_SERVER: { annual: 0.25, source: 'Gartner 2024 — serveur physique unique on-premise' },
  MICROSERVICE:    { annual: 0.08, source: 'DORA State of DevOps 2024 — service conteneurise' },
  LOAD_BALANCER:   { annual: 0.05, source: 'AWS SLA 2024 — ALB/NLB, SLA 99.99%' },
  SERVERLESS:      { annual: 0.02, source: 'AWS Lambda SLA — 99.95% disponibilite' },
  APPLICATION:     { annual: 0.10, source: 'Estimation basee sur Uptime Institute 2024' },
};
const DEFAULT_FAILURE_PROBABILITY = 0.10;

// Risk reduction factor varies by strategy
const RISK_REDUCTION_BY_STRATEGY: Record<string, number> = {
  'active-active':  0.95, // near-total elimination
  'warm-standby':   0.80,
  'pilot-light':    0.60,
  'backup':         0.40,
};
const DEFAULT_RISK_REDUCTION = 0.70;

const SUBSCRIPTION_COSTS: Record<string, number> = {
  STARTER: 200,
  PRO: 800,
  ENTERPRISE: 2000,
  OWNER: 0,
  CUSTOM: 1500,
};

/**
 * Determine the recommended recovery strategy based on node type and criticality.
 */
function selectStrategy(nodeType: string, criticalityScore: number, metadata: Record<string, unknown>): RecoveryStrategyKey {
  const isDB = nodeType === 'DATABASE';
  const isCache = nodeType === 'CACHE';
  const isCritical = criticalityScore > 0.7 || Boolean(metadata?.critical);

  if (isCritical && (isDB || isCache)) return 'active-active';
  if (isCritical) return 'warm-standby';
  if (isDB) return 'pilot-light';
  return 'backup';
}

export async function calculateROI(
  prisma: PrismaClient,
  tenantId: string,
  options?: {
    companySize?: CompanySizeKey;
    vertical?: string;
    currency?: string;
    customHourlyCost?: number;
  }
): Promise<ROIReport> {
  const companySize = options?.companySize ?? 'midMarket';
  const hourlyCost = options?.customHourlyCost
    ?? (options?.vertical ? getVerticalCost(options.vertical) : COMPANY_SIZE_PROFILES[companySize].defaultHourlyCost);

  // 1. Get SPOF data with blast radius
  const spofNodes = await prisma.infraNode.findMany({
    where: { tenantId, isSPOF: true },
    include: { outEdges: true, inEdges: true },
  });

  const totalNodeCount = await prisma.infraNode.count({ where: { tenantId } });

  // 2. Get BIA data for RTO
  const biaReport = await prisma.bIAReport2.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: { processes: true },
  });

  const biaMap = new Map(
    (biaReport?.processes ?? []).map(p => [p.serviceNodeId, p])
  );

  // 3. Calculate per-SPOF risk with precise metrics
  const spofDetails: SPOFRiskDetail[] = [];
  let totalExpectedLoss = 0;
  let totalMonthlyRemediation = 0;
  let weightedRiskReduction = 0;

  for (const spof of spofNodes) {
    const bia = biaMap.get(spof.id);
    const rtoMinutes = bia?.validatedRTO ?? bia?.suggestedRTO ?? 240;
    const rtoHours = rtoMinutes / 60;

    // Dependent services = inbound edges (services that depend on this SPOF)
    const dependentCount = Math.max(1, spof.inEdges.length);
    const blastRadius = spof.blastRadius ?? dependentCount;

    // Failure probability based on actual node type
    const failureInfo = FAILURE_PROBABILITY_BY_TYPE[spof.type] ?? { annual: DEFAULT_FAILURE_PROBABILITY, source: 'Estimation par defaut' };

    // Adjust failure probability based on metadata
    let adjustedProbability = failureInfo.annual;
    const metadata = (spof.metadata as Record<string, unknown>) ?? {};
    if (!metadata.isMultiAZ && (spof.type === 'DATABASE' || spof.type === 'CACHE')) {
      adjustedProbability *= 1.3; // +30% risk for single-AZ stateful services
    }
    if (Number(metadata.replicaCount ?? 0) === 0 && spof.type === 'DATABASE') {
      adjustedProbability *= 1.2; // +20% for no replicas
    }

    // Impact weighted by blast radius proportion of total infrastructure
    const impactWeight = Math.min(1, blastRadius / Math.max(1, totalNodeCount));
    const nodeExpectedLoss = adjustedProbability * rtoHours * hourlyCost * impactWeight;

    // Select remediation strategy
    const strategy = selectStrategy(spof.type, spof.criticalityScore ?? 0, metadata);
    const provider = (spof.provider === 'azure' ? 'azure' : spof.provider === 'gcp' ? 'gcp' : 'aws') as 'aws' | 'azure' | 'gcp';
    const strategyCosts = RECOVERY_STRATEGY_COSTS[strategy].cloudCosts[provider];
    const medianMonthlyCost = Math.round((strategyCosts.monthly.min + strategyCosts.monthly.max) / 2);

    const strategyReduction = RISK_REDUCTION_BY_STRATEGY[strategy] ?? DEFAULT_RISK_REDUCTION;

    spofDetails.push({
      nodeId: spof.id,
      nodeName: spof.name,
      nodeType: spof.type,
      provider: spof.provider ?? 'unknown',
      rtoMinutes,
      dependentServices: dependentCount,
      blastRadius,
      failureProbability: Math.round(adjustedProbability * 1000) / 10, // as percentage with 1 decimal
      annualExpectedLoss: Math.round(nodeExpectedLoss),
      recommendedStrategy: strategy,
      remediationMonthlyCost: {
        min: strategyCosts.monthly.min,
        max: strategyCosts.monthly.max,
        median: medianMonthlyCost,
      },
    });

    totalExpectedLoss += nodeExpectedLoss;
    totalMonthlyRemediation += medianMonthlyCost;
    weightedRiskReduction += nodeExpectedLoss * strategyReduction;
  }

  // 4. Use per-SPOF remediation costs instead of generic fallback
  const monthlyCloudCost = totalMonthlyRemediation;

  // 5. Get subscription tier
  const license = await prisma.license.findUnique({ where: { tenantId } });
  const planKey = license?.plan ?? 'PRO';
  const monthlySubscription = SUBSCRIPTION_COSTS[planKey] ?? 800;

  // 6. Calculate ROI using weighted risk reduction (per-strategy, not flat 70%)
  const totalMonthlyCost = monthlyCloudCost + monthlySubscription;
  const annualRemediationCost = totalMonthlyCost * 12;
  const riskReduction = totalExpectedLoss > 0 ? weightedRiskReduction : 0;
  const annualSavings = riskReduction - annualRemediationCost;
  const effectiveReductionRate = totalExpectedLoss > 0
    ? Math.round((riskReduction / totalExpectedLoss) * 100)
    : 0;
  const roiPercentage = annualRemediationCost > 0
    ? Math.round(((riskReduction - annualRemediationCost) / annualRemediationCost) * 100)
    : 0;
  const paybackPeriodMonths = riskReduction > 0
    ? Math.round((annualRemediationCost / (riskReduction / 12)) * 10) / 10
    : 999;

  // 7. Calculate average RTO
  const allRtos = (biaReport?.processes ?? []).map(p => p.validatedRTO ?? p.suggestedRTO ?? 0).filter(r => r > 0);
  const avgRtoMinutes = allRtos.length > 0 ? allRtos.reduce((a, b) => a + b, 0) / allRtos.length : 240;

  // 8. Compliance coverage
  const implementedFeatures = [
    'discovery', 'graph_analysis', 'spof_analysis', 'risk_detection',
    'bia_auto_generate', 'bia_rto_rpo', 'recommendations', 'recovery_strategy',
    'simulations', 'report_pra_pca',
  ];
  if (biaReport) implementedFeatures.push('bia_auto_generate', 'bia_rto_rpo');

  const complianceCoverage = calculateComplianceCoverage(implementedFeatures);

  return {
    annualSavings: Math.round(annualSavings),
    roiPercentage,
    paybackPeriodMonths,
    breakdown: {
      currentAnnualRisk: Math.round(totalExpectedLoss),
      riskReduction: Math.round(riskReduction),
      annualRemediationCost: Math.round(annualRemediationCost),
      netBenefit: Math.round(annualSavings),
    },
    riskDetails: {
      spofCount: spofNodes.length,
      avgRtoHours: Math.round(avgRtoMinutes / 60 * 10) / 10,
      hourlyCost,
      annualExpectedLoss: Math.round(totalExpectedLoss),
      perSpof: spofDetails,
    },
    remediationDetails: {
      monthlyCloudCost: Math.round(monthlyCloudCost),
      monthlySubscription,
      totalMonthlyCost: Math.round(totalMonthlyCost),
    },
    complianceCoverage,
    methodology: {
      downtimeCostSource: `ITIC 2024 Hourly Cost of Downtime Survey — cout horaire applique: ${hourlyCost.toLocaleString('fr-FR')} USD (profil: ${companySize})`,
      riskReductionAssumption: `${effectiveReductionRate}% — moyenne ponderee par SPOF selon la strategie de reprise (active-active: 95%, warm-standby: 80%, pilot-light: 60%, backup: 40%)`,
      spofFailureProbability: 'Variable par type de composant (Uptime Institute 2024, Gartner 2024): DB 12%, Cache 18%, Serveur physique 25%, Microservice 8%',
      calculationDetails: `Risque = P(panne) x RTO(h) x Cout_horaire x (Blast_radius / Nb_total_noeuds). Applique sur ${spofNodes.length} SPOF identifies, ${totalNodeCount} noeuds au total.`,
      disclaimer: 'Calculs bases sur les donnees reelles de votre infrastructure (types de noeuds, dependances, RTO/BIA). Les probabilites de panne sont issues de rapports publics sectoriels. Les couts cloud sont bases sur les tarifs publics AWS/Azure/GCP (jan 2025).',
    },
  };
}

function getVerticalCost(vertical: string): number {
  const v = DOWNTIME_COSTS.byVertical[vertical as keyof typeof DOWNTIME_COSTS.byVertical];
  return v?.perHour ?? DOWNTIME_COSTS.midMarket.perHour.median;
}

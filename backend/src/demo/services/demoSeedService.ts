/**
 * Demo seed service for Stronghold.
 * Generates a parametric demo environment for ShopMax-like infrastructures.
 * Infrastructure size and service labels are derived from demo profile
 * (sector + company size) through layered generation.
 *
 * PME: core layer only (~15-25 nodes)
 * PME+: core + microservices (~35-50 nodes)
 * ETI: core + microservices + resilience + DR (~60-100 nodes)
 * Large: all layers with multi-region + extended legacy (~120-180 nodes)
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import * as GraphService from '../../graph/graphService.js';
import { generateBIA } from '../../graph/biaEngine.js';
import { detectRisks } from '../../graph/riskDetectionEngine.js';
import { runPostIngestionPipeline } from '../../discovery/discoveryOrchestrator.js';
import { ensureBaselineSnapshot } from '../../drift/driftDetectionService.js';
import { BusinessFlowFinancialEngineService } from '../../services/business-flow-financial-engine.service.js';
import { CurrencyService } from '../../services/currency.service.js';
import {
  deriveOrganizationSizeCategoryFromDemoProfile,
  resolveDemoProfileSelection,
  type DemoProfileSelection,
  type DemoProfileSelectionInput,
} from '../config/demo-profiles.js';
import { generateDemoInfrastructure } from './demoInfrastructureFactory.js';
import { appLogger } from "../../utils/logger.js";

interface DemoFlowNodeDef {
  infraNodeId: string;
  role: string;
  isCritical?: boolean;
  hasAlternativePath?: boolean;
  alternativeNodeId?: string | null;
}

interface DemoBusinessFlowDef {
  name: string;
  description: string;
  category: string;
  annualRevenue?: number | null;
  transactionsPerHour?: number | null;
  revenuePerTransaction?: number | null;
  estimatedCostPerHour?: number | null;
  peakHoursMultiplier?: number;
  peakHoursStart?: number | null;
  peakHoursEnd?: number | null;
  operatingDaysPerWeek?: number;
  operatingHoursPerDay?: number;
  slaUptimePercent?: number | null;
  slaPenaltyPerHour?: number | null;
  slaPenaltyFlat?: number | null;
  contractualRTO?: number | null;
  estimatedCustomerChurnPerHour?: number | null;
  customerLifetimeValue?: number | null;
  reputationImpactCategory?: string | null;
  source: 'manual' | 'ai_suggested' | 'cloud_tags' | 'imported';
  aiConfidence?: number | null;
  validatedByUser?: boolean;
  mutualExclusionGroup?: string | null;
  nodes: DemoFlowNodeDef[];
}

export type RunDemoSeedOptions = {
  profile?: DemoProfileSelectionInput;
};

type DemoServiceCriticality = 'critical' | 'high' | 'medium' | 'low';

type ValidatedBiaServiceSettings = {
  validatedRTO: number;
  validatedRPO: number;
  validatedMTPD: number;
  recoveryTier: number;
  impactCategory: DemoServiceCriticality;
};

type ValidatedBiaServiceOverride = ValidatedBiaServiceSettings & {
  financialImpactPerHour: number;
};

const DEMO_BIA_RAW_WEIGHTS: Readonly<Record<DemoServiceCriticality, number>> = {
  critical: 0.35,
  high: 0.2,
  medium: 0.1,
  low: 0.05,
};

const demoBusinessFlows: DemoBusinessFlowDef[] = [
  {
    name: 'Paiement Client - Carte',
    description: 'Flux principal de paiement par carte bancaire',
    category: 'revenue',
    annualRevenue: 2_400_000,
    peakHoursMultiplier: 1.5,
    peakHoursStart: 9,
    peakHoursEnd: 18,
    operatingDaysPerWeek: 5,
    operatingHoursPerDay: 10,
    slaUptimePercent: 99.95,
    slaPenaltyPerHour: 500,
    contractualRTO: 60,
    estimatedCustomerChurnPerHour: 2,
    customerLifetimeValue: 2400,
    reputationImpactCategory: 'high',
    source: 'manual',
    validatedByUser: true,
    mutualExclusionGroup: 'checkout-payment',
    nodes: [
      { infraNodeId: 'cloudflare-cdn', role: 'entry_point', isCritical: true },
      { infraNodeId: 'route53-shopmax', role: 'entry_point', isCritical: true },
      {
        infraNodeId: 'alb-prod',
        role: 'entry_point',
        isCritical: true,
        hasAlternativePath: true,
        alternativeNodeId: 'alb-dr',
      },
      { infraNodeId: 'svc-api-gateway', role: 'processing', isCritical: true },
      { infraNodeId: 'svc-payment', role: 'processing', isCritical: true },
      { infraNodeId: 'db-payment', role: 'data_store', isCritical: true },
      { infraNodeId: 'stripe-api', role: 'external_dependency', isCritical: true },
    ],
  },
  {
    name: 'Paiement Client - Virement',
    description: 'Flux alternatif de paiement virement/SEPA',
    category: 'revenue',
    estimatedCostPerHour: 650,
    peakHoursMultiplier: 1.4,
    operatingDaysPerWeek: 5,
    operatingHoursPerDay: 10,
    source: 'manual',
    validatedByUser: true,
    mutualExclusionGroup: 'checkout-payment',
    nodes: [
      { infraNodeId: 'svc-api-gateway', role: 'entry_point', isCritical: true },
      { infraNodeId: 'svc-order', role: 'processing', isCritical: true },
      { infraNodeId: 'erp-server', role: 'external_dependency', isCritical: true },
      { infraNodeId: 'erp-db', role: 'data_store', isCritical: true },
    ],
  },
  {
    name: 'Onboarding Utilisateur',
    description: 'Inscription et activation compte client',
    category: 'revenue',
    transactionsPerHour: 450,
    revenuePerTransaction: 35,
    peakHoursMultiplier: 1.5,
    peakHoursStart: 8,
    peakHoursEnd: 20,
    operatingDaysPerWeek: 7,
    operatingHoursPerDay: 16,
    source: 'manual',
    validatedByUser: true,
    nodes: [
      { infraNodeId: 'svc-api-gateway', role: 'entry_point', isCritical: true },
      { infraNodeId: 'svc-user', role: 'processing', isCritical: true },
      {
        infraNodeId: 'db-user',
        role: 'data_store',
        isCritical: true,
        hasAlternativePath: true,
        alternativeNodeId: 'db-user-replica',
      },
      { infraNodeId: 'db-user-replica', role: 'data_store', isCritical: false },
    ],
  },
  {
    name: 'Fulfillment Commande',
    description: 'Traitement de commande et notifications clients',
    category: 'operations',
    estimatedCostPerHour: 1800,
    peakHoursMultiplier: 1.4,
    operatingDaysPerWeek: 7,
    operatingHoursPerDay: 24,
    source: 'cloud_tags',
    validatedByUser: true,
    nodes: [
      { infraNodeId: 'svc-api-gateway', role: 'entry_point', isCritical: true },
      { infraNodeId: 'svc-order', role: 'processing', isCritical: true },
      { infraNodeId: 'db-order', role: 'data_store', isCritical: true },
      { infraNodeId: 'sqs-notifications', role: 'notification', isCritical: false },
      { infraNodeId: 'svc-notification', role: 'processing', isCritical: false },
      { infraNodeId: 'sendgrid-api', role: 'external_dependency', isCritical: false },
    ],
  },
  {
    name: 'Parcours d achat client',
    description: 'Parcours complet du client, de la navigation au paiement et a la notification',
    category: 'revenue',
    estimatedCostPerHour: 2600,
    peakHoursMultiplier: 1.6,
    operatingDaysPerWeek: 7,
    operatingHoursPerDay: 18,
    source: 'manual',
    validatedByUser: true,
    nodes: [
      { infraNodeId: 'svc-api-gateway', role: 'entry_point', isCritical: true },
      { infraNodeId: 'svc-catalog', role: 'processing', isCritical: true },
      { infraNodeId: 'svc-order', role: 'processing', isCritical: true },
      { infraNodeId: 'svc-payment', role: 'processing', isCritical: true },
      { infraNodeId: 'svc-notification', role: 'notification', isCritical: false },
    ],
  },
  {
    name: 'Gestion des comptes',
    description: 'Gestion des comptes clients et operations administratives',
    category: 'operations',
    estimatedCostPerHour: 1100,
    peakHoursMultiplier: 1.3,
    operatingDaysPerWeek: 7,
    operatingHoursPerDay: 16,
    source: 'manual',
    validatedByUser: true,
    nodes: [
      { infraNodeId: 'svc-api-gateway', role: 'entry_point', isCritical: true },
      { infraNodeId: 'svc-user', role: 'processing', isCritical: true },
      { infraNodeId: 'svc-admin', role: 'processing', isCritical: false },
    ],
  },
  {
    name: 'Reporting BI',
    description: 'Flux de reporting interne et dashboards management',
    category: 'internal',
    estimatedCostPerHour: 220,
    peakHoursMultiplier: 1.2,
    operatingDaysPerWeek: 5,
    operatingHoursPerDay: 10,
    source: 'ai_suggested',
    aiConfidence: 0.72,
    validatedByUser: true,
    nodes: [
      { infraNodeId: 'svc-admin', role: 'entry_point', isCritical: true },
      { infraNodeId: 'db-admin', role: 'data_store', isCritical: true },
      { infraNodeId: 'datadog', role: 'notification', isCritical: false },
    ],
  },
];

const validatedBiaServiceSettings: Record<string, ValidatedBiaServiceSettings> = {
  'svc-payment': {
    validatedRTO: 4,
    validatedRPO: 1,
    validatedMTPD: 30,
    recoveryTier: 1,
    impactCategory: 'critical',
  },
  'svc-api-gateway': {
    validatedRTO: 10,
    validatedRPO: 3,
    validatedMTPD: 60,
    recoveryTier: 1,
    impactCategory: 'critical',
  },
  'svc-order': {
    validatedRTO: 30,
    validatedRPO: 10,
    validatedMTPD: 120,
    recoveryTier: 2,
    impactCategory: 'high',
  },
  'svc-user': {
    validatedRTO: 90,
    validatedRPO: 45,
    validatedMTPD: 240,
    recoveryTier: 2,
    impactCategory: 'high',
  },
  'svc-catalog': {
    validatedRTO: 360,
    validatedRPO: 120,
    validatedMTPD: 720,
    recoveryTier: 3,
    impactCategory: 'medium',
  },
  'svc-notification': {
    validatedRTO: 480,
    validatedRPO: 180,
    validatedMTPD: 960,
    recoveryTier: 3,
    impactCategory: 'medium',
  },
  'svc-admin': {
    validatedRTO: 720,
    validatedRPO: 240,
    validatedMTPD: 1_440,
    recoveryTier: 4,
    impactCategory: 'low',
  },
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function safeMultiplier(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function scaleNullableMoney(
  value: number | null | undefined,
  multiplier: number,
): number | null {
  if (!Number.isFinite(value as number)) return null;
  return roundMoney(Number(value) * multiplier);
}

function buildDemoBusinessFlowsForProfile(selection: DemoProfileSelection): DemoBusinessFlowDef[] {
  const baseAnnualRevenue = 200_000_000;
  const baseHourlyDowntimeCost = 50_000;

  const revenueMultiplier = safeMultiplier(
    selection.financials.annualRevenue / baseAnnualRevenue,
    1,
  );
  const hourlyMultiplier = safeMultiplier(
    selection.financials.hourlyDowntimeCost / baseHourlyDowntimeCost,
    1,
  );

  return demoBusinessFlows.map((flow) => ({
    ...flow,
    annualRevenue: scaleNullableMoney(flow.annualRevenue ?? null, revenueMultiplier),
    revenuePerTransaction: scaleNullableMoney(flow.revenuePerTransaction ?? null, revenueMultiplier),
    estimatedCostPerHour: null,
    slaPenaltyPerHour: scaleNullableMoney(flow.slaPenaltyPerHour ?? null, hourlyMultiplier),
    slaPenaltyFlat: scaleNullableMoney(flow.slaPenaltyFlat ?? null, hourlyMultiplier),
    customerLifetimeValue: scaleNullableMoney(flow.customerLifetimeValue ?? null, revenueMultiplier),
  }));
}

function buildValidatedBiaServiceOverrides(
  selection: DemoProfileSelection,
  availableNodeIds: ReadonlySet<string>,
): Record<string, ValidatedBiaServiceOverride> {
  const entries = Object.entries(validatedBiaServiceSettings).filter(([serviceId]) =>
    availableNodeIds.has(serviceId),
  );
  if (entries.length === 0) return {};

  const rawWeightTotal = entries.reduce(
    (sum, [, settings]) => sum + DEMO_BIA_RAW_WEIGHTS[settings.impactCategory],
    0,
  );
  const effectiveWeightTotal = rawWeightTotal > 0 ? rawWeightTotal : entries.length;
  const hourlyDowntimeCost = Math.max(1, selection.financials.hourlyDowntimeCost);
  let allocated = 0;

  return Object.fromEntries(
    entries.map(([serviceId, settings], index) => {
      const rawWeight =
        rawWeightTotal > 0
          ? DEMO_BIA_RAW_WEIGHTS[settings.impactCategory]
          : 1 / entries.length;
      const normalizedWeight = rawWeight / effectiveWeightTotal;
      const isLast = index === entries.length - 1;
      const financialImpactPerHour = isLast
        ? roundMoney(Math.max(0, hourlyDowntimeCost - allocated))
        : roundMoney(hourlyDowntimeCost * normalizedWeight);

      allocated += financialImpactPerHour;

      return [
        serviceId,
        {
          ...settings,
          financialImpactPerHour,
        },
      ] as const;
    }),
  );
}

async function seedDemoFinancialProfile(
  prisma: PrismaClient,
  tenantId: string,
  selection: DemoProfileSelection,
) {
  const annualRevenueUsd = roundMoney(
    CurrencyService.convertAmount(selection.financials.annualRevenue, 'EUR', 'USD'),
  );
  const sizeCategory = deriveOrganizationSizeCategoryFromDemoProfile(selection);
  const profileSource = selection.hasUserOverrides ? 'hybrid' : 'inferred';
  const profileConfidence = selection.hasUserOverrides ? 0.88 : 0.74;

  const annualRevenueSource = selection.fieldSources.annualRevenue;
  const employeeCountSource = selection.fieldSources.employeeCount;
  const annualITBudgetSource = selection.fieldSources.annualITBudget;
  const drBudgetPercentSource = selection.fieldSources.drBudgetPercent;
  const hourlyDowntimeSource = selection.fieldSources.hourlyDowntimeCost;

  const profileMetadata = {
    seededBy: 'demo-seed',
    note: `Demo profile: ${selection.companySizeLabel} - ${selection.sectorLabel}`,
    demoProfile: {
      sector: selection.sector,
      companySize: selection.companySize,
      sectorLabel: selection.sectorLabel,
      companySizeLabel: selection.companySizeLabel,
      hasUserOverrides: selection.hasUserOverrides,
    },
    fieldSources: {
      employeeCount: employeeCountSource,
      annualRevenue: annualRevenueSource,
      annualRevenueUSD: annualRevenueSource,
      annualITBudget: annualITBudgetSource,
      drBudgetPercent: drBudgetPercentSource,
      hourlyDowntimeCost: hourlyDowntimeSource,
      customDowntimeCostPerHour: hourlyDowntimeSource,
      industrySector: 'user_input',
      verticalSector: 'user_input',
    },
  } as const;

  await prisma.organizationProfile.upsert({
    where: { tenantId },
    create: {
      tenantId,
      sizeCategory,
      verticalSector: selection.verticalSector,
      industrySector: selection.industrySector,
      employeeCount: Math.round(selection.financials.employeeCount),
      annualRevenueUSD: annualRevenueUsd,
      annualRevenue: selection.financials.annualRevenue,
      annualITBudget: selection.financials.annualITBudget,
      drBudgetPercent: selection.financials.drBudgetPercent,
      hourlyDowntimeCost: selection.financials.hourlyDowntimeCost,
      profileSource,
      profileConfidence,
      profileMetadata,
      customDowntimeCostPerHour: selection.financials.hourlyDowntimeCost,
      customCurrency: 'EUR',
      strongholdPlanId: 'PRO',
      strongholdMonthlyCost: 800,
    },
    update: {
      sizeCategory,
      verticalSector: selection.verticalSector,
      industrySector: selection.industrySector,
      employeeCount: Math.round(selection.financials.employeeCount),
      annualRevenueUSD: annualRevenueUsd,
      annualRevenue: selection.financials.annualRevenue,
      annualITBudget: selection.financials.annualITBudget,
      drBudgetPercent: selection.financials.drBudgetPercent,
      hourlyDowntimeCost: selection.financials.hourlyDowntimeCost,
      profileSource,
      profileConfidence,
      profileMetadata,
      customDowntimeCostPerHour: selection.financials.hourlyDowntimeCost,
      customCurrency: 'EUR',
      strongholdPlanId: 'PRO',
      strongholdMonthlyCost: 800,
    },
  });
}

async function seedDemoBusinessFlows(
  prisma: PrismaClient,
  tenantId: string,
  selection: DemoProfileSelection,
) {
  const demoFlows = buildDemoBusinessFlowsForProfile(selection);
  const existingNodes = await prisma.infraNode.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const existingNodeIds = new Set(existingNodes.map((node) => node.id));

  await prisma.businessFlowNode.deleteMany({ where: { tenantId } });
  await prisma.businessFlow.deleteMany({ where: { tenantId } });

  const flowIds: string[] = [];
  let validatedFlows = 0;
  const flowEngine = new BusinessFlowFinancialEngineService(prisma);

  for (const flowDef of demoFlows) {
    const normalizedNodes = flowDef.nodes
      .filter((flowNode) => existingNodeIds.has(flowNode.infraNodeId))
      .map((flowNode) => {
        const hasAlternativePath = Boolean(
          flowNode.hasAlternativePath === true &&
            flowNode.alternativeNodeId &&
            existingNodeIds.has(flowNode.alternativeNodeId),
        );
        return {
          ...flowNode,
          hasAlternativePath,
          alternativeNodeId: hasAlternativePath ? flowNode.alternativeNodeId ?? null : null,
        };
      });

    if (normalizedNodes.length < 2) {
      continue;
    }

    const validatedByUser = flowDef.validatedByUser === true;
    const flow = await prisma.businessFlow.create({
      data: {
        tenantId,
        name: flowDef.name,
        description: flowDef.description,
        category: flowDef.category,
        annualRevenue: flowDef.annualRevenue ?? null,
        transactionsPerHour: flowDef.transactionsPerHour ?? null,
        revenuePerTransaction: flowDef.revenuePerTransaction ?? null,
        estimatedCostPerHour: flowDef.estimatedCostPerHour ?? null,
        peakHoursMultiplier: flowDef.peakHoursMultiplier ?? 1.5,
        peakHoursStart: flowDef.peakHoursStart ?? null,
        peakHoursEnd: flowDef.peakHoursEnd ?? null,
        operatingDaysPerWeek: flowDef.operatingDaysPerWeek ?? 5,
        operatingHoursPerDay: flowDef.operatingHoursPerDay ?? 10,
        slaUptimePercent: flowDef.slaUptimePercent ?? null,
        slaPenaltyPerHour: flowDef.slaPenaltyPerHour ?? null,
        slaPenaltyFlat: flowDef.slaPenaltyFlat ?? null,
        contractualRTO: flowDef.contractualRTO ?? null,
        estimatedCustomerChurnPerHour: flowDef.estimatedCustomerChurnPerHour ?? null,
        customerLifetimeValue: flowDef.customerLifetimeValue ?? null,
        reputationImpactCategory: flowDef.reputationImpactCategory ?? null,
        source: flowDef.source,
        aiConfidence: flowDef.aiConfidence ?? null,
        validatedByUser,
        validatedAt: validatedByUser ? new Date() : null,
        mutualExclusionGroup: flowDef.mutualExclusionGroup ?? null,
      },
    });

    await prisma.businessFlowNode.createMany({
      data: normalizedNodes.map((flowNode, orderIndex) => ({
        businessFlowId: flow.id,
        infraNodeId: flowNode.infraNodeId,
        tenantId,
        orderIndex,
        role: flowNode.role,
        isCritical: flowNode.isCritical !== false,
        hasAlternativePath: flowNode.hasAlternativePath === true,
        alternativeNodeId: flowNode.alternativeNodeId ?? null,
      })),
    });

    const recomputedFlow = await flowEngine.recalculateFlowComputedCost(tenantId, flow.id);
    if (!recomputedFlow) {
      await prisma.businessFlow.update({
        where: { id: flow.id },
        data: {
          calculatedCostPerHour: null,
          costCalculationMethod: 'not_estimable',
        },
      });
    }

    flowIds.push(flow.id);
    if (validatedByUser) validatedFlows += 1;
  }

  const hourlyMultiplier = safeMultiplier(selection.financials.hourlyDowntimeCost / 50_000, 1);
  const erpOverrideCost = roundMoney(12_000 * hourlyMultiplier);
  const hasErpNode = existingNodeIds.has('erp-server');
  if (hasErpNode) {
    await prisma.nodeFinancialOverride.upsert({
      where: {
        nodeId_tenantId: {
          nodeId: 'erp-server',
          tenantId,
        },
      },
      create: {
        tenantId,
        nodeId: 'erp-server',
        customCostPerHour: erpOverrideCost,
        justification: 'ERP legacy contractual penalties and manual processing fallback',
        validatedBy: 'demo.seed',
        validatedAt: new Date(),
      },
      update: {
        customCostPerHour: erpOverrideCost,
        justification: 'ERP legacy contractual penalties and manual processing fallback',
        validatedBy: 'demo.seed',
        validatedAt: new Date(),
      },
    });
  }

  const coverage = await flowEngine.calculateFlowsCoverage(tenantId);

  return {
    flowsCreated: flowIds.length,
    validatedFlows,
    unvalidatedFlows: flowIds.length - validatedFlows,
    coveragePercent: coverage.coveragePercent,
    coveredCriticalNodes: coverage.coveredCriticalNodes,
    totalCriticalNodes: coverage.totalCriticalNodes,
    userOverrides: hasErpNode ? 1 : 0,
  };
}

export async function runDemoSeed(
  prisma: PrismaClient,
  tenantId: string,
  options: RunDemoSeedOptions = {},
) {
  const demoProfileSelection = resolveDemoProfileSelection(options.profile);
  const generatedInfrastructure = generateDemoInfrastructure({
    sector: demoProfileSelection.sector,
    companySize: demoProfileSelection.companySize,
  });
  const availableNodeIds = new Set(
    generatedInfrastructure.nodes.map((node) => node.id),
  );
  const validatedBiaServiceOverrides = buildValidatedBiaServiceOverrides(
    demoProfileSelection,
    availableNodeIds,
  );

  appLogger.info(
    `Seeding demo environment "ShopMax" for ${demoProfileSelection.companySizeLabel} - ${demoProfileSelection.sectorLabel}...`,
  );
  appLogger.info(
    `Infrastructure layers: ${generatedInfrastructure.layers.join(', ')} ` +
      `(${generatedInfrastructure.nodes.length} nodes)`,
  );

  // Clean existing resilience data for this tenant
  appLogger.info('Cleaning existing data...');
  await prisma.riskNodeLink.deleteMany({ where: { risk: { tenantId } } }).catch(() => {});
  await prisma.riskMitigation.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.risk.deleteMany({ where: { tenantId, autoDetected: true } }).catch(() => {});
  await prisma.bIAProcess2.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.bIAReport2.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.graphAnalysis.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.businessFlowNode.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.businessFlow.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.nodeFinancialOverride.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.infraEdge.deleteMany({ where: { tenantId } });
  await prisma.infraNode.deleteMany({ where: { tenantId } });
  await prisma.simulation.deleteMany({ where: { tenantId } });
  await prisma.scanJob.deleteMany({ where: { tenantId } });

  appLogger.info(`Creating ${generatedInfrastructure.nodes.length} nodes...`);
  await prisma.infraNode.createMany({
    data: generatedInfrastructure.nodes.map((node) => ({
      id: node.id,
      externalId: node.externalId,
      name: node.name,
      type: node.type,
      provider: node.provider,
      region: node.region ?? null,
      availabilityZone: node.availabilityZone ?? null,
      tags: node.tags as Prisma.InputJsonValue,
      metadata: node.metadata as Prisma.InputJsonValue,
      tenantId,
      lastSeenAt: new Date(),
    })),
  });

  appLogger.info(
    `Creating ${generatedInfrastructure.confirmedEdges.length} confirmed edges...`,
  );
  await prisma.infraEdge.createMany({
    data: generatedInfrastructure.confirmedEdges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type,
      confidence: 1.0,
      confirmed: true,
      tenantId,
    })),
  });

  appLogger.info(
    `Creating ${generatedInfrastructure.inferredEdges.length} inferred edges...`,
  );
  await prisma.infraEdge.createMany({
    data: generatedInfrastructure.inferredEdges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type,
      confidence: edge.confidence ?? 0.5,
      inferenceMethod: edge.inferenceMethod ?? null,
      confirmed: false,
      tenantId,
    })),
  });

  const discoveredRegions = Array.from(
    new Set(
      generatedInfrastructure.nodes
        .map((node) => node.region)
        .filter((region): region is string => Boolean(region && region !== 'global')),
    ),
  );
  const cloudProviders = Array.from(
    new Set(
      generatedInfrastructure.nodes
        .map((node) => node.provider)
        .filter((provider) => provider === 'aws' || provider === 'azure' || provider === 'gcp'),
    ),
  );
  const kubernetesClusters = generatedInfrastructure.nodes
    .filter((node) => node.type === 'KUBERNETES_CLUSTER')
    .map((node) => node.id);
  const hasOnPremNodes = generatedInfrastructure.nodes.some(
    (node) => node.provider === 'on_premise',
  );

  appLogger.info('Creating completed scan job...');
  await prisma.scanJob.create({
    data: {
      status: 'completed',
      config: {
        providers: [
          ...cloudProviders.map((type) => ({
            type,
            regions: discoveredRegions,
          })),
          ...(kubernetesClusters.length > 0
            ? [{ type: 'kubernetes', clusters: kubernetesClusters }]
            : []),
          ...(hasOnPremNodes ? [{ type: 'on_premise', ipRanges: ['192.168.1.0/24'] }] : []),
        ],
      },
      progress: {
        totalAdapters:
          cloudProviders.length + (kubernetesClusters.length > 0 ? 1 : 0) + (hasOnPremNodes ? 1 : 0),
        completedAdapters:
          cloudProviders.length + (kubernetesClusters.length > 0 ? 1 : 0) + (hasOnPremNodes ? 1 : 0),
        nodesDiscovered: generatedInfrastructure.nodes.length,
        edgesDiscovered:
          generatedInfrastructure.confirmedEdges.length +
          generatedInfrastructure.inferredEdges.length,
      },
      result: {
        nodesCreated: generatedInfrastructure.nodes.length,
        edgesCreated: generatedInfrastructure.confirmedEdges.length,
        edgesInferred: generatedInfrastructure.inferredEdges.length,
        duration: 187000,
      },
      tenantId,
      startedAt: new Date(Date.now() - 187000),
      completedAt: new Date(),
    },
  });

  let resilienceScore = 0;
  let spofCount = 0;
  let biaProcessCount = 0;
  let risksDetected = 0;
  let runtimeInferredEdges = 0;
  let profileConfigured = false;
  let businessFlowSummary = {
    flowsCreated: 0,
    validatedFlows: 0,
    unvalidatedFlows: 0,
    coveragePercent: 0,
    coveredCriticalNodes: 0,
    totalCriticalNodes: 0,
    userOverrides: 0,
  };

  try {
    appLogger.info('Running post-seed graph analysis...');
    const pipeline = await runPostIngestionPipeline(prisma, tenantId, {
      inferDependencies: true,
    });
    runtimeInferredEdges = pipeline.inferredEdgesPersisted;

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order > 0 && pipeline.analysisReport) {
      const report = pipeline.analysisReport;

      resilienceScore = report.resilienceScore;
      spofCount = report.spofs.length;
      if (runtimeInferredEdges > 0) {
        appLogger.info(`Post-seed inference added ${runtimeInferredEdges} edge(s)`);
      }
      appLogger.info(`Graph analysis complete: score=${resilienceScore}, SPOFs=${spofCount}`);

      appLogger.info('Generating BIA...');
      const biaReport = generateBIA(graph, report);

      await prisma.bIAReport2.create({
        data: {
          generatedAt: biaReport.generatedAt,
          summary: biaReport.summary as Prisma.InputJsonValue,
          tenantId,
          processes: {
            create: biaReport.processes.map((processItem) => {
              const override = validatedBiaServiceOverrides[processItem.serviceNodeId];
              const isValidated = Boolean(override);
              const financialImpact = {
                ...processItem.financialImpact,
                ...(override
                  ? {
                      estimatedCostPerHour: override.financialImpactPerHour,
                      confidence: 'high',
                      note: 'Validated financial estimate seeded for ShopMax demo',
                    }
                  : {}),
              };
              const validatedRTO = isValidated
                ? override?.validatedRTO ?? processItem.suggestedRTO
                : null;
              const validatedRPO = isValidated
                ? override?.validatedRPO ?? processItem.suggestedRPO
                : null;
              const validatedMTPD = isValidated
                ? override?.validatedMTPD ?? processItem.suggestedMTPD
                : null;

              return {
                serviceNodeId: processItem.serviceNodeId,
                serviceName: processItem.serviceName,
                serviceType: processItem.serviceType,
                suggestedMAO: processItem.suggestedMAO,
                suggestedMTPD: processItem.suggestedMTPD,
                suggestedRTO: processItem.suggestedRTO,
                suggestedRPO: processItem.suggestedRPO,
                suggestedMBCO: processItem.suggestedMBCO,
                impactCategory: override?.impactCategory ?? processItem.impactCategory,
                criticalityScore: processItem.criticalityScore,
                recoveryTier: override?.recoveryTier ?? processItem.recoveryTier,
                dependencyChain: processItem.dependencyChain as unknown as Prisma.InputJsonValue,
                weakPoints: processItem.weakPoints as unknown as Prisma.InputJsonValue,
                financialImpact: financialImpact as unknown as Prisma.InputJsonValue,
                validatedRTO,
                validatedRPO,
                validatedMTPD,
                validationStatus: isValidated ? 'validated' : 'pending',
                tenantId,
              };
            }),
          },
        },
      });

      await Promise.all(
        biaReport.processes.map((processItem) => {
          const override = validatedBiaServiceOverrides[processItem.serviceNodeId];
          return prisma.infraNode.updateMany({
            where: { id: processItem.serviceNodeId, tenantId },
            data: {
              suggestedRTO: processItem.suggestedRTO,
              validatedRTO: override?.validatedRTO ?? null,
              suggestedRPO: processItem.suggestedRPO,
              validatedRPO: override?.validatedRPO ?? null,
              suggestedMTPD: processItem.suggestedMTPD,
              validatedMTPD: override?.validatedMTPD ?? null,
              impactCategory: override?.impactCategory ?? processItem.impactCategory,
              financialImpactPerHour:
                override?.financialImpactPerHour ?? processItem.financialImpact.estimatedCostPerHour,
            },
          });
        })
      );

      biaProcessCount = biaReport.processes.length;
      appLogger.info(`BIA generated: ${biaProcessCount} processes`);

      appLogger.info('Detecting risks...');
      const detectedRisks = detectRisks(graph, report);
      const validNodeIds = new Set(
        (await prisma.infraNode.findMany({ where: { tenantId }, select: { id: true } })).map((node) => node.id)
      );

      for (const risk of detectedRisks) {
        const createdRisk = await prisma.risk.create({
          data: {
            title: risk.title,
            description: risk.description,
            threatType: risk.category,
            probability: risk.probability,
            impact: risk.impact,
            status: 'open',
            autoDetected: true,
            detectionMethod: risk.detectionMethod,
            tenantId,
          },
        });

        const nodeLinks = risk.linkedNodeIds
          .filter((nodeId) => validNodeIds.has(nodeId))
          .map((nodeId) => ({ riskId: createdRisk.id, nodeId }));
        if (nodeLinks.length > 0) {
          await prisma.riskNodeLink.createMany({ data: nodeLinks });
        }

        const mitigations = risk.mitigations.map((mitigation) => ({
          riskId: createdRisk.id,
          description: mitigation.title,
          status: 'pending',
          tenantId,
        }));
        if (mitigations.length > 0) {
          await prisma.riskMitigation.createMany({ data: mitigations });
        }
      }

      risksDetected = detectedRisks.length;
      appLogger.info(`Risks detected: ${risksDetected}`);
    }
  } catch (error) {
    appLogger.error('Post-seed analysis failed (non-blocking):', error);
  }

  try {
    appLogger.info('Configuring demo financial profile...');
    await seedDemoFinancialProfile(prisma, tenantId, demoProfileSelection);
    profileConfigured = true;

    appLogger.info('Seeding business flows...');
    businessFlowSummary = await seedDemoBusinessFlows(
      prisma,
      tenantId,
      demoProfileSelection,
    );
    appLogger.info(
      `Business flows seeded: ${businessFlowSummary.flowsCreated} ` +
        `(validated=${businessFlowSummary.validatedFlows}, ` +
        `coverage=${businessFlowSummary.coveragePercent}%)`,
    );
  } catch (error) {
    appLogger.error('Business flow seed failed (non-blocking):', error);
  }

  void ensureBaselineSnapshot(prisma, tenantId, 'demo-seed').catch((error) => {
    appLogger.warn('Unable to ensure baseline snapshot after demo seed', {
      tenantId,
      message: error instanceof Error ? error.message : 'unknown',
    });
  });

  const summary = {
    nodes: generatedInfrastructure.nodes.length,
    confirmedEdges: generatedInfrastructure.confirmedEdges.length,
    inferredEdges: generatedInfrastructure.inferredEdges.length,
    runtimeInferredEdges,
    totalEdges:
      generatedInfrastructure.confirmedEdges.length +
      generatedInfrastructure.inferredEdges.length +
      runtimeInferredEdges,
    resilienceScore,
    spofCount,
    biaProcesses: biaProcessCount,
    risksDetected,
    organizationProfileConfigured: profileConfigured,
    businessFlows: businessFlowSummary.flowsCreated,
    validatedBusinessFlows: businessFlowSummary.validatedFlows,
    unvalidatedBusinessFlows: businessFlowSummary.unvalidatedFlows,
    flowCoveragePercent: businessFlowSummary.coveragePercent,
    userOverrides: businessFlowSummary.userOverrides,
    demoProfile: {
      sector: demoProfileSelection.sector,
      sectorLabel: demoProfileSelection.sectorLabel,
      companySize: demoProfileSelection.companySize,
      companySizeLabel: demoProfileSelection.companySizeLabel,
      hasUserOverrides: demoProfileSelection.hasUserOverrides,
      ...demoProfileSelection.financials,
    },
    infrastructureLayers: generatedInfrastructure.layers,
    spofs: generatedInfrastructure.spofNodeIds.map((nodeId) => {
      const node = generatedInfrastructure.nodes.find((item) => item.id === nodeId);
      return node ? `${node.name} (${nodeId})` : nodeId;
    }),
  };

  appLogger.info(
    `Demo environment "ShopMax" seeded successfully (${demoProfileSelection.sectorLabel} / ${demoProfileSelection.companySizeLabel})!`,
  );
  appLogger.info(`${summary.nodes} infrastructure nodes`);
  appLogger.info(`${summary.confirmedEdges} confirmed dependencies`);
  appLogger.info(
    `${summary.inferredEdges} inferred dependencies (seed) + ${summary.runtimeInferredEdges} inferred at runtime`,
  );
  appLogger.info(`Resilience score: ${resilienceScore}`);
  appLogger.info(`BIA processes: ${biaProcessCount}`);
  appLogger.info(`Auto-detected risks: ${risksDetected}`);
  appLogger.info(
    `Business flows: ${summary.businessFlows} (validated=${summary.validatedBusinessFlows}, ` +
      `coverage=${summary.flowCoveragePercent}%)`,
  );

  return summary;
}



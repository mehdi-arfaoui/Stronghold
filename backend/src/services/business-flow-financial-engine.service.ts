import type {
  BusinessFlow,
  OrganizationProfile,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import prisma from '../prismaClient.js';
import {
  FinancialEngineService,
  type FinancialNodeInput,
  type FinancialOrganizationProfileInput,
  type NodeFinancialOverrideInput,
} from './financial-engine.service.js';
import { resolveIncidentProbabilityForNodeType } from './company-financial-profile.service.js';
import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../constants/market-financial-data.js';
import { CurrencyService } from './currency.service.js';

export type FlowCostConfidence = 'high' | 'medium' | 'low';

export type FlowCost = {
  directCostPerHour: number;
  slaPenaltyPerHour: number;
  indirectCostPerHour: number;
  totalCostPerHour: number;
  peakCostPerHour: number;
  method: string;
  confidence: FlowCostConfidence;
  currency: SupportedCurrency;
};

export type FlowFinancialSnapshot = {
  flowId: string;
  hourlyDowntimeCost: number;
  aleAnnual: number;
  averageRtoHours: number;
  incidentProbabilityAnnual: number;
  servicesCount: number;
  sourceBreakdown: {
    userOverride: number;
    biaValidated: number;
    resourceEstimate: number;
  };
  estimable: boolean;
  message: string | null;
  computedCost: FlowCost | null;
  method:
    | 'direct_estimate'
    | 'annual_revenue'
    | 'transactional'
    | 'services_aggregate'
    | 'not_estimable';
  confidence: FlowCostConfidence;
  currency: SupportedCurrency;
};

export type NodeFlowImpact = {
  flowId: string;
  flowName: string;
  impact: 'blocked' | 'degraded' | 'minor';
  costContribution: number;
};

export type NodeCostMethod = 'business_flows' | 'fallback_estimate' | 'user_override';

export type NodeFlowCost = {
  nodeId: string;
  totalCostPerHour: number;
  totalPeakCostPerHour: number;
  impactedFlows: NodeFlowImpact[];
  fallbackEstimate: number | null;
  method: NodeCostMethod;
  confidence: FlowCostConfidence;
  currency: SupportedCurrency;
};

export type NodeFlowCostInput = {
  tenantId: string;
  nodeId: string;
  node?: FinancialNodeInput | null;
  orgProfile?: FinancialOrganizationProfileInput | OrganizationProfile | null;
  override?: NodeFinancialOverrideInput | null;
  includeUnvalidatedFlows?: boolean;
  applyCloudCostFactor?: boolean;
  sourceCurrency?: SupportedCurrency;
};

export type FinancialCoverageResult = {
  totalCriticalNodes: number;
  coveredCriticalNodes: number;
  uncoveredCriticalNodes: number;
  coveragePercent: number;
  uncoveredNodeIds: string[];
};

type FlowNodeWithFlow = Prisma.BusinessFlowNodeGetPayload<{
  include: {
    businessFlow: true;
  };
}>;

type FlowContribution = {
  flowId: string;
  flowName: string;
  groupKey: string | null;
  impact: 'blocked' | 'degraded' | 'minor';
  costContribution: number;
  peakContribution: number;
  validatedByUser: boolean;
  flowConfidence: FlowCostConfidence;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toPositive(value: number | null | undefined): number | null {
  if (!Number.isFinite(value as number)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function normalizeCurrency(rawCurrency: unknown): SupportedCurrency {
  if (typeof rawCurrency === 'string') {
    const normalized = rawCurrency.toUpperCase();
    if ((SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) {
      return normalized as SupportedCurrency;
    }
  }
  return 'EUR';
}

function convertCurrency(
  value: number,
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency,
): number {
  return roundMoney(
    CurrencyService.convertAmount(value, fromCurrency, toCurrency),
  );
}

function extractBiaHourlyCost(financialImpact: unknown): number | null {
  if (!financialImpact || typeof financialImpact !== 'object' || Array.isArray(financialImpact)) {
    return null;
  }

  const payload = financialImpact as Record<string, unknown>;
  const candidates = [
    payload.estimatedCostPerHour,
    payload.hourlyDowntimeCost,
    payload.totalCostPerHour,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function resolveRtoHours(
  flow: BusinessFlow,
  node: FinancialNodeInput,
  validatedProcess: {
    validatedRTO: number | null;
    suggestedRTO: number | null;
  } | null | undefined,
): number {
  const rawMinutes =
    validatedProcess?.validatedRTO ??
    validatedProcess?.suggestedRTO ??
    node.validatedRTO ??
    node.suggestedRTO ??
    flow.contractualRTO ??
    240;
  const minutes = Math.max(1, Number(rawMinutes || 240));
  return Number((minutes / 60).toFixed(2));
}

function resolveFallbackFlowRtoHours(flow: BusinessFlow): number {
  const minutes = Number(flow.contractualRTO);
  if (Number.isFinite(minutes) && minutes > 0) {
    return Number((minutes / 60).toFixed(2));
  }
  return 4;
}

function inferSnapshotConfidence(input: {
  method: FlowFinancialSnapshot['method'];
  hasUserOverride: boolean;
  hasBiaValidated: boolean;
  hasResourceEstimate: boolean;
  flowValidatedByUser: boolean;
}): FlowCostConfidence {
  if (input.method === 'not_estimable') return 'low';
  if (input.method !== 'services_aggregate') {
    return input.flowValidatedByUser ? 'high' : 'medium';
  }
  if (input.hasUserOverride) return 'high';
  if (input.hasBiaValidated) return input.flowValidatedByUser ? 'high' : 'medium';
  if (input.hasResourceEstimate) return 'low';
  return 'low';
}

function inferFlowConfidence(flow: BusinessFlow, method: string): FlowCostConfidence {
  if (flow.source === 'ai_suggested' && !flow.validatedByUser) return 'low';
  if (method === 'direct_estimate' || method === 'annual_revenue') return 'high';
  if (method === 'transactional') return 'medium';
  return flow.validatedByUser ? 'medium' : 'low';
}

function resolveFlowImpact(link: FlowNodeWithFlow): { impact: NodeFlowImpact['impact']; multiplier: number } {
  if (link.isCritical && !link.hasAlternativePath) {
    return { impact: 'blocked', multiplier: 1 };
  }
  if (link.isCritical && link.hasAlternativePath) {
    return { impact: 'degraded', multiplier: 0.2 };
  }
  return { impact: 'minor', multiplier: 0.05 };
}

function resolveCloudCostFactor(rawMetadata: unknown): number {
  if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) return 1;
  const metadata = rawMetadata as Record<string, unknown>;
  const rawCloudCost = metadata.cloudCost;
  if (!rawCloudCost || typeof rawCloudCost !== 'object' || Array.isArray(rawCloudCost)) return 1;
  const cloudCost = rawCloudCost as Record<string, unknown>;
  const monthlyCost = Number(cloudCost.monthlyTotalUSD);
  if (!Number.isFinite(monthlyCost) || monthlyCost <= 0) return 1;
  const factor = Math.log10(monthlyCost + 1) / 3;
  return clamp(factor, 0.2, 1.5);
}

function confidenceFromContributions(contributions: FlowContribution[]): FlowCostConfidence {
  if (contributions.length === 0) return 'low';
  const hasValidated = contributions.some((item) => item.validatedByUser);
  const hasLow = contributions.some((item) => item.flowConfidence === 'low');
  const hasMediumOrBetter = contributions.some((item) => item.flowConfidence !== 'low');
  if (hasValidated && !hasLow) return 'high';
  if (hasValidated || hasMediumOrBetter) return 'medium';
  return 'low';
}

export class BusinessFlowFinancialEngineService {
  private readonly prismaClient: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prismaClient = prismaClient;
  }

  static calculateFlowCostPerHour(
    flow: BusinessFlow,
    currency: SupportedCurrency = 'EUR',
    sourceCurrency: SupportedCurrency = 'EUR',
  ): FlowCost | null {
    const directEstimate = toPositive(flow.estimatedCostPerHour);
    const annualRevenue = toPositive(flow.annualRevenue);
    const transactionsPerHour = toPositive(flow.transactionsPerHour);
    const revenuePerTransaction = toPositive(flow.revenuePerTransaction);

    let directCostPerHour: number | null = null;
    let method = 'unknown';

    if (directEstimate != null) {
      directCostPerHour = directEstimate;
      method = 'direct_estimate';
    } else if (annualRevenue != null) {
      const operatingDaysPerWeek = Math.max(1, Math.floor(flow.operatingDaysPerWeek || 5));
      const operatingHoursPerDay = Math.max(1, Math.floor(flow.operatingHoursPerDay || 10));
      directCostPerHour = annualRevenue / (operatingDaysPerWeek * 52 * operatingHoursPerDay);
      method = 'annual_revenue';
    } else if (transactionsPerHour != null && revenuePerTransaction != null) {
      directCostPerHour = transactionsPerHour * revenuePerTransaction;
      method = 'transactional';
    }

    if (directCostPerHour == null) return null;

    const slaPenaltyPerHour = Math.max(0, Number(flow.slaPenaltyPerHour || 0));
    const churnPerHour = toPositive(flow.estimatedCustomerChurnPerHour) || 0;
    const lifetimeValue = toPositive(flow.customerLifetimeValue) || 0;
    const indirectCostPerHour = churnPerHour > 0 && lifetimeValue > 0 ? churnPerHour * lifetimeValue : 0;

    const totalCostPerHour = directCostPerHour + slaPenaltyPerHour + indirectCostPerHour;
    const peakMultiplier = Math.max(1, Number(flow.peakHoursMultiplier || 1.5));
    const peakCostPerHour = totalCostPerHour * peakMultiplier;
    const confidence = inferFlowConfidence(flow, method);

    return {
      directCostPerHour: convertCurrency(directCostPerHour, sourceCurrency, currency),
      slaPenaltyPerHour: convertCurrency(slaPenaltyPerHour, sourceCurrency, currency),
      indirectCostPerHour: convertCurrency(indirectCostPerHour, sourceCurrency, currency),
      totalCostPerHour: convertCurrency(totalCostPerHour, sourceCurrency, currency),
      peakCostPerHour: convertCurrency(peakCostPerHour, sourceCurrency, currency),
      method,
      confidence,
      currency,
    };
  }

  async calculateFlowFinancialSnapshot(input: {
    tenantId: string;
    flowId: string;
    preferredCurrency?: SupportedCurrency;
    sourceCurrency?: SupportedCurrency;
  }): Promise<FlowFinancialSnapshot | null> {
    const sourceCurrency = input.sourceCurrency ?? 'EUR';

    const [flow, profile] = await Promise.all([
      this.prismaClient.businessFlow.findFirst({
        where: { id: input.flowId, tenantId: input.tenantId },
        include: {
          flowNodes: {
            orderBy: { orderIndex: 'asc' },
            include: {
              infraNode: {
                include: {
                  inEdges: true,
                  outEdges: true,
                },
              },
            },
          },
        },
      }),
      this.prismaClient.organizationProfile.findUnique({
        where: { tenantId: input.tenantId },
        select: {
          sizeCategory: true,
          verticalSector: true,
          customDowntimeCostPerHour: true,
          customCurrency: true,
          hourlyDowntimeCost: true,
          annualITBudget: true,
          drBudgetPercent: true,
          strongholdPlanId: true,
          strongholdMonthlyCost: true,
        },
      }),
    ]);

    if (!flow) return null;

    const currency = input.preferredCurrency ?? normalizeCurrency(profile?.customCurrency);
    const flowDirectCost = BusinessFlowFinancialEngineService.calculateFlowCostPerHour(
      flow,
      currency,
      sourceCurrency,
    );

    const nodeIds = flow.flowNodes.map((entry) => entry.infraNodeId);
    const [latestBia, overrides] = nodeIds.length > 0
      ? await Promise.all([
          this.prismaClient.bIAReport2.findFirst({
            where: { tenantId: input.tenantId },
            orderBy: { createdAt: 'desc' },
            include: {
              processes: {
                where: {
                  validationStatus: 'validated',
                  serviceNodeId: { in: nodeIds },
                },
                select: {
                  serviceNodeId: true,
                  validatedRTO: true,
                  suggestedRTO: true,
                  financialImpact: true,
                },
              },
            },
          }),
          this.prismaClient.nodeFinancialOverride.findMany({
            where: {
              tenantId: input.tenantId,
              nodeId: { in: nodeIds },
            },
            select: {
              nodeId: true,
              customCostPerHour: true,
            },
          }),
        ])
      : [null, [] as Array<{ nodeId: string; customCostPerHour: number }>];

    const processByNodeId = new Map(
      (latestBia?.processes || []).map((process) => [
        process.serviceNodeId,
        process,
      ]),
    );
    const overrideByNodeId = new Map(
      overrides
        .filter((entry) => Number(entry.customCostPerHour) > 0)
        .map((entry) => [entry.nodeId, { customCostPerHour: Number(entry.customCostPerHour) }]),
    );

    const profileInput: FinancialOrganizationProfileInput = {
      sizeCategory: profile?.sizeCategory ?? 'midMarket',
      verticalSector: profile?.verticalSector ?? null,
      customDowntimeCostPerHour: profile?.customDowntimeCostPerHour ?? null,
      hourlyDowntimeCost: profile?.hourlyDowntimeCost ?? null,
      annualITBudget: profile?.annualITBudget ?? null,
      drBudgetPercent: profile?.drBudgetPercent ?? null,
      customCurrency: currency,
      strongholdPlanId: profile?.strongholdPlanId ?? null,
      strongholdMonthlyCost: profile?.strongholdMonthlyCost ?? null,
    };

    let aggregatedHourlyCost = 0;
    let userOverrideCount = 0;
    let biaValidatedCount = 0;
    let resourceEstimateCount = 0;

    const rtoHoursValues: number[] = [];
    const incidentProbabilityValues: number[] = [];

    for (const flowNode of flow.flowNodes) {
      const infraNode = flowNode.infraNode;
      const financialNode: FinancialNodeInput = {
        id: infraNode.id,
        name: infraNode.name,
        type: infraNode.type,
        provider: infraNode.provider,
        region: infraNode.region,
        isSPOF: infraNode.isSPOF,
        criticalityScore: infraNode.criticalityScore,
        redundancyScore: infraNode.redundancyScore,
        impactCategory: infraNode.impactCategory,
        suggestedRTO: infraNode.suggestedRTO,
        validatedRTO: infraNode.validatedRTO,
        suggestedRPO: infraNode.suggestedRPO,
        validatedRPO: infraNode.validatedRPO,
        suggestedMTPD: infraNode.suggestedMTPD,
        validatedMTPD: infraNode.validatedMTPD,
        metadata: infraNode.metadata,
        estimatedMonthlyCost: infraNode.estimatedMonthlyCost,
        dependentsCount: infraNode.inEdges.length,
        inEdges: infraNode.inEdges,
        outEdges: infraNode.outEdges,
      };
      const validatedProcess = processByNodeId.get(infraNode.id);
      const override = overrideByNodeId.get(infraNode.id);

      let nodeHourlyCost = 0;
      if (override?.customCostPerHour && override.customCostPerHour > 0) {
        nodeHourlyCost = roundMoney(override.customCostPerHour);
        userOverrideCount += 1;
      } else {
        const biaCostPerHour = extractBiaHourlyCost(validatedProcess?.financialImpact);
        if (biaCostPerHour && biaCostPerHour > 0) {
          nodeHourlyCost = convertCurrency(biaCostPerHour, sourceCurrency, currency);
          biaValidatedCount += 1;
        } else {
          const fallback = FinancialEngineService.calculateNodeFinancialImpact(
            financialNode,
            profileInput,
            override ?? undefined,
          );
          nodeHourlyCost = roundMoney(fallback.estimatedCostPerHour);
          if (nodeHourlyCost > 0) {
            resourceEstimateCount += 1;
          }
        }
      }

      if (!flowDirectCost) {
        aggregatedHourlyCost += nodeHourlyCost;
      }

      const rtoHours = resolveRtoHours(flow, financialNode, validatedProcess);
      rtoHoursValues.push(rtoHours);

      const incidentProbability = resolveIncidentProbabilityForNodeType(
        infraNode.type,
        undefined,
        infraNode.metadata,
      ).probabilityAnnual;
      if (incidentProbability > 0) {
        incidentProbabilityValues.push(incidentProbability);
      }
    }

    const hourlyDowntimeCost = flowDirectCost
      ? roundMoney(flowDirectCost.totalCostPerHour)
      : roundMoney(aggregatedHourlyCost);
    const servicesCount = flow.flowNodes.length;
    const averageRtoHours = Number(
      (
        rtoHoursValues.length > 0
          ? rtoHoursValues.reduce((sum, value) => sum + value, 0) / rtoHoursValues.length
          : resolveFallbackFlowRtoHours(flow)
      ).toFixed(2),
    );
    const incidentProbabilityAnnual = Number(
      (
        incidentProbabilityValues.length > 0
          ? incidentProbabilityValues.reduce((sum, value) => sum + value, 0) /
            incidentProbabilityValues.length
          : 0.03
      ).toFixed(4),
    );
    const aleAnnual = roundMoney(
      hourlyDowntimeCost * averageRtoHours * incidentProbabilityAnnual,
    );

    const estimable = hourlyDowntimeCost > 0;
    const fallbackComputedCost =
      estimable && !flowDirectCost
        ? {
            directCostPerHour: hourlyDowntimeCost,
            slaPenaltyPerHour: 0,
            indirectCostPerHour: 0,
            totalCostPerHour: hourlyDowntimeCost,
            peakCostPerHour: roundMoney(hourlyDowntimeCost * Math.max(1, Number(flow.peakHoursMultiplier || 1.5))),
            method: 'services_aggregate',
            confidence: inferSnapshotConfidence({
              method: 'services_aggregate',
              hasUserOverride: userOverrideCount > 0,
              hasBiaValidated: biaValidatedCount > 0,
              hasResourceEstimate: resourceEstimateCount > 0,
              flowValidatedByUser: flow.validatedByUser,
            }),
            currency,
          }
        : null;

    const method: FlowFinancialSnapshot['method'] = flowDirectCost
      ? (flowDirectCost.method as FlowFinancialSnapshot['method'])
      : estimable
        ? 'services_aggregate'
        : 'not_estimable';

    const confidence = flowDirectCost
      ? flowDirectCost.confidence
      : inferSnapshotConfidence({
          method,
          hasUserOverride: userOverrideCount > 0,
          hasBiaValidated: biaValidatedCount > 0,
          hasResourceEstimate: resourceEstimateCount > 0,
          flowValidatedByUser: flow.validatedByUser,
        });

    return {
      flowId: flow.id,
      hourlyDowntimeCost,
      aleAnnual,
      averageRtoHours,
      incidentProbabilityAnnual,
      servicesCount,
      sourceBreakdown: {
        userOverride: userOverrideCount,
        biaValidated: biaValidatedCount,
        resourceEstimate: resourceEstimateCount,
      },
      estimable,
      message: estimable
        ? null
        : 'Impact financier non estimable - validez le BIA des services de ce flux',
      computedCost: flowDirectCost ?? fallbackComputedCost,
      method,
      confidence,
      currency,
    };
  }

  async calculateNodeCostFromFlows(input: NodeFlowCostInput): Promise<NodeFlowCost> {
    const includeUnvalidatedFlows = input.includeUnvalidatedFlows !== false;
    const applyCloudCostFactor = input.applyCloudCostFactor === true;
    const profileCurrency = normalizeCurrency(input.orgProfile?.customCurrency);
    const sourceCurrency = input.sourceCurrency ?? 'EUR';

    const links = await this.prismaClient.businessFlowNode.findMany({
      where: {
        tenantId: input.tenantId,
        infraNodeId: input.nodeId,
        businessFlow: includeUnvalidatedFlows
          ? {
              tenantId: input.tenantId,
            }
          : {
              tenantId: input.tenantId,
              validatedByUser: true,
            },
      },
      include: {
        businessFlow: true,
      },
    });

    const fallbackContext = await this.resolveFallbackContext(input);
    const fallbackEstimate = fallbackContext
      ? this.computeFallbackEstimate(
          fallbackContext.node,
          fallbackContext.metadata,
          input.orgProfile,
          input.override,
          applyCloudCostFactor,
        )
      : null;

    const contributions: FlowContribution[] = [];
    for (const link of links) {
      const flowCost = BusinessFlowFinancialEngineService.calculateFlowCostPerHour(
        link.businessFlow,
        profileCurrency,
        sourceCurrency,
      );
      if (!flowCost) continue;

      const impact = resolveFlowImpact(link);
      const costContribution = flowCost.totalCostPerHour * impact.multiplier;
      const peakContribution = flowCost.peakCostPerHour * impact.multiplier;
      const groupKey =
        typeof link.businessFlow.mutualExclusionGroup === 'string' &&
        link.businessFlow.mutualExclusionGroup.trim().length > 0
          ? link.businessFlow.mutualExclusionGroup.trim()
          : null;

      contributions.push({
        flowId: link.businessFlow.id,
        flowName: link.businessFlow.name,
        groupKey,
        impact: impact.impact,
        costContribution: roundMoney(costContribution),
        peakContribution: roundMoney(peakContribution),
        validatedByUser: link.businessFlow.validatedByUser,
        flowConfidence: flowCost.confidence,
      });
    }

    const deduped = this.applyMutualExclusion(contributions);
    const totalCostPerHour = roundMoney(
      deduped.reduce((sum, item) => sum + item.costContribution, 0),
    );
    const totalPeakCostPerHour = roundMoney(
      deduped.reduce((sum, item) => sum + item.peakContribution, 0),
    );

    let method: NodeCostMethod = 'business_flows';
    let confidence: FlowCostConfidence = confidenceFromContributions(deduped);
    let finalCost = totalCostPerHour;
    let finalPeakCost = totalPeakCostPerHour;
    let finalFallback = fallbackEstimate;

    if (input.override?.customCostPerHour && input.override.customCostPerHour > 0) {
      method = 'user_override';
      confidence = 'high';
      finalCost = roundMoney(input.override.customCostPerHour);
      finalPeakCost = roundMoney(input.override.customCostPerHour);
      finalFallback = fallbackEstimate;
    } else if (deduped.length === 0 || totalCostPerHour <= 0) {
      method = 'fallback_estimate';
      confidence = 'low';
      finalCost = fallbackEstimate ?? 0;
      finalPeakCost = fallbackEstimate ?? 0;
    }

    return {
      nodeId: input.nodeId,
      totalCostPerHour: finalCost,
      totalPeakCostPerHour: finalPeakCost,
      impactedFlows: deduped.map((item) => ({
        flowId: item.flowId,
        flowName: item.flowName,
        impact: item.impact,
        costContribution: item.costContribution,
      })),
      fallbackEstimate: finalFallback,
      method,
      confidence,
      currency: profileCurrency,
    };
  }

  async calculateFlowsCoverage(tenantId: string): Promise<FinancialCoverageResult> {
    const criticalNodes = await this.prismaClient.infraNode.findMany({
      where: {
        tenantId,
        OR: [{ isSPOF: true }, { criticalityScore: { gte: 70 } }],
      },
      select: { id: true },
    });

    if (criticalNodes.length === 0) {
      return {
        totalCriticalNodes: 0,
        coveredCriticalNodes: 0,
        uncoveredCriticalNodes: 0,
        coveragePercent: 0,
        uncoveredNodeIds: [],
      };
    }

    const criticalNodeIds = criticalNodes.map((node) => node.id);
    const coverageRows = await this.prismaClient.businessFlowNode.findMany({
      where: {
        tenantId,
        infraNodeId: { in: criticalNodeIds },
      },
      select: {
        infraNodeId: true,
      },
      distinct: ['infraNodeId'],
    });

    const coveredSet = new Set(coverageRows.map((row) => row.infraNodeId));
    const uncoveredNodeIds = criticalNodeIds.filter((nodeId) => !coveredSet.has(nodeId));
    const coveredCriticalNodes = coveredSet.size;
    const totalCriticalNodes = criticalNodeIds.length;
    const coveragePercent =
      totalCriticalNodes > 0
        ? roundMoney((coveredCriticalNodes / totalCriticalNodes) * 100)
        : 0;

    return {
      totalCriticalNodes,
      coveredCriticalNodes,
      uncoveredCriticalNodes: uncoveredNodeIds.length,
      coveragePercent,
      uncoveredNodeIds,
    };
  }

  async recalculateFlowComputedCost(
    tenantId: string,
    flowId: string,
  ): Promise<BusinessFlow | null> {
    const snapshot = await this.calculateFlowFinancialSnapshot({
      tenantId,
      flowId,
      sourceCurrency: 'EUR',
    });
    if (!snapshot) return null;

    const updated = await this.prismaClient.businessFlow.update({
      where: { id: flowId },
      data: {
        calculatedCostPerHour: snapshot.estimable ? snapshot.hourlyDowntimeCost : null,
        costCalculationMethod: snapshot.method,
      },
    });
    return updated;
  }

  private applyMutualExclusion(contributions: FlowContribution[]): FlowContribution[] {
    if (contributions.length <= 1) return contributions;

    const bestByGroup = new Map<string, FlowContribution>();
    const result: FlowContribution[] = [];

    for (const contribution of contributions) {
      if (!contribution.groupKey) {
        result.push(contribution);
        continue;
      }

      const currentBest = bestByGroup.get(contribution.groupKey);
      if (!currentBest || contribution.costContribution > currentBest.costContribution) {
        bestByGroup.set(contribution.groupKey, contribution);
      }
    }

    for (const contribution of contributions) {
      if (!contribution.groupKey) continue;
      const selected = bestByGroup.get(contribution.groupKey);
      if (!selected || selected.flowId !== contribution.flowId) {
        result.push({
          ...contribution,
          costContribution: 0,
          peakContribution: 0,
        });
      } else {
        result.push(contribution);
      }
    }

    // Preserve stable ordering by contribution value then flow id.
    return result.sort((a, b) => {
      if (b.costContribution === a.costContribution) {
        return a.flowId.localeCompare(b.flowId);
      }
      return b.costContribution - a.costContribution;
    });
  }

  private async resolveFallbackContext(input: NodeFlowCostInput): Promise<{
    node: FinancialNodeInput;
    metadata: unknown;
  } | null> {
    if (input.node) {
      const infraNode = await this.prismaClient.infraNode.findFirst({
        where: { id: input.nodeId, tenantId: input.tenantId },
        select: { metadata: true },
      });
      return {
        node: input.node,
        metadata: infraNode?.metadata ?? null,
      };
    }

    const infraNode = await this.prismaClient.infraNode.findFirst({
      where: { id: input.nodeId, tenantId: input.tenantId },
      include: {
        inEdges: true,
        outEdges: true,
      },
    });

    if (!infraNode) return null;

    const node: FinancialNodeInput = {
      id: infraNode.id,
      name: infraNode.name,
      type: infraNode.type,
      provider: infraNode.provider,
      region: infraNode.region,
      isSPOF: infraNode.isSPOF,
      criticalityScore: infraNode.criticalityScore,
      redundancyScore: infraNode.redundancyScore,
      impactCategory: infraNode.impactCategory,
      suggestedRTO: infraNode.suggestedRTO,
      validatedRTO: infraNode.validatedRTO,
      suggestedRPO: infraNode.suggestedRPO,
      validatedRPO: infraNode.validatedRPO,
      suggestedMTPD: infraNode.suggestedMTPD,
      validatedMTPD: infraNode.validatedMTPD,
      metadata: infraNode.metadata,
      estimatedMonthlyCost: infraNode.estimatedMonthlyCost,
      dependentsCount: infraNode.inEdges.length,
      inEdges: infraNode.inEdges,
      outEdges: infraNode.outEdges,
    };

    return { node, metadata: infraNode.metadata };
  }

  private computeFallbackEstimate(
    node: FinancialNodeInput,
    metadata: unknown,
    orgProfile?: FinancialOrganizationProfileInput | OrganizationProfile | null,
    override?: NodeFinancialOverrideInput | null,
    applyCloudCostFactor = false,
  ): number {
    const fallback = FinancialEngineService.calculateNodeFinancialImpact(
      node,
      orgProfile,
      override,
    );
    const cloudFactor = applyCloudCostFactor ? resolveCloudCostFactor(metadata) : 1;
    return roundMoney(fallback.estimatedCostPerHour * cloudFactor);
  }
}

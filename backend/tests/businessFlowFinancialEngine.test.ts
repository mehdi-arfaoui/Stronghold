import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FinancialNodeInput } from '../src/services/financial-engine.service.js';
import { BusinessFlowFinancialEngineService } from '../src/services/business-flow-financial-engine.service.js';

function createNode(overrides: Partial<FinancialNodeInput> = {}): FinancialNodeInput {
  return {
    id: 'node-1',
    name: 'payments-db',
    type: 'DATABASE',
    provider: 'aws',
    region: 'eu-west-1',
    isSPOF: true,
    criticalityScore: 0.95,
    redundancyScore: 0.1,
    impactCategory: 'tier1_mission_critical',
    suggestedRTO: 120,
    validatedRTO: 120,
    suggestedRPO: 15,
    validatedRPO: 15,
    suggestedMTPD: 240,
    validatedMTPD: 240,
    dependentsCount: 6,
    inEdges: [],
    outEdges: [],
    ...overrides,
  };
}

test('calculateFlowCostPerHour supports annual revenue and penalties', () => {
  const flow = {
    id: 'flow-1',
    tenantId: 'tenant-1',
    name: 'Customer Payment',
    description: null,
    category: 'revenue',
    annualRevenue: 2_400_000,
    transactionsPerHour: null,
    revenuePerTransaction: null,
    estimatedCostPerHour: null,
    calculatedCostPerHour: null,
    costCalculationMethod: null,
    peakHoursMultiplier: 1.5,
    peakHoursStart: 9,
    peakHoursEnd: 18,
    operatingDaysPerWeek: 5,
    operatingHoursPerDay: 10,
    slaUptimePercent: 99.95,
    slaPenaltyPerHour: 500,
    slaPenaltyFlat: null,
    contractualRTO: null,
    estimatedCustomerChurnPerHour: 2,
    customerLifetimeValue: 2400,
    reputationImpactCategory: null,
    source: 'manual',
    aiConfidence: null,
    validatedByUser: true,
    validatedAt: null,
    mutualExclusionGroup: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as const;

  const cost = BusinessFlowFinancialEngineService.calculateFlowCostPerHour(flow);
  assert.ok(cost);
  assert.equal(cost.method, 'annual_revenue');
  assert.equal(cost.directCostPerHour, 923.08);
  assert.equal(cost.slaPenaltyPerHour, 500);
  assert.equal(cost.indirectCostPerHour, 4800);
  assert.equal(cost.totalCostPerHour, 6223.08);
  assert.equal(cost.peakCostPerHour, 9334.62);
});

test('calculateNodeCostFromFlows falls back when no business flow is linked', async () => {
  const service = new BusinessFlowFinancialEngineService({
    businessFlowNode: {
      findMany: async () => [],
    },
    infraNode: {
      findFirst: async () => ({ metadata: {} }),
    },
  } as any);

  const result = await service.calculateNodeCostFromFlows({
    tenantId: 'tenant-1',
    nodeId: 'node-1',
    node: createNode(),
    orgProfile: { sizeCategory: 'midMarket', customCurrency: 'EUR' },
  });

  assert.equal(result.method, 'fallback_estimate');
  assert.ok(result.totalCostPerHour > 0);
  assert.equal(result.impactedFlows.length, 0);
});

test('calculateNodeCostFromFlows aggregates flow contributions with degradation and mutual exclusion', async () => {
  const makeFlow = (id: string, name: string, hourlyCost: number, mutualExclusionGroup: string | null = null) =>
    ({
      id,
      tenantId: 'tenant-1',
      name,
      description: null,
      category: 'revenue',
      annualRevenue: null,
      transactionsPerHour: null,
      revenuePerTransaction: null,
      estimatedCostPerHour: hourlyCost,
      calculatedCostPerHour: null,
      costCalculationMethod: null,
      peakHoursMultiplier: 1.5,
      peakHoursStart: null,
      peakHoursEnd: null,
      operatingDaysPerWeek: 5,
      operatingHoursPerDay: 10,
      slaUptimePercent: null,
      slaPenaltyPerHour: null,
      slaPenaltyFlat: null,
      contractualRTO: null,
      estimatedCustomerChurnPerHour: null,
      customerLifetimeValue: null,
      reputationImpactCategory: null,
      source: 'manual',
      aiConfidence: null,
      validatedByUser: true,
      validatedAt: null,
      mutualExclusionGroup,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as const;

  const service = new BusinessFlowFinancialEngineService({
    businessFlowNode: {
      findMany: async () => [
        {
          isCritical: true,
          hasAlternativePath: false,
          businessFlow: makeFlow('flow-main', 'Payment - Card', 1000, 'payment'),
        },
        {
          isCritical: true,
          hasAlternativePath: false,
          businessFlow: makeFlow('flow-alt', 'Payment - Wire', 500, 'payment'),
        },
        {
          isCritical: true,
          hasAlternativePath: true,
          businessFlow: makeFlow('flow-onboarding', 'Onboarding', 400),
        },
        {
          isCritical: false,
          hasAlternativePath: false,
          businessFlow: makeFlow('flow-reporting', 'Reporting', 200),
        },
      ],
    },
    infraNode: {
      findFirst: async () => ({ metadata: {} }),
    },
  } as any);

  const result = await service.calculateNodeCostFromFlows({
    tenantId: 'tenant-1',
    nodeId: 'node-1',
    node: createNode(),
    orgProfile: { sizeCategory: 'midMarket', customCurrency: 'EUR' },
  });

  // 1000 (blocked) + 0 (mutually excluded flow) + 80 (degraded 20%) + 10 (minor 5%)
  assert.equal(result.method, 'business_flows');
  assert.equal(result.totalCostPerHour, 1090);
  assert.equal(result.totalPeakCostPerHour, 1635);
  assert.equal(result.confidence, 'high');
  assert.equal(result.impactedFlows.length, 4);
  assert.equal(
    result.impactedFlows.find((flow) => flow.flowId === 'flow-alt')?.costContribution,
    0,
  );
  assert.equal(
    result.impactedFlows.find((flow) => flow.flowId === 'flow-onboarding')?.impact,
    'degraded',
  );
});

test('calculateFlowsCoverage applies criticality threshold on 0..100 scale boundaries', async () => {
  const boundaryNodes = [
    { id: 'n-0', criticalityScore: 0, isSPOF: false },
    { id: 'n-0_7', criticalityScore: 0.7, isSPOF: false },
    { id: 'n-1', criticalityScore: 1, isSPOF: false },
    { id: 'n-69', criticalityScore: 69, isSPOF: false },
    { id: 'n-70', criticalityScore: 70, isSPOF: false },
    { id: 'n-71', criticalityScore: 71, isSPOF: false },
    { id: 'n-100', criticalityScore: 100, isSPOF: false },
  ];

  let observedThreshold: number | null = null;
  const service = new BusinessFlowFinancialEngineService({
    infraNode: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        const or = Array.isArray(where?.OR) ? where.OR : [];
        const criticalityCondition = or.find(
          (entry) => Boolean(entry) && typeof entry === 'object' && 'criticalityScore' in (entry as Record<string, unknown>),
        ) as { criticalityScore?: { gte?: number } } | undefined;
        observedThreshold = criticalityCondition?.criticalityScore?.gte ?? null;

        const threshold = observedThreshold ?? 70;
        return boundaryNodes
          .filter((node) => node.isSPOF || node.criticalityScore >= threshold)
          .map((node) => ({ id: node.id }));
      },
    },
    businessFlowNode: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        const nodeIds = ((where?.infraNodeId as { in?: string[] } | undefined)?.in ?? []);
        return nodeIds
          .filter((id) => id === 'n-70' || id === 'n-100')
          .map((infraNodeId) => ({ infraNodeId }));
      },
    },
  } as any);

  const coverage = await service.calculateFlowsCoverage('tenant-1');

  assert.equal(observedThreshold, 70);
  assert.equal(coverage.totalCriticalNodes, 3);
  assert.equal(coverage.coveredCriticalNodes, 2);
  assert.equal(coverage.uncoveredCriticalNodes, 1);
  assert.deepEqual(coverage.uncoveredNodeIds, ['n-71']);
  assert.equal(coverage.coveragePercent, 66.67);
});

test('calculateFlowFinancialSnapshot aggregates mapped service costs when flow has no direct business valuation', async () => {
  const service = new BusinessFlowFinancialEngineService({
    businessFlow: {
      findFirst: async () => ({
        id: 'flow-cloud',
        tenantId: 'tenant-1',
        name: 'Cloud Suggested Flow',
        description: null,
        category: 'operations',
        annualRevenue: null,
        transactionsPerHour: null,
        revenuePerTransaction: null,
        estimatedCostPerHour: null,
        calculatedCostPerHour: null,
        costCalculationMethod: null,
        peakHoursMultiplier: 1.5,
        peakHoursStart: null,
        peakHoursEnd: null,
        operatingDaysPerWeek: 5,
        operatingHoursPerDay: 10,
        slaUptimePercent: null,
        slaPenaltyPerHour: null,
        slaPenaltyFlat: null,
        contractualRTO: null,
        estimatedCustomerChurnPerHour: null,
        customerLifetimeValue: null,
        reputationImpactCategory: null,
        source: 'cloud_tags',
        aiConfidence: null,
        validatedByUser: false,
        validatedAt: null,
        mutualExclusionGroup: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        flowNodes: [
          {
            infraNodeId: 'node-db',
            infraNode: {
              id: 'node-db',
              name: 'orders-db',
              type: 'DATABASE',
              provider: 'aws',
              region: 'eu-west-1',
              isSPOF: true,
              criticalityScore: 0.95,
              redundancyScore: 0.2,
              impactCategory: 'tier1_mission_critical',
              suggestedRTO: 120,
              validatedRTO: 60,
              suggestedRPO: 15,
              validatedRPO: 10,
              suggestedMTPD: 240,
              validatedMTPD: 180,
              inEdges: [],
              outEdges: [],
            },
          },
          {
            infraNodeId: 'node-cache',
            infraNode: {
              id: 'node-cache',
              name: 'redis-main',
              type: 'CACHE',
              provider: 'aws',
              region: 'eu-west-1',
              isSPOF: false,
              criticalityScore: 0.7,
              redundancyScore: 0.5,
              impactCategory: 'tier2_business_critical',
              suggestedRTO: 180,
              validatedRTO: 120,
              suggestedRPO: 30,
              validatedRPO: 20,
              suggestedMTPD: 300,
              validatedMTPD: 240,
              inEdges: [],
              outEdges: [],
            },
          },
        ],
      }),
    },
    organizationProfile: {
      findUnique: async () => ({
        sizeCategory: 'midMarket',
        verticalSector: 'banking_finance',
        customDowntimeCostPerHour: null,
        customCurrency: 'EUR',
        hourlyDowntimeCost: 25000,
        annualITBudget: null,
        drBudgetPercent: null,
        strongholdPlanId: null,
        strongholdMonthlyCost: null,
      }),
    },
    bIAReport2: {
      findFirst: async () => ({
        processes: [
          {
            serviceNodeId: 'node-db',
            validatedRTO: 60,
            suggestedRTO: 120,
            financialImpact: { estimatedCostPerHour: 14000 },
          },
        ],
      }),
    },
    nodeFinancialOverride: {
      findMany: async () => [
        {
          nodeId: 'node-cache',
          customCostPerHour: 2200,
        },
      ],
    },
  } as any);

  const snapshot = await service.calculateFlowFinancialSnapshot({
    tenantId: 'tenant-1',
    flowId: 'flow-cloud',
  });

  assert.ok(snapshot);
  assert.equal(snapshot?.method, 'services_aggregate');
  assert.equal(snapshot?.estimable, true);
  assert.ok((snapshot?.hourlyDowntimeCost || 0) > 0);
  assert.ok((snapshot?.aleAnnual || 0) > 0);
  assert.equal(snapshot?.sourceBreakdown.biaValidated, 1);
  assert.equal(snapshot?.sourceBreakdown.userOverride, 1);
});

test('calculateFlowFinancialSnapshot returns non-estimable when a flow has no mapped service', async () => {
  const service = new BusinessFlowFinancialEngineService({
    businessFlow: {
      findFirst: async () => ({
        id: 'flow-empty',
        tenantId: 'tenant-1',
        name: 'Empty Flow',
        description: null,
        category: 'operations',
        annualRevenue: null,
        transactionsPerHour: null,
        revenuePerTransaction: null,
        estimatedCostPerHour: null,
        calculatedCostPerHour: null,
        costCalculationMethod: null,
        peakHoursMultiplier: 1.5,
        peakHoursStart: null,
        peakHoursEnd: null,
        operatingDaysPerWeek: 5,
        operatingHoursPerDay: 10,
        slaUptimePercent: null,
        slaPenaltyPerHour: null,
        slaPenaltyFlat: null,
        contractualRTO: null,
        estimatedCustomerChurnPerHour: null,
        customerLifetimeValue: null,
        reputationImpactCategory: null,
        source: 'cloud_tags',
        aiConfidence: null,
        validatedByUser: false,
        validatedAt: null,
        mutualExclusionGroup: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        flowNodes: [],
      }),
    },
    organizationProfile: {
      findUnique: async () => ({
        sizeCategory: 'midMarket',
        customCurrency: 'EUR',
      }),
    },
  } as any);

  const snapshot = await service.calculateFlowFinancialSnapshot({
    tenantId: 'tenant-1',
    flowId: 'flow-empty',
  });

  assert.ok(snapshot);
  assert.equal(snapshot?.estimable, false);
  assert.equal(snapshot?.method, 'not_estimable');
  assert.equal(
    snapshot?.message,
    'Impact financier non estimable - validez le BIA des services de ce flux',
  );
});

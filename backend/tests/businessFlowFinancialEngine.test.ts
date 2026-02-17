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

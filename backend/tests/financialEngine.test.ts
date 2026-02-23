import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FinancialEngineService } from '../src/services/financial-engine.service.js';

test('calculateNodeFinancialImpact uses user override when provided', () => {
  const result = FinancialEngineService.calculateNodeFinancialImpact(
    {
      id: 'node-1',
      name: 'db-primary',
      type: 'DATABASE',
      dependentsCount: 12,
    },
    {
      sizeCategory: 'enterprise',
      customCurrency: 'EUR',
    },
    {
      customCostPerHour: 125000,
    },
  );

  assert.equal(result.estimatedCostPerHour, 125000);
  assert.equal(result.confidence, 'user_defined');
});

test('calculateNodeFinancialImpact handles zero dependents with baseline minimum', () => {
  const result = FinancialEngineService.calculateNodeFinancialImpact(
    {
      id: 'node-2',
      name: 'api-gateway',
      type: 'API_GATEWAY',
      dependentsCount: 0,
    },
    {
      sizeCategory: 'midMarket',
      customCurrency: 'USD',
    },
  );

  assert.equal(result.breakdown.dependentsCount, 1);
  assert.ok(result.estimatedCostPerHour > 0);
});

test('calculateAnnualExpectedLoss returns zero when no SPOFs and no critical nodes', () => {
  const ale = FinancialEngineService.calculateAnnualExpectedLoss(
    {
      nodes: [
        {
          id: 'node-3',
          name: 'monitoring',
          type: 'MONITORING',
          isSPOF: false,
          criticalityScore: 0.2,
          dependentsCount: 1,
          suggestedRTO: 60,
        },
      ],
    },
    {
      processes: [
        {
          serviceNodeId: 'node-3',
          recoveryTier: 4,
          suggestedRTO: 60,
        },
      ],
    },
    {
      sizeCategory: 'midMarket',
      customCurrency: 'EUR',
    },
  );

  assert.equal(ale.totalALE, 0);
  assert.equal(ale.totalSPOFs, 0);
  assert.equal(ale.aleBySPOF.length, 0);
});

test('calculateAnnualExpectedLoss supports undefined organization profile', () => {
  const ale = FinancialEngineService.calculateAnnualExpectedLoss(
    {
      nodes: [
        {
          id: 'node-4',
          name: 'db-core',
          type: 'DATABASE',
          isSPOF: true,
          criticalityScore: 0.95,
          redundancyScore: 0,
          dependentsCount: 5,
          suggestedRTO: 180,
        },
      ],
    },
    {
      processes: [
        {
          serviceNodeId: 'node-4',
          recoveryTier: 1,
          suggestedRTO: 180,
        },
      ],
    },
    undefined,
  );

  assert.ok(ale.totalALE > 0);
  assert.equal(ale.totalSPOFs, 1);
  assert.equal(ale.currency, 'EUR');
});

test('calculateROI keeps projected ALE unchanged when no recommendations', () => {
  const roi = FinancialEngineService.calculateROI(
    {
      nodes: [
        {
          id: 'node-5',
          name: 'payments-db',
          type: 'DATABASE',
          isSPOF: true,
          criticalityScore: 0.98,
          redundancyScore: 0,
          dependentsCount: 6,
          suggestedRTO: 120,
        },
      ],
    },
    {
      processes: [
        {
          serviceNodeId: 'node-5',
          recoveryTier: 1,
          suggestedRTO: 120,
        },
      ],
    },
    [],
    {
      sizeCategory: 'midMarket',
      customCurrency: 'USD',
      strongholdMonthlyCost: 800,
    },
  );

  assert.equal(roi.currentALE, roi.projectedALE);
  assert.equal(roi.riskReductionAmount, 0);
  assert.equal(roi.annualRemediationCost, 0);
  assert.equal(roi.paybackMonths, null);
  assert.equal(roi.roiPercent, null);
  assert.equal(roi.roiStatus, 'non_applicable');
});

test('calculateDriftFinancialImpact estimates positive delta for redundancy loss', () => {
  const driftImpact = FinancialEngineService.calculateDriftFinancialImpact(
    {
      id: 'drift-1',
      type: 'config_changed',
      severity: 'high',
      description: 'Loss of replica and redundancy on db-primary',
      details: {},
      affectsSPOF: true,
      affectsRTO: true,
    },
    {
      isSPOF: false,
      hasRedundancy: true,
      rtoMinutes: 120,
      costPerHour: 6000,
    },
    {
      isSPOF: true,
      hasRedundancy: false,
      rtoMinutes: 480,
      costPerHour: 6000,
    },
  );

  assert.ok(driftImpact.financialImpact.additionalAnnualRisk > 0);
  assert.ok(driftImpact.financialImpact.rtoDelta > 0);
});

test('calculateROI marks negative recommendation ROI as cost exceeding avoided risk', () => {
  const roi = FinancialEngineService.calculateROI(
    {
      nodes: [
        {
          id: 'node-negative-roi',
          name: 'admin-service',
          type: 'APPLICATION',
          isSPOF: true,
          criticalityScore: 0.5,
          redundancyScore: 0,
          dependentsCount: 1,
          suggestedRTO: 600,
        },
      ],
    },
    {
      processes: [
        {
          serviceNodeId: 'node-negative-roi',
          recoveryTier: 3,
          suggestedRTO: 600,
          validatedRTO: 600,
        },
      ],
    },
    [
      {
        recommendationId: 'rec-negative',
        strategy: 'hot-standby',
        targetNodes: ['node-negative-roi'],
        annualCost: 150_000,
      },
    ],
    {
      customDowntimeCostPerHour: 1_500,
      hourlyDowntimeCost: 1_500,
      customCurrency: 'EUR',
    },
  );

  assert.equal(roi.breakdownByRecommendation.length, 1);
  assert.equal(roi.breakdownByRecommendation[0]?.roiStatus, 'cost_exceeds_avoided_risk');
  assert.equal(roi.breakdownByRecommendation[0]?.roiMessage, 'Cout superieur au risque evite');
  assert.ok((roi.breakdownByRecommendation[0]?.paybackMonths ?? 0) > 60);
  assert.ok((roi.breakdownByRecommendation[0]?.paybackMonths ?? 0) < 1_000);
  assert.equal(roi.breakdownByRecommendation[0]?.paybackLabel, 'Non rentable');
});

test('calculateROI filters recommendations that do not reduce ALE', () => {
  const roi = FinancialEngineService.calculateROI(
    {
      nodes: [
        {
          id: 'node-no-gain',
          name: 'legacy-service',
          type: 'APPLICATION',
          isSPOF: true,
          criticalityScore: 0.4,
          redundancyScore: 0,
          dependentsCount: 1,
          suggestedRTO: 30,
        },
      ],
    },
    {
      processes: [
        {
          serviceNodeId: 'node-no-gain',
          recoveryTier: 4,
          suggestedRTO: 30,
          validatedRTO: 30,
        },
      ],
    },
    [
      {
        recommendationId: 'rec-no-gain',
        strategy: 'backup-restore',
        targetNodes: ['node-no-gain'],
        targetRtoMinutes: 240,
        annualCost: 2_000,
      },
    ],
    {
      customDowntimeCostPerHour: 1_500,
      hourlyDowntimeCost: 1_500,
      customCurrency: 'EUR',
    },
  );

  assert.equal(roi.breakdownByRecommendation.length, 0);
  assert.equal(roi.currentALE, 0);
  assert.equal(roi.projectedALE, 0);
  assert.equal(roi.riskReductionAmount, 0);
  assert.equal(roi.annualRemediationCost, 0);
  assert.equal(roi.roiStatus, 'non_applicable');
});


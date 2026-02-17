import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FinancialEngineService } from '../src/services/financial-engine.service.js';

test('calculateAnnualExpectedLoss keeps legacy behavior when no resolved flow costs are provided', () => {
  const ale = FinancialEngineService.calculateAnnualExpectedLoss(
    {
      nodes: [
        {
          id: 'node-legacy',
          name: 'legacy-db',
          type: 'DATABASE',
          isSPOF: true,
          criticalityScore: 0.95,
          redundancyScore: 0.1,
          dependentsCount: 4,
          suggestedRTO: 120,
        },
      ],
    },
    {
      processes: [
        {
          serviceNodeId: 'node-legacy',
          recoveryTier: 1,
          suggestedRTO: 120,
        },
      ],
    },
    {
      sizeCategory: 'midMarket',
      customCurrency: 'EUR',
    },
  );

  assert.equal(ale.totalSPOFs, 1);
  assert.equal(ale.aleBySPOF[0]?.costMethod, 'legacy_estimate');
  assert.ok((ale.aleBySPOF[0]?.costPerHour || 0) > 0);
});

test('calculateAnnualExpectedLoss uses business flow resolved node costs when provided', () => {
  const ale = FinancialEngineService.calculateAnnualExpectedLoss(
    {
      nodes: [
        {
          id: 'node-flow',
          name: 'payments-db',
          type: 'DATABASE',
          isSPOF: true,
          criticalityScore: 0.95,
          redundancyScore: 0.1,
          dependentsCount: 4,
          suggestedRTO: 120,
        },
      ],
    },
    {
      processes: [
        {
          serviceNodeId: 'node-flow',
          recoveryTier: 1,
          suggestedRTO: 120,
        },
      ],
    },
    {
      sizeCategory: 'midMarket',
      customCurrency: 'EUR',
    },
    {},
    {
      'node-flow': {
        costPerHour: 12500,
        method: 'business_flows',
        confidence: 'high',
        fallbackEstimate: 6000,
        sources: ['Business flow financial model'],
      },
    },
  );

  assert.equal(ale.totalSPOFs, 1);
  assert.equal(ale.aleBySPOF[0]?.costPerHour, 12500);
  assert.equal(ale.aleBySPOF[0]?.costMethod, 'business_flows');
  assert.equal(ale.aleBySPOF[0]?.fallbackEstimate, 6000);
  assert.ok((ale.totalALE || 0) > 0);
});

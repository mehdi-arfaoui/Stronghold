import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRecommendationRoi,
  estimateServiceMonthlyProductionCost,
  resolveIncidentProbabilityForNodeType,
  selectDrStrategyForService,
} from '../src/services/company-financial-profile.service.js';

test('estimateServiceMonthlyProductionCost returns 0 DR infra cost for third-party services', () => {
  const cost = estimateServiceMonthlyProductionCost({
    type: 'THIRD_PARTY_API',
    provider: 'manual',
    metadata: {},
  });

  assert.equal(cost.estimatedMonthlyCost, 0);
  assert.equal(cost.costSource, 'cloud_type_reference');
  assert.ok(cost.confidence >= 0.9);
});

test('selectDrStrategyForService picks least costly strategy that satisfies strict RTO/RPO targets', () => {
  const selected = selectDrStrategyForService({
    targetRtoMinutes: 6,
    targetRpoMinutes: 4,
    criticality: 'critical',
    monthlyProductionCost: 1_000,
  });

  assert.equal(selected.strategy, 'hot_standby');
  assert.equal(selected.monthlyDrCost, 700);
  assert.equal(selected.annualDrCost, 8_400);
});

test('selectDrStrategyForService downgrades strategy when DR budget is exceeded', () => {
  const selected = selectDrStrategyForService({
    targetRtoMinutes: 6,
    targetRpoMinutes: 4,
    criticality: 'critical',
    monthlyProductionCost: 1_000,
    budgetRemainingMonthly: 450,
  });

  assert.equal(selected.strategy, 'warm_standby');
  assert.equal(selected.strategySource, 'budget_adjusted');
  assert.equal(selected.monthlyDrCost, 400);
  assert.equal(selected.annualDrCost, 4_800);
  assert.ok(selected.budgetWarning?.length);
});

test('calculateRecommendationRoi returns explicit non-applicable ROI when no risk is avoided', () => {
  const roi = calculateRecommendationRoi({
    hourlyDowntimeCost: 25_000,
    currentRtoMinutes: 5,
    targetRtoMinutes: 10,
    incidentProbabilityAnnual: 0.2,
    monthlyDrCost: 400,
  });

  assert.equal(roi.aleCurrent, 416.67);
  assert.equal(roi.aleAfter, 833.33);
  assert.equal(roi.riskAvoidedAnnual, -416.66);
  assert.equal(roi.roiPercent, null);
  assert.equal(roi.roiStatus, 'non_applicable');
  assert.equal(roi.paybackMonths, null);
  assert.equal(roi.paybackLabel, 'Non rentable');
});

test('resolveIncidentProbabilityForNodeType maps DATABASE to database outage probability', () => {
  const probability = resolveIncidentProbabilityForNodeType('DATABASE');
  assert.equal(probability.key, 'database');
  assert.equal(probability.probabilityAnnual, 0.12);
});


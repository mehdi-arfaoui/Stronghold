import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRecommendationRoi,
  estimateServiceMonthlyProductionCost,
  findNextImprovingStrategy,
  resolveIncidentProbabilityForNodeType,
  selectDrStrategyForService,
  strategyTargetRtoMinutes,
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

test('selectDrStrategyForService applies criticality fallback when RTO/RPO are missing', () => {
  const selected = selectDrStrategyForService({
    criticality: 'critical',
    monthlyProductionCost: 1_000,
  });

  assert.equal(selected.strategy, 'warm_standby');
  assert.equal(selected.monthlyDrCost, 400);
  assert.equal(selected.annualDrCost, 4_800);
});

test('selectDrStrategyForService maps medium RTO/RPO objectives to pilot light', () => {
  const selected = selectDrStrategyForService({
    targetRtoMinutes: 180,
    targetRpoMinutes: 45,
    criticality: 'medium',
    monthlyProductionCost: 1_000,
  });

  assert.equal(selected.strategy, 'pilot_light');
  assert.equal(selected.monthlyDrCost, 150);
  assert.equal(selected.annualDrCost, 1_800);
});

test('selectDrStrategyForService maps relaxed objectives to backup and restore', () => {
  const selected = selectDrStrategyForService({
    targetRtoMinutes: 480,
    targetRpoMinutes: 180,
    criticality: 'medium',
    monthlyProductionCost: 1_000,
  });

  assert.equal(selected.strategy, 'backup_restore');
  assert.equal(selected.monthlyDrCost, 50);
  assert.equal(selected.annualDrCost, 600);
});

test('selectDrStrategyForService enforces minimum monthly DR cost floors for low-cost services', () => {
  const backup = selectDrStrategyForService({
    targetRtoMinutes: 480,
    targetRpoMinutes: 180,
    criticality: 'medium',
    monthlyProductionCost: 10,
  });
  const active = selectDrStrategyForService({
    targetRtoMinutes: 1,
    targetRpoMinutes: 1,
    criticality: 'critical',
    monthlyProductionCost: 10,
  });

  assert.equal(backup.strategy, 'backup_restore');
  assert.equal(backup.monthlyDrCost, 20);
  assert.equal(active.strategy, 'active_active');
  assert.equal(active.monthlyDrCost, 1_050);
});

test('selectDrStrategyForService yields a mixed strategy set across varied service objectives', () => {
  const scenarios = [
    { criticality: 'critical' as const, targetRtoMinutes: 4, targetRpoMinutes: 1 },
    { criticality: 'critical' as const, targetRtoMinutes: 10, targetRpoMinutes: 3 },
    { criticality: 'high' as const, targetRtoMinutes: 25, targetRpoMinutes: 10 },
    { criticality: 'high' as const, targetRtoMinutes: 90, targetRpoMinutes: 45 },
    { criticality: 'medium' as const, targetRtoMinutes: 360, targetRpoMinutes: 120 },
  ];

  const selectedStrategies = scenarios.map((scenario) =>
    selectDrStrategyForService({
      ...scenario,
      monthlyProductionCost: 1_000,
    }).strategy,
  );

  assert.ok(new Set(selectedStrategies).size >= 3);
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

test('strategyTargetRtoMinutes uses strategy typical RTO values (not worst-case max)', () => {
  assert.equal(strategyTargetRtoMinutes('active_active'), 0.5);
  assert.equal(strategyTargetRtoMinutes('hot_standby'), 3);
  assert.equal(strategyTargetRtoMinutes('warm_standby'), 7.5);
  assert.equal(strategyTargetRtoMinutes('pilot_light'), 20);
  assert.equal(strategyTargetRtoMinutes('backup_restore'), 240);
});

test('findNextImprovingStrategy upgrades to the first strategy that improves current RTO', () => {
  assert.equal(findNextImprovingStrategy('backup_restore', 340), 'backup_restore');
  assert.equal(findNextImprovingStrategy('backup_restore', 120), 'pilot_light');
  assert.equal(findNextImprovingStrategy('pilot_light', 15), 'warm_standby');
  assert.equal(findNextImprovingStrategy('active_active', 0), null);
  assert.equal(findNextImprovingStrategy('active_active', 0.4), null);
});

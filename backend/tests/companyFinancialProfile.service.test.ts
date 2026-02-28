import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildServiceSpecificRecommendation,
  calculateRecommendationRoi,
  estimateServiceMonthlyProductionCost,
  findNextImprovingStrategy,
  resolveCompanyFinancialProfile,
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
  assert.equal(selected.monthlyDrCost, 650);
  assert.equal(selected.annualDrCost, 7_800);
});

test('selectDrStrategyForService applies criticality fallback when RTO/RPO are missing', () => {
  const selected = selectDrStrategyForService({
    criticality: 'critical',
    monthlyProductionCost: 1_000,
  });

  assert.equal(selected.strategy, 'warm_standby');
  assert.equal(selected.monthlyDrCost, 420);
  assert.equal(selected.annualDrCost, 5_040);
});

test('selectDrStrategyForService maps medium RTO/RPO objectives to pilot light', () => {
  const selected = selectDrStrategyForService({
    targetRtoMinutes: 180,
    targetRpoMinutes: 45,
    criticality: 'medium',
    monthlyProductionCost: 1_000,
  });

  assert.equal(selected.strategy, 'pilot_light');
  assert.equal(selected.monthlyDrCost, 200);
  assert.equal(selected.annualDrCost, 2_400);
});

test('selectDrStrategyForService maps relaxed objectives to backup and restore', () => {
  const selected = selectDrStrategyForService({
    targetRtoMinutes: 480,
    targetRpoMinutes: 180,
    criticality: 'medium',
    monthlyProductionCost: 1_000,
  });

  assert.equal(selected.strategy, 'backup_restore');
  assert.equal(selected.monthlyDrCost, 80);
  assert.equal(selected.annualDrCost, 960);
});

test('selectDrStrategyForService keeps DR cost proportional for low-cost services', () => {
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
  assert.equal(backup.monthlyDrCost, 5);
  assert.equal(active.strategy, 'active_active');
  assert.equal(active.monthlyDrCost, 120);
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
  assert.equal(selected.monthlyDrCost, 420);
  assert.equal(selected.annualDrCost, 5_040);
  assert.ok(selected.budgetWarning?.length);
});

test('selectDrStrategyForService applies service-native EC2 scaling cost for AWS single instance', () => {
  const selected = selectDrStrategyForService({
    criticality: 'high',
    monthlyProductionCost: 9.5,
    nodeType: 'VM',
    provider: 'aws',
    metadata: {
      sourceType: 'EC2',
      instanceType: 't3.micro',
      availabilityZone: 'eu-west-3a',
    },
  });

  assert.equal(selected.strategy, 'pilot_light');
  assert.equal(selected.monthlyDrCost, 2.09);
  assert.equal(selected.annualDrCost, 25.08);
});

test('selectDrStrategyForService applies service-native Multi-AZ uplift for single-AZ RDS', () => {
  const selected = selectDrStrategyForService({
    criticality: 'medium',
    monthlyProductionCost: 16,
    nodeType: 'DATABASE',
    provider: 'aws',
    metadata: {
      sourceType: 'RDS',
      dbInstanceClass: 'db.t3.micro',
      multi_az: false,
      replicaCount: 0,
    },
  });

  assert.equal(selected.strategy, 'warm_standby');
  assert.equal(selected.monthlyDrCost, 7.2);
  assert.equal(selected.annualDrCost, 86.4);
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
  assert.equal(probability.probabilityAnnual, 0.05);
});

test('estimateServiceMonthlyProductionCost uses AWS eu-west-3 references for known instance types', () => {
  const ec2Cost = estimateServiceMonthlyProductionCost(
    {
      type: 'VM',
      provider: 'aws',
      metadata: { sourceType: 'EC2', instanceType: 't3.micro' },
    },
    'USD',
  );

  assert.equal(ec2Cost.estimatedMonthlyCost, 8.5);
  assert.equal(ec2Cost.costSource, 'cloud_type_reference');
  assert.ok(ec2Cost.note.includes('eu-west-3'));

  const rdsCost = estimateServiceMonthlyProductionCost(
    {
      type: 'DATABASE',
      provider: 'aws',
      metadata: { sourceType: 'aws_rds_instance', dbInstanceClass: 'db.t3.micro' },
    },
    'USD',
  );

  assert.equal(rdsCost.estimatedMonthlyCost, 15);
  assert.ok(rdsCost.note.includes('(rds)'));

  const cacheCost = estimateServiceMonthlyProductionCost(
    {
      type: 'CACHE',
      provider: 'aws',
      metadata: { sourceType: 'aws_elasticache_cluster', cacheNodeType: 'cache.t3.micro' },
    },
    'USD',
  );

  assert.equal(cacheCost.estimatedMonthlyCost, 13);
  assert.ok(cacheCost.note.includes('(elasticache)'));
});

test('buildServiceSpecificRecommendation returns actionable AWS EC2 guidance with explicit cost', () => {
  const recommendation = buildServiceSpecificRecommendation({
    serviceName: 'api-server',
    nodeType: 'VM',
    provider: 'aws',
    metadata: { sourceType: 'EC2', instanceType: 't3.micro' },
    strategy: 'pilot_light',
    monthlyDrCost: 8.5,
    currency: 'EUR',
  });

  assert.ok(recommendation.action.includes('Auto Scaling Group'));
  assert.ok(recommendation.resilienceImpact.length > 20);
  assert.ok(recommendation.text.includes('8.50 EUR/mois'));
});

test('estimateServiceMonthlyProductionCost supports Azure and GCP provider pricing references', () => {
  const azureVmCost = estimateServiceMonthlyProductionCost(
    {
      type: 'VM',
      provider: 'azure',
      metadata: {
        sourceType: 'Microsoft.Compute/virtualMachines',
        vmSize: 'Standard_B1s',
      },
    },
    'EUR',
  );
  assert.equal(azureVmCost.estimatedMonthlyCost, 8.5);
  assert.equal(azureVmCost.costSource, 'cloud_type_reference');
  assert.ok(azureVmCost.note.toLowerCase().includes('azure'));

  const gcpComputeCost = estimateServiceMonthlyProductionCost(
    {
      type: 'VM',
      provider: 'gcp',
      metadata: {
        sourceType: 'compute.googleapis.com/Instance',
        machineType: 'e2-micro',
      },
    },
    'EUR',
  );
  assert.equal(gcpComputeCost.estimatedMonthlyCost, 7.5);
  assert.equal(gcpComputeCost.costSource, 'cloud_type_reference');
  assert.ok(gcpComputeCost.note.toLowerCase().includes('gcp'));
});

test('selectDrStrategyForService applies Azure/GCP native DR cost factors proportionally', () => {
  const azureVm = selectDrStrategyForService({
    criticality: 'high',
    monthlyProductionCost: 8.5,
    nodeType: 'VM',
    provider: 'azure',
    metadata: {
      sourceType: 'Microsoft.Compute/virtualMachines',
      vmSize: 'Standard_B1s',
    },
  });
  assert.equal(azureVm.strategy, 'pilot_light');
  assert.equal(azureVm.monthlyDrCost, 8.5);

  const gcpCloudSql = selectDrStrategyForService({
    criticality: 'critical',
    monthlyProductionCost: 10,
    nodeType: 'DATABASE',
    provider: 'gcp',
    metadata: {
      sourceType: 'CLOUD_SQL',
      availabilityType: 'ZONAL',
      tier: 'db-f1-micro',
    },
  });
  assert.equal(gcpCloudSql.strategy, 'warm_standby');
  assert.equal(gcpCloudSql.monthlyDrCost, 10);
});

test('buildServiceSpecificRecommendation returns provider-specific Azure/GCP remediation text', () => {
  const azureRecommendation = buildServiceSpecificRecommendation({
    serviceName: 'vm-app',
    nodeType: 'VM',
    provider: 'azure',
    metadata: {
      sourceType: 'Microsoft.Compute/virtualMachines',
      vmSize: 'Standard_B1s',
    },
    strategy: 'pilot_light',
    monthlyDrCost: 8.5,
    currency: 'EUR',
  });
  assert.ok(azureRecommendation.text.includes('VMSS'));

  const gcpRecommendation = buildServiceSpecificRecommendation({
    serviceName: 'orders-sql',
    nodeType: 'DATABASE',
    provider: 'gcp',
    metadata: {
      sourceType: 'CLOUD_SQL',
      availabilityType: 'ZONAL',
    },
    strategy: 'warm_standby',
    monthlyDrCost: 10,
    currency: 'EUR',
  });
  assert.ok(gcpRecommendation.text.includes('availability_type=REGIONAL'));
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

test('resolveCompanyFinancialProfile preserves suggested source traces from profile metadata', async () => {
  const prismaMock = {
    organizationProfile: {
      findUnique: async () => ({
        tenantId: 'tenant-1',
        sizeCategory: 'smb',
        customCurrency: 'EUR',
        annualRevenue: 25_000_000,
        annualRevenueUSD: null,
        employeeCount: 150,
        annualITBudget: 1_250_000,
        drBudgetPercent: 4,
        hourlyDowntimeCost: 15_000,
        customDowntimeCostPerHour: 15_000,
        industrySector: 'technology_saas',
        verticalSector: 'technology_saas',
        profileMetadata: {
          fieldSources: {
            annualRevenue: 'suggested',
            employeeCount: 'suggested',
            annualITBudget: 'suggested',
            drBudgetPercent: 'suggested',
            hourlyDowntimeCost: 'suggested',
          },
        },
      }),
    },
    bIAReport2: {
      findFirst: async () => ({
        processes: [],
      }),
    },
    infraNode: {
      count: async () => 20,
    },
  } as any;

  const resolved = await resolveCompanyFinancialProfile(prismaMock, 'tenant-1');
  assert.equal(resolved.fieldSources.annualRevenue?.source, 'suggested');
  assert.equal(resolved.fieldSources.employeeCount?.source, 'suggested');
  assert.equal(resolved.fieldSources.annualITBudget?.source, 'suggested');
  assert.equal(resolved.fieldSources.drBudgetPercent?.source, 'suggested');
  assert.equal(resolved.fieldSources.hourlyDowntimeCost?.source, 'suggested');
});

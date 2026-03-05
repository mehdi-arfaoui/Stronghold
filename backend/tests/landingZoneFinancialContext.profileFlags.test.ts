import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLandingZoneFinancialContext } from '../src/services/landing-zone-financial.service.js';

function createPrismaMock(hourlyDowntimeCost: number | null) {
  const profile = {
    tenantId: 'tenant-test',
    sizeCategory: 'midMarket',
    customCurrency: 'EUR',
    profileSource: 'inferred',
    annualRevenue: null,
    annualRevenueUSD: null,
    employeeCount: null,
    annualITBudget: null,
    drBudgetPercent: null,
    hourlyDowntimeCost,
    customDowntimeCostPerHour: hourlyDowntimeCost,
    industrySector: null,
    verticalSector: null,
    strongholdPlanId: null,
    strongholdMonthlyCost: null,
    profileMetadata: {
      fieldSources: {},
    },
  };

  return {
    organizationProfile: {
      findUnique: async (args?: { select?: Record<string, boolean> }) => {
        if (args?.select) {
          return {
            hourlyDowntimeCost,
            customDowntimeCostPerHour: hourlyDowntimeCost,
          };
        }
        return profile;
      },
    },
    infraNode: {
      findMany: async () => [],
    },
    infraEdge: {
      findMany: async () => [],
    },
  } as any;
}

test('buildLandingZoneFinancialContext exposes financialProfileConfigured=false when downtime cost is missing', async () => {
  const prismaMock = createPrismaMock(0);
  const context = await buildLandingZoneFinancialContext(prismaMock, 'tenant-financial-flag-missing');

  assert.equal(context.recommendations.length, 0);
  assert.equal(context.summary.financialProfileConfigured, false);
});

test('buildLandingZoneFinancialContext exposes financialProfileConfigured=true when downtime cost is set', async () => {
  const prismaMock = createPrismaMock(1_500);
  const context = await buildLandingZoneFinancialContext(prismaMock, 'tenant-financial-flag-configured');

  assert.equal(context.recommendations.length, 0);
  assert.equal(context.summary.financialProfileConfigured, true);
});

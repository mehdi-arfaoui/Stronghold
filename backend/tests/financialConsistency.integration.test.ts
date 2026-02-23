import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/prismaClient.js';
import { runDemoSeed } from '../src/services/demoSeedService.js';
import { buildLandingZoneFinancialContext } from '../src/services/landing-zone-financial.service.js';
import { buildFinancialSummaryPayload } from '../src/services/financial-dashboard.service.js';

test(
  'financial pipelines stay numerically aligned between recommendations and dashboard',
  { timeout: 180_000 },
  async (t) => {
    const apiKey = `test-financial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let tenant: { id: string } | null = null;
    try {
      tenant = await prisma.tenant.create({
        data: {
          name: `Financial consistency ${Date.now()}`,
          apiKey,
        },
        select: { id: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Can't reach database server")) {
        t.skip('Integration test skipped: local database is not reachable');
        return;
      }
      throw error;
    }

    try {
      await runDemoSeed(prisma, tenant.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Unique constraint failed on the fields: (`id`)')) {
        t.skip('Integration test skipped: demo seed uses globally unique node IDs already present');
        return;
      }
      throw error;
    }

    const [recommendationsContext, financialSummary] = await Promise.all([
      buildLandingZoneFinancialContext(prisma, tenant.id),
      buildFinancialSummaryPayload(prisma, tenant.id),
    ]);

    const annualDrCostRecommendations = recommendationsContext.summary.totalCostAnnual;
    const annualDrCostDashboard = financialSummary.roi.annualRemediationCost;
    const riskAvoidedRecommendations = recommendationsContext.summary.riskAvoidedAnnual;
    const riskAvoidedDashboard = financialSummary.roi.riskReductionAmount;

    const relativeDiff = (left: number, right: number) => {
      const baseline = Math.max(1, Math.abs(right));
      return Math.abs(left - right) / baseline;
    };

    assert.ok(relativeDiff(annualDrCostRecommendations, annualDrCostDashboard) < 0.01);
    assert.ok(relativeDiff(riskAvoidedRecommendations, riskAvoidedDashboard) < 0.01);

    const roiA = recommendationsContext.summary.roiPercent;
    const roiB = financialSummary.metrics.roiPercent;
    if (roiA != null && roiB != null) {
      assert.ok(relativeDiff(roiA, roiB) < 0.01);
    } else {
      assert.equal(roiA, roiB);
    }

    const distinctStrategies = new Set(
      recommendationsContext.recommendations.map((recommendation) => recommendation.strategy),
    );
    assert.ok(distinctStrategies.size >= 3);

    for (const recommendation of recommendationsContext.recommendations) {
      assert.notEqual(recommendation.paybackMonths, 999);
      assert.ok(recommendation.calculation.aleAfter < recommendation.calculation.aleCurrent);
      if ((recommendation.roi ?? 0) < 0) {
        assert.equal(recommendation.roiMessage, 'Cout superieur au risque evite');
      }
    }

    for (const breakdown of recommendationsContext.roi.breakdownByRecommendation) {
      assert.ok(breakdown.projectedALE < breakdown.currentALE);
    }
  },
);

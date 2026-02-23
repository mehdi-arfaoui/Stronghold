import { appLogger } from "../utils/logger.js";
// ============================================================
// Landing Zone Resilience Routes - Recovery recommendations
// ============================================================

import { Router } from "express";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import * as GraphService from "../graph/graphService.js";
import {
  acceptedFromStatus,
  buildLandingZoneFinancialContext,
  parsePersistedRecommendationState,
  type LandingZoneRecommendationStatus,
} from "../services/landing-zone-financial.service.js";

const router = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRecommendationStatus(value: unknown): LandingZoneRecommendationStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "pending" || normalized === "validated" || normalized === "rejected") {
    return normalized;
  }
  return null;
}

function resolveNextStatus(override: Record<string, unknown>): LandingZoneRecommendationStatus {
  const explicitStatus = normalizeRecommendationStatus(override.status);
  if (explicitStatus) return explicitStatus;

  if (override.accepted === true) return "validated";
  if (override.accepted === false) return "rejected";
  return "pending";
}

// --- GET /recommendations/landing-zone - Generate landing zone recommendations ---
router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const graph = await GraphService.getGraph(prisma, tenantId);
    if (graph.order === 0) {
      return res.status(400).json({ error: "Graph is empty. Run a discovery scan first." });
    }

    const context = await buildLandingZoneFinancialContext(prisma, tenantId);
    return res.json(context.recommendations);
  } catch (error) {
    appLogger.error("Error generating landing zone recommendations:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- PATCH /recommendations/landing-zone - Accept/reject recommendations ---
router.patch("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const rawOverrides = req.body?.overrides;
    if (!Array.isArray(rawOverrides)) {
      return res.status(400).json({ error: "overrides array is required" });
    }
    const overrides = rawOverrides
      .filter((override) => isRecord(override) && typeof override.serviceId === "string")
      .map((override) => ({
        serviceId: String(override.serviceId),
        status: override.status,
        accepted: override.accepted,
        notes: override.notes,
      }));

    if (overrides.length === 0) {
      return res.status(400).json({ error: "at least one valid override is required" });
    }

    const recommendationContext = await buildLandingZoneFinancialContext(prisma, tenantId);
    const recommendationByServiceId = new Map(
      recommendationContext.recommendations.map((recommendation) => [recommendation.id, recommendation]),
    );

    const targetServiceIds = Array.from(new Set(overrides.map((override) => override.serviceId)));
    const nodeSnapshots = await prisma.infraNode.findMany({
      where: {
        tenantId,
        id: { in: targetServiceIds },
      },
      select: {
        id: true,
        metadata: true,
      },
    });
    const nodeById = new Map(nodeSnapshots.map((node) => [node.id, node]));

    let updated = 0;
    let validated = 0;
    let rejected = 0;
    let pending = 0;

    for (const override of overrides) {
      const recommendation = recommendationByServiceId.get(override.serviceId);
      if (!recommendation) continue;

      const node = nodeById.get(override.serviceId);
      const currentMetadata = isRecord(node?.metadata) ? { ...node.metadata } : {};
      const currentState = parsePersistedRecommendationState(currentMetadata);
      const nextStatus = resolveNextStatus(override);
      const notes =
        override.notes === undefined
          ? currentState.notes
          : override.notes === null
            ? null
            : String(override.notes);
      const changed = nextStatus !== currentState.status || notes !== currentState.notes;
      const changedAt = new Date().toISOString();

      const history = changed
        ? [
            ...currentState.history,
            {
              from: currentState.status,
              to: nextStatus,
              changedAt,
              notes,
            },
          ]
        : currentState.history;

      const nextMetadata: Record<string, unknown> = {
        ...currentMetadata,
        landingZoneAccepted: acceptedFromStatus(nextStatus),
        landingZoneRecommendation: {
          status: nextStatus,
          notes,
          updatedAt: changed ? changedAt : currentState.updatedAt ?? changedAt,
          history,
        },
      };

      if (nextStatus === "validated" && recommendation.strategy) {
        nextMetadata.recoveryStrategy = recommendation.strategy;
      }

      const updateResult = await prisma.infraNode.updateMany({
        where: { id: override.serviceId, tenantId },
        data: {
          metadata: JSON.parse(JSON.stringify(nextMetadata)),
        },
      });

      if (updateResult.count > 0) {
        updated += updateResult.count;
        if (nextStatus === "validated") validated += 1;
        if (nextStatus === "rejected") rejected += 1;
        if (nextStatus === "pending") pending += 1;
      }

      if (changed) {
        appLogger.info("landing_zone.recommendation_status_changed", {
          tenantId,
          serviceId: override.serviceId,
          from: currentState.status,
          to: nextStatus,
          changedAt,
        });
      }
    }

    return res.json({
      updated,
      validated,
      rejected,
      pending,
    });
  } catch (error) {
    appLogger.error("Error updating landing zone recommendations:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /recommendations/landing-zone/cost-summary - Cost breakdown ---
router.get("/cost-summary", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const graph = await GraphService.getGraph(prisma, tenantId);
    if (graph.order === 0) {
      return res.status(400).json({ error: "Graph is empty. Run a discovery scan first." });
    }

    const context = await buildLandingZoneFinancialContext(prisma, tenantId);
    return res.json({
      totalCost: context.summary.totalCostMonthly,
      totalAnnualCost: context.summary.totalCostAnnual,
      byStrategy: context.summary.byStrategy,
      annualCostByStrategy: context.summary.annualCostByStrategy,
      costSharePercentByStrategy: context.summary.costSharePercentByStrategy,
      totalRecommendations: context.summary.totalRecommendations,
      riskAvoidedAnnual: context.summary.riskAvoidedAnnual,
      roiPercent: context.summary.roiPercent,
      paybackMonths: context.summary.paybackMonths,
      paybackLabel: context.summary.paybackLabel,
      currency: context.profile.currency,
      budgetAnnual: context.profile.estimatedDrBudgetAnnual,
      financialDisclaimers: context.financialDisclaimers,
    });
  } catch (error) {
    appLogger.error("Error generating cost summary:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

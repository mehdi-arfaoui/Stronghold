import { appLogger } from "../utils/logger.js";
// ============================================================
// Landing Zone Resilience Routes — Recovery recommendations
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';
import { generateLandingZoneRecommendations } from '../graph/landingZoneService.js';

const router = Router();

type LandingZoneRecommendationStatus = 'pending' | 'validated' | 'rejected';

type RecommendationStatusHistoryEntry = {
  from: LandingZoneRecommendationStatus;
  to: LandingZoneRecommendationStatus;
  changedAt: string;
  notes: string | null;
};

type PersistedRecommendationState = {
  status: LandingZoneRecommendationStatus;
  notes: string | null;
  updatedAt: string | null;
  history: RecommendationStatusHistoryEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecommendationStatus(value: unknown): LandingZoneRecommendationStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'pending' || normalized === 'validated' || normalized === 'rejected') {
    return normalized;
  }
  return null;
}

function acceptedFromStatus(status: LandingZoneRecommendationStatus): boolean | null {
  if (status === 'validated') return true;
  if (status === 'rejected') return false;
  return null;
}

function parsePersistedRecommendationState(metadata: unknown): PersistedRecommendationState {
  if (!isRecord(metadata)) {
    return { status: 'pending', notes: null, updatedAt: null, history: [] };
  }

  const persisted = isRecord(metadata.landingZoneRecommendation)
    ? metadata.landingZoneRecommendation
    : null;

  const statusFromBlock = normalizeRecommendationStatus(persisted?.status);
  const legacyAccepted = metadata.landingZoneAccepted;
  const statusFromLegacy =
    typeof legacyAccepted === 'boolean'
      ? legacyAccepted
        ? 'validated'
        : 'rejected'
      : 'pending';

  const status = statusFromBlock ?? statusFromLegacy;
  const notes = typeof persisted?.notes === 'string' ? persisted.notes : null;
  const updatedAt = typeof persisted?.updatedAt === 'string' ? persisted.updatedAt : null;
  const history = Array.isArray(persisted?.history)
    ? persisted.history.filter((entry): entry is RecommendationStatusHistoryEntry => {
        if (!isRecord(entry)) return false;
        return (
          normalizeRecommendationStatus(entry.from) !== null &&
          normalizeRecommendationStatus(entry.to) !== null &&
          typeof entry.changedAt === 'string'
        );
      }).map((entry) => ({
        from: normalizeRecommendationStatus(entry.from)!,
        to: normalizeRecommendationStatus(entry.to)!,
        changedAt: entry.changedAt,
        notes: typeof entry.notes === 'string' ? entry.notes : null,
      }))
    : [];

  return { status, notes, updatedAt, history };
}

function resolveNextStatus(override: Record<string, unknown>): LandingZoneRecommendationStatus {
  const explicitStatus = normalizeRecommendationStatus(override.status);
  if (explicitStatus) return explicitStatus;

  if (override.accepted === true) return 'validated';
  if (override.accepted === false) return 'rejected';
  return 'pending';
}

// ─── GET /recommendations/landing-zone — Generate landing zone recommendations ──────────
router.get('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const analysis = await analyzeFullGraph(graph);
    const bia = generateBIA(graph, analysis);
    const report = generateLandingZoneRecommendations(bia, analysis);
    const serviceIds = report.recommendations.map((rec) => rec.serviceId);
    const nodeSnapshots = serviceIds.length
      ? await prisma.infraNode.findMany({
          where: {
            tenantId,
            id: { in: serviceIds },
          },
          select: {
            id: true,
            metadata: true,
          },
        })
      : [];
    const recommendationStateByServiceId = new Map(
      nodeSnapshots.map((snapshot) => [snapshot.id, parsePersistedRecommendationState(snapshot.metadata)]),
    );

    // Transform to frontend Recommendation[] format
    const recommendations = report.recommendations.map(rec => {
      const strategyMap: Record<string, string> = {
        active_active: 'active-active',
        warm_standby: 'warm-standby',
        pilot_light: 'pilot-light',
        backup_restore: 'backup',
      };
      const state = recommendationStateByServiceId.get(rec.serviceId) ?? {
        status: 'pending',
        notes: null,
        updatedAt: null,
        history: [],
      };
      return {
        id: rec.serviceId,
        nodeId: rec.serviceId,
        serviceName: rec.serviceName,
        tier: rec.recoveryTier,
        strategy: strategyMap[rec.strategy.type] || rec.strategy.type,
        estimatedCost: rec.estimatedCost,
        roi: rec.estimatedCost > 0
          ? Math.round((rec.riskOfInaction * 720 / rec.estimatedCost) * 10) / 10
          : 0,
        accepted: acceptedFromStatus(state.status),
        status: state.status,
        statusUpdatedAt: state.updatedAt,
        statusHistory: state.history,
        description: rec.strategy.description,
        priority: rec.priorityScore,
        notes: state.notes,
      };
    });

    return res.json(recommendations);
  } catch (error) {
    appLogger.error('Error generating landing zone recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /recommendations/landing-zone — Accept/reject recommendations ──────────
router.patch('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const rawOverrides = req.body?.overrides;
    if (!Array.isArray(rawOverrides)) {
      return res.status(400).json({ error: 'overrides array is required' });
    }
    const overrides = rawOverrides
      .filter((override) => isRecord(override) && typeof override.serviceId === 'string')
      .map((override) => ({
        serviceId: String(override.serviceId),
        status: override.status,
        accepted: override.accepted,
        notes: override.notes,
      }));

    if (overrides.length === 0) {
      return res.status(400).json({ error: 'at least one valid override is required' });
    }

    // Generate current recommendations
    const graph = await GraphService.getGraph(prisma, tenantId);
    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty.' });
    }

    const analysis = await analyzeFullGraph(graph);
    const bia = generateBIA(graph, analysis);
    const report = generateLandingZoneRecommendations(bia, analysis);
    const recommendationByServiceId = new Map(
      report.recommendations.map((recommendation) => [recommendation.serviceId, recommendation]),
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

      if (nextStatus === 'validated' && recommendation.strategy) {
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
        if (nextStatus === 'validated') validated += 1;
        if (nextStatus === 'rejected') rejected += 1;
        if (nextStatus === 'pending') pending += 1;
      }

      if (changed) {
        appLogger.info('landing_zone.recommendation_status_changed', {
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
    appLogger.error('Error updating landing zone recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /recommendations/landing-zone/cost-summary — Cost breakdown ──────────
router.get('/cost-summary', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const analysis = await analyzeFullGraph(graph);
    const bia = generateBIA(graph, analysis);
    const report = generateLandingZoneRecommendations(bia, analysis);

    const strategyMap: Record<string, string> = {
      active_active: 'active-active',
      warm_standby: 'warm-standby',
      pilot_light: 'pilot-light',
      backup_restore: 'backup',
    };

    const byStrategy: Record<string, number> = {};
    for (const rec of report.recommendations) {
      const key = strategyMap[rec.strategy.type] || rec.strategy.type;
      byStrategy[key] = (byStrategy[key] || 0) + 1;
    }

    return res.json({
      totalCost: report.summary.estimatedTotalCost,
      byStrategy,
      totalRecommendations: report.recommendations.length,
    });
  } catch (error) {
    appLogger.error('Error generating cost summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

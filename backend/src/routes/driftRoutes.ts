import { appLogger } from "../utils/logger.js";
// ============================================================
// Drift Detection Routes
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import {
  runDriftCheck,
  calculateResilienceScore,
} from '../drift/driftDetectionService.js';
import { FinancialEngineService } from '../services/financial-engine.service.js';
import { CurrencyService } from '../services/currency.service.js';

const router = Router();

// ─── Rate limiter: max 5 drift checks per hour per tenant ──────────
const driftCheckBuckets = new Map<string, { count: number; resetAt: number }>();
const DRIFT_CHECK_MAX = 5;
const DRIFT_CHECK_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkDriftRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const bucket = driftCheckBuckets.get(tenantId);
  if (!bucket || now >= bucket.resetAt) {
    driftCheckBuckets.set(tenantId, { count: 1, resetAt: now + DRIFT_CHECK_WINDOW_MS });
    return true;
  }
  if (bucket.count >= DRIFT_CHECK_MAX) return false;
  bucket.count++;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function deriveDriftStates(
  event: {
    type: string;
    description: string;
    affectsSPOF: boolean;
    affectsRTO: boolean;
  },
  details: Record<string, unknown>,
  costPerHour: number,
) {
  const previousDetails = firstRecord(
    details.previousState,
    details.previous,
    details.before,
    details.oldValue,
  );
  const currentDetails = firstRecord(
    details.currentState,
    details.current,
    details.after,
    details.newValue,
  );

  const previousState = {
    isSPOF: asBoolean(previousDetails.isSPOF) ?? false,
    hasRedundancy: asBoolean(previousDetails.hasRedundancy) ?? true,
    rtoMinutes: asNumber(previousDetails.rtoMinutes) ?? asNumber(details.previousRTO) ?? 120,
    rpoMinutes: asNumber(previousDetails.rpoMinutes) ?? asNumber(details.previousRPO) ?? 60,
    inPRARegion: asBoolean(previousDetails.inPRARegion) ?? true,
    inBIA: asBoolean(previousDetails.inBIA) ?? true,
    hasBackup: asBoolean(previousDetails.hasBackup) ?? true,
    costPerHour,
  };

  const currentState = {
    isSPOF: asBoolean(currentDetails.isSPOF) ?? previousState.isSPOF,
    hasRedundancy: asBoolean(currentDetails.hasRedundancy) ?? previousState.hasRedundancy,
    rtoMinutes: asNumber(currentDetails.rtoMinutes) ?? asNumber(details.currentRTO) ?? previousState.rtoMinutes,
    rpoMinutes: asNumber(currentDetails.rpoMinutes) ?? asNumber(details.currentRPO) ?? previousState.rpoMinutes,
    inPRARegion: asBoolean(currentDetails.inPRARegion) ?? previousState.inPRARegion,
    inBIA: asBoolean(currentDetails.inBIA) ?? previousState.inBIA,
    hasBackup: asBoolean(currentDetails.hasBackup) ?? previousState.hasBackup,
    costPerHour,
  };

  if (event.type === 'node_added') {
    currentState.inBIA = false;
  }

  if (event.type === 'node_removed' || event.type === 'edge_removed') {
    currentState.hasRedundancy = false;
  }

  if (event.affectsSPOF || event.description.toLowerCase().includes('spof')) {
    currentState.isSPOF = true;
    currentState.hasRedundancy = false;
  }

  if (event.affectsRTO) {
    currentState.rtoMinutes = Math.max(currentState.rtoMinutes ?? 120, (previousState.rtoMinutes ?? 120) + 60);
  }

  if (event.description.toLowerCase().includes('region') || event.description.toLowerCase().includes('concentration')) {
    currentState.inPRARegion = false;
  }

  if (event.description.toLowerCase().includes('backup')) {
    currentState.hasBackup = false;
  }

  return { previousState, currentState };
}

// ─── POST /drift/check — Launch immediate drift check ──────────
router.post('/check', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    if (!checkDriftRateLimit(tenantId)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Maximum 5 drift checks per hour.' });
    }

    const modeRaw = req.body?.comparisonMode as string | undefined;
    if (modeRaw && modeRaw !== 'baseline' && modeRaw !== 'latest') {
      return res.status(400).json({ error: 'Invalid comparisonMode. Use baseline or latest.' });
    }

    const comparisonMode: 'baseline' | 'latest' = modeRaw === 'latest' ? 'latest' : 'baseline';
    const result = await runDriftCheck(prisma, tenantId, { comparisonMode });
    return res.json(result);
  } catch (error) {
    appLogger.error('Error running drift check:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /drift/events — List drift events ──────────
router.get('/events', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const status = req.query.status as string | undefined;
    const severity = req.query.severity as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const where: any = { tenantId };
    if (status) where.status = status;
    if (severity) where.severity = severity;

    const events = await prisma.driftEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { snapshot: { select: { id: true, capturedAt: true, nodeCount: true, edgeCount: true } } },
    });

    const nodeIds = Array.from(new Set(events.map((event) => event.nodeId).filter(Boolean))) as string[];
    const [profile, nodes, overrides] = await Promise.all([
      prisma.organizationProfile.findUnique({ where: { tenantId } }),
      nodeIds.length > 0
        ? prisma.infraNode.findMany({
            where: { tenantId, id: { in: nodeIds } },
            include: { inEdges: true, outEdges: true },
          })
        : Promise.resolve([]),
      nodeIds.length > 0
        ? prisma.nodeFinancialOverride.findMany({
            where: { tenantId, nodeId: { in: nodeIds } },
          })
        : Promise.resolve([]),
    ]);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const overrideByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));

    const enrichedEvents = events.map((event) => {
      let costPerHour = 0;
      let eventCurrency = String(profile?.customCurrency || 'EUR').toUpperCase();
      if (event.nodeId) {
        const node = nodeById.get(event.nodeId);
        if (node) {
          const override = overrideByNodeId.get(node.id);
          const impact = FinancialEngineService.calculateNodeFinancialImpact(
            {
              id: node.id,
              name: node.name,
              type: node.type,
              provider: node.provider,
              region: node.region,
              isSPOF: node.isSPOF,
              criticalityScore: node.criticalityScore,
              redundancyScore: node.redundancyScore,
              impactCategory: node.impactCategory,
              suggestedRTO: node.suggestedRTO,
              validatedRTO: node.validatedRTO,
              suggestedRPO: node.suggestedRPO,
              validatedRPO: node.validatedRPO,
              suggestedMTPD: node.suggestedMTPD,
              validatedMTPD: node.validatedMTPD,
              dependentsCount: node.inEdges.length,
              inEdges: node.inEdges,
              outEdges: node.outEdges,
            },
            profile,
            override ? { customCostPerHour: override.customCostPerHour } : undefined,
          );
          costPerHour = impact.estimatedCostPerHour;
          eventCurrency = impact.breakdown.currency;
        }
      }

      const details = asRecord(event.details);
      const { previousState, currentState } = deriveDriftStates(
        {
          type: event.type,
          description: event.description,
          affectsSPOF: event.affectsSPOF,
          affectsRTO: event.affectsRTO,
        },
        details,
        costPerHour,
      );

      const financialImpact = FinancialEngineService.calculateDriftFinancialImpact(
        {
          id: event.id,
          type: event.type,
          severity: event.severity,
          description: event.description,
          details: event.details,
          affectsSPOF: event.affectsSPOF,
          affectsRTO: event.affectsRTO,
        },
        previousState,
        currentState,
      );

      return {
        ...event,
        financialImpact: {
          ...financialImpact,
          currency: eventCurrency,
        },
      };
    });

    const counts = await prisma.driftEvent.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    });

    const severityCounts = await prisma.driftEvent.groupBy({
      by: ['severity'],
      where: { tenantId, status: 'open' },
      _count: true,
    });

    return res.json({
      events: enrichedEvents,
      summary: {
        byStatus: Object.fromEntries(counts.map(c => [c.status, c._count])),
        bySeverity: Object.fromEntries(severityCounts.map(c => [c.severity, c._count])),
      },
    });
  } catch (error) {
    appLogger.error('Error fetching drift events:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /drift/events/:id — Drift event detail ──────────
router.get('/events/:id', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const eventId = req.params.id;
    if (!eventId) return res.status(400).json({ error: 'Event ID required' });

    const event = await prisma.driftEvent.findFirst({
      where: { id: eventId, tenantId },
      include: { snapshot: true },
    });

    if (!event) return res.status(404).json({ error: 'Event not found' });
    return res.json(event);
  } catch (error) {
    appLogger.error('Error fetching drift event:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /drift/events/:id — Update drift event status ──────────
router.patch('/events/:id', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { status, resolvedBy } = req.body;
    const validStatuses = ['open', 'acknowledged', 'resolved', 'ignored'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const eventId = req.params.id;
    if (!eventId) return res.status(400).json({ error: 'Event ID required' });

    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (status === 'resolved') data.resolvedAt = new Date();
    if (resolvedBy) data.resolvedBy = resolvedBy;

    const event = await prisma.driftEvent.updateMany({
      where: { id: eventId, tenantId },
      data,
    });

    if (event.count === 0) return res.status(404).json({ error: 'Event not found' });

    const updated = await prisma.driftEvent.findFirst({ where: { id: eventId, tenantId } });
    return res.json(updated);
  } catch (error) {
    appLogger.error('Error updating drift event:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /drift/snapshots — Snapshot history ──────────
router.get('/snapshots', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const snapshots = await prisma.infraSnapshot.findMany({
      where: { tenantId },
      orderBy: { capturedAt: 'desc' },
      take: limit,
      include: { drifts: { select: { id: true, severity: true, status: true } } },
    });

    return res.json(snapshots.map(s => ({
      ...s,
      driftCount: s.drifts.length,
      openDriftCount: s.drifts.filter(d => d.status === 'open').length,
      drifts: undefined,
    })));
  } catch (error) {
    appLogger.error('Error fetching snapshots:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /drift/score — Current resilience score ──────────
router.get('/score', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const score = await calculateResilienceScore(prisma, tenantId);

    // Get previous score for trend
    const analyses = await prisma.graphAnalysis.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { resilienceScore: true, createdAt: true },
    });

    const previousScore = analyses.length > 1 ? (analyses[1]?.resilienceScore ?? score) : score;
    const delta = score - previousScore;
    const trend = delta > 2 ? 'improving' : delta < -2 ? 'degrading' : 'stable';

    // Last scan info
    const lastSnapshot = await prisma.infraSnapshot.findFirst({
      where: { tenantId },
      orderBy: { capturedAt: 'desc' },
    });

    // Schedule info
    const schedule = await prisma.driftSchedule.findUnique({ where: { tenantId } });

    return res.json({
      score,
      previousScore,
      delta,
      trend,
      lastScanAt: lastSnapshot?.capturedAt ?? null,
      nextScanAt: schedule?.nextRunAt ?? null,
      scheduleEnabled: schedule?.enabled ?? false,
    });
  } catch (error) {
    appLogger.error('Error calculating score:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /drift/score/history — Score history ──────────
router.get('/score/history', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const analyses = await prisma.graphAnalysis.findMany({
      where: { tenantId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { resilienceScore: true, createdAt: true, totalNodes: true, spofCount: true },
    });

    return res.json(analyses);
  } catch (error) {
    appLogger.error('Error fetching score history:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /drift/schedule — Get drift schedule ──────────
router.get('/schedule', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    let schedule = await prisma.driftSchedule.findUnique({ where: { tenantId } });

    if (!schedule) {
      schedule = await prisma.driftSchedule.create({
        data: {
          tenantId,
          cronExpr: '0 6 * * 1',
          enabled: false,
        },
      });
    }

    return res.json(schedule);
  } catch (error) {
    appLogger.error('Error fetching drift schedule:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /drift/schedule — Update drift schedule ──────────
router.put('/schedule', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { cronExpr, enabled, alertEmail, alertWebhook, alertOnCritical, alertOnHigh } = req.body;

    const schedule = await prisma.driftSchedule.upsert({
      where: { tenantId },
      create: {
        tenantId,
        cronExpr: cronExpr ?? '0 6 * * 1',
        enabled: enabled ?? true,
        alertEmail: alertEmail ?? null,
        alertWebhook: alertWebhook ?? null,
        alertOnCritical: alertOnCritical ?? true,
        alertOnHigh: alertOnHigh ?? true,
      },
      update: {
        cronExpr: cronExpr ?? undefined,
        enabled: enabled ?? undefined,
        alertEmail: alertEmail ?? undefined,
        alertWebhook: alertWebhook ?? undefined,
        alertOnCritical: alertOnCritical ?? undefined,
        alertOnHigh: alertOnHigh ?? undefined,
      },
    });

    return res.json(schedule);
  } catch (error) {
    appLogger.error('Error updating drift schedule:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



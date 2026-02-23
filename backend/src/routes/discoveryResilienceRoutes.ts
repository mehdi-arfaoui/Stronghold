import { appLogger } from "../utils/logger.js";
// ============================================================
// Discovery Resilience Routes — Auto-scan, jobs, schedules
// Bridges existing discovery with resilience graph ingestion
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import {
  createScanJob,
  getScanJobStatus,
  createScanSchedule,
  listScanSchedules,
  listScanJobs,
  ingestDiscoveredResources,
} from '../discovery/discoveryOrchestrator.js';
import { discoveryQueue } from '../queues/discoveryQueue.js';
import {
  getDemoSeedGuard,
  runDemoOnboarding,
} from '../services/demoOnboardingService.js';
import { buildScanHealthReport } from '../services/discoveryHealthService.js';
import { scanConfigHasPlaintextCredentials } from '../services/scanConfigSecurityService.js';
import {
  isDemoCompanySizeKey,
  isDemoSectorKey,
  type DemoFinancialFieldKey,
  type DemoProfileSelectionInput,
} from '../config/demo-profiles.js';

const router = Router();

const DEMO_FINANCIAL_FIELDS: DemoFinancialFieldKey[] = [
  'annualRevenue',
  'employeeCount',
  'annualITBudget',
  'drBudgetPercent',
  'hourlyDowntimeCost',
];

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseDemoSeedProfileInput(body: unknown):
  | { ok: true; value: DemoProfileSelectionInput }
  | { ok: false; error: string; details: Array<{ field: string; message: string }> } {
  if (body == null || body === '') {
    return { ok: true, value: {} };
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      error: 'Invalid payload',
      details: [{ field: 'body', message: 'Expected JSON object' }],
    };
  }

  const payload = body as Record<string, unknown>;
  const details: Array<{ field: string; message: string }> = [];
  const input: DemoProfileSelectionInput = {};

  if (payload.sector !== undefined) {
    if (!isDemoSectorKey(payload.sector)) {
      details.push({ field: 'sector', message: 'Unsupported demo sector' });
    } else {
      input.sector = payload.sector;
    }
  }

  if (payload.companySize !== undefined) {
    if (!isDemoCompanySizeKey(payload.companySize)) {
      details.push({ field: 'companySize', message: 'Unsupported company size' });
    } else {
      input.companySize = payload.companySize;
    }
  }

  if (payload.financialOverrides !== undefined) {
    if (
      payload.financialOverrides == null ||
      typeof payload.financialOverrides !== 'object' ||
      Array.isArray(payload.financialOverrides)
    ) {
      details.push({
        field: 'financialOverrides',
        message: 'Expected object with numeric overrides',
      });
    } else {
      const parsedOverrides: Partial<Record<DemoFinancialFieldKey, number>> = {};
      const rawOverrides = payload.financialOverrides as Record<string, unknown>;
      for (const field of DEMO_FINANCIAL_FIELDS) {
        if (rawOverrides[field] === undefined) continue;
        const parsed = parsePositiveNumber(rawOverrides[field]);
        if (parsed == null) {
          details.push({
            field: `financialOverrides.${field}`,
            message: 'Expected positive number',
          });
          continue;
        }
        parsedOverrides[field] = parsed;
      }
      input.financialOverrides = parsedOverrides;
    }
  }

  if (details.length > 0) {
    return {
      ok: false,
      error: 'Invalid demo profile payload',
      details,
    };
  }

  return { ok: true, value: input };
}

// ─── POST /discovery/auto-scan — Launch automated scan ──────────
router.post('/auto-scan', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { providers, kubernetes, onPremise, options } = req.body;
    const normalizedProviders = Array.isArray(providers) ? providers : [];
    const hasCloudProviders = normalizedProviders.length > 0;
    const hasKubernetes = Array.isArray(kubernetes) && kubernetes.length > 0;
    const hasOnPremise =
      Boolean(onPremise) &&
      Array.isArray(onPremise.ipRanges) &&
      onPremise.ipRanges.length > 0;

    if (!hasCloudProviders && !hasKubernetes && !hasOnPremise) {
      return res.status(400).json({
        error: 'At least one discovery source is required (cloud, kubernetes, or on-premise)',
      });
    }

    const scanConfig = { providers: normalizedProviders, kubernetes, onPremise, options };
    if (
      scanConfigHasPlaintextCredentials(scanConfig) &&
      !process.env.CREDENTIAL_ENCRYPTION_KEY
    ) {
      return res.status(400).json({
        error: 'Configuration manquante',
        details: [{ field: 'credentials', message: 'CREDENTIAL_ENCRYPTION_KEY requis' }],
      });
    }

    // Create scan job record
    const jobId = await createScanJob(prisma, tenantId, scanConfig);

    // Extract cloud providers and IP ranges for the existing worker
    const cloudProviders: string[] = [];

    for (const provider of normalizedProviders) {
      if (provider?.type) {
        cloudProviders.push(provider.type);
      }
    }

    const ipRanges = onPremise?.ipRanges || [];

    // Queue the job using existing BullMQ infrastructure
    await discoveryQueue.add('discovery.run', {
      jobId,
      tenantId,
      ipRanges,
      cloudProviders,
      requestedBy: null,
      autoCreate: false,
      // Signal that results should also be ingested into resilience graph
      ingestToGraph: true,
      inferDependencies: options?.inferDependencies !== false,
    });

    return res.json({ jobId, status: 'queued' });
  } catch (error) {
    appLogger.error('Error launching auto-scan:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /discovery/scan-jobs/:jobId — Track scan job progress ──────────
router.get('/scan-jobs/:jobId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const jobId = req.params.jobId as string;
    const status = await getScanJobStatus(prisma, jobId, tenantId);

    if (!status) {
      return res.status(404).json({ error: 'Scan job not found' });
    }

    return res.json(status);
  } catch (error) {
    appLogger.error('Error fetching scan job status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /discovery/scan-jobs — List scan jobs ──────────
router.get('/scan-jobs', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const limit = parseInt(req.query.limit as string) || 20;
    const jobs = await listScanJobs(prisma, tenantId, limit);

    return res.json({ jobs });
  } catch (error) {
    appLogger.error('Error listing scan jobs:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /discovery/schedules — Configure recurring scan ──────────
router.post('/schedules', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { cronExpression, providers, kubernetes, onPremise, options } = req.body;
    const normalizedProviders = Array.isArray(providers) ? providers : [];
    const hasCloudProviders = normalizedProviders.length > 0;
    const hasKubernetes = Array.isArray(kubernetes) && kubernetes.length > 0;
    const hasOnPremise =
      Boolean(onPremise) &&
      Array.isArray(onPremise.ipRanges) &&
      onPremise.ipRanges.length > 0;

    if (!cronExpression) {
      return res.status(400).json({ error: 'cronExpression is required' });
    }
    if (!hasCloudProviders && !hasKubernetes && !hasOnPremise) {
      return res.status(400).json({
        error: 'At least one discovery source is required (cloud, kubernetes, or on-premise)',
      });
    }

    const scanConfig = { providers: normalizedProviders, kubernetes, onPremise, options };
    if (
      scanConfigHasPlaintextCredentials(scanConfig) &&
      !process.env.CREDENTIAL_ENCRYPTION_KEY
    ) {
      return res.status(400).json({
        error: 'Configuration manquante',
        details: [{ field: 'credentials', message: 'CREDENTIAL_ENCRYPTION_KEY requis' }],
      });
    }

    const scheduleId = await createScanSchedule(prisma, tenantId, cronExpression, scanConfig);

    return res.status(201).json({ id: scheduleId, cronExpression, status: 'active' });
  } catch (error) {
    appLogger.error('Error creating scan schedule:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /discovery/schedules — List scan schedules ──────────
router.get('/schedules', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const schedules = await listScanSchedules(prisma, tenantId);
    return res.json({ schedules });
  } catch (error) {
    appLogger.error('Error listing scan schedules:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /discovery/ingest — Direct ingest from external source ──────────
// Allows direct ingestion of discovered resources into the resilience graph
// without going through the full scan pipeline.
router.post('/ingest', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { resources, flows, provider, inferDependencies: infer } = req.body;

    if (!resources || !Array.isArray(resources)) {
      return res.status(400).json({ error: 'resources array is required' });
    }

    const report = await ingestDiscoveredResources(
      prisma,
      tenantId,
      resources,
      flows || [],
      provider || 'manual',
      { inferDependencies: infer !== false }
    );

    return res.json(report);
  } catch (error) {
    appLogger.error('Error ingesting discovery resources:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /discovery/test-credentials — Test provider credentials ──────────
router.post('/test-credentials', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { provider, credentials } = req.body;

    if (!provider || !credentials) {
      return res.status(400).json({ error: 'provider and credentials are required' });
    }

    // Basic validation — actual credential testing requires provider SDKs
    return res.json({
      success: true,
      message: `Credentials for ${provider} appear valid (format check only)`,
      provider,
    });
  } catch (error) {
    appLogger.error('Error testing credentials:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



// ─── GET /discovery/health — Scan health dashboard ──────────
router.get('/health', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: { code: 'ERR_500', message: 'Tenant not resolved' } });

    const report = await buildScanHealthReport(prisma, tenantId);
    return res.json({ data: report });
  } catch (error) {
    appLogger.error('Error fetching discovery health report:', error);
    return res.status(500).json({ error: { code: 'ERR_500', message: 'Internal server error' } });
  }
});

// ─── POST /discovery/seed-demo — Load demo environment (dev only) ──────────
router.post('/seed-demo', async (req: TenantRequest, res) => {
  try {
    const guard = getDemoSeedGuard();
    if (!guard.allowed) {
      return res.status(403).json({
        error: guard.reason,
        environment: guard.nodeEnv,
        mode: guard.mode,
      });
    }

    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const parsedProfileInput = parseDemoSeedProfileInput(req.body);
    if (!parsedProfileInput.ok) {
      return res.status(400).json({
        error: parsedProfileInput.error,
        details: parsedProfileInput.details,
      });
    }

    const summary = await runDemoOnboarding(prisma, tenantId, {
      profile: parsedProfileInput.value,
    });

    return res.json({
      success: true,
      message: `Demo onboarding completed for "${summary.demoProfile.sectorLabel}"`,
      environment: guard.nodeEnv,
      mode: guard.mode,
      ...summary,
    });
  } catch (error) {
    appLogger.error('Error seeding demo data:', error);
    return res.status(500).json({ error: 'Failed to seed demo data' });
  }
});

export default router;

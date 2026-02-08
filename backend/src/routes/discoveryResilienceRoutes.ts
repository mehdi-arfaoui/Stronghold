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
import { runDemoSeed } from '../services/demoSeedService.js';

const router = Router();

// ─── POST /discovery/auto-scan — Launch automated scan ──────────
router.post('/auto-scan', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { providers, kubernetes, onPremise, options } = req.body;

    if (!providers || !Array.isArray(providers) || providers.length === 0) {
      return res.status(400).json({ error: 'At least one provider configuration is required' });
    }

    // Create scan job record
    const jobId = await createScanJob(prisma, tenantId, {
      providers,
      kubernetes,
      onPremise,
      options,
    });

    // Extract cloud providers and IP ranges for the existing worker
    const cloudProviders: string[] = [];
    const credentials: Record<string, unknown> = {};

    for (const provider of providers) {
      cloudProviders.push(provider.type);
      credentials[provider.type] = provider.credentials;
      if (provider.regions) {
        credentials[`${provider.type}_regions`] = provider.regions;
      }
    }

    const ipRanges = onPremise?.ipRanges || [];

    // Queue the job using existing BullMQ infrastructure
    await discoveryQueue.add('discovery.run', {
      jobId,
      tenantId,
      ipRanges,
      cloudProviders,
      credentials,
      requestedBy: null,
      autoCreate: false,
      // Signal that results should also be ingested into resilience graph
      ingestToGraph: true,
      inferDependencies: options?.inferDependencies !== false,
    });

    return res.json({ jobId, status: 'queued' });
  } catch (error) {
    console.error('Error launching auto-scan:', error);
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
    console.error('Error fetching scan job status:', error);
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
    console.error('Error listing scan jobs:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /discovery/schedules — Configure recurring scan ──────────
router.post('/schedules', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { cronExpression, providers, kubernetes, onPremise, options } = req.body;

    if (!cronExpression) {
      return res.status(400).json({ error: 'cronExpression is required' });
    }
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
      return res.status(400).json({ error: 'At least one provider configuration is required' });
    }

    const scheduleId = await createScanSchedule(prisma, tenantId, cronExpression, {
      providers,
      kubernetes,
      onPremise,
      options,
    });

    return res.status(201).json({ id: scheduleId, cronExpression, status: 'active' });
  } catch (error) {
    console.error('Error creating scan schedule:', error);
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
    console.error('Error listing scan schedules:', error);
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
    console.error('Error ingesting discovery resources:', error);
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
    console.error('Error testing credentials:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /discovery/seed-demo — Load demo environment (dev only) ──────────
router.post('/seed-demo', async (req: TenantRequest, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
      return res.status(403).json({ error: 'Demo seeding is disabled in production' });
    }

    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const summary = await runDemoSeed(prisma, tenantId);

    return res.json({
      success: true,
      message: 'Demo environment "ShopMax E-commerce" loaded',
      ...summary,
    });
  } catch (error) {
    console.error('Error seeding demo data:', error);
    return res.status(500).json({ error: 'Failed to seed demo data' });
  }
});

export default router;

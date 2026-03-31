import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDriftedScenario, createTestUuid } from './fixtures.js';
import { createE2eContext, seedCompletedScan, type E2eContext } from './test-app.js';

describe('Drift Flow E2E', () => {
  let context: E2eContext;

  beforeEach(() => {
    context = createE2eContext();
  });

  it('POST /api/drift/check detects changes between scans', async () => {
    const baselineScanId = createTestUuid(40);
    const currentScanId = createTestUuid(41);
    await seedCompletedScan(context, { scanId: baselineScanId, persistPlan: true });
    await seedCompletedScan(context, { scanId: currentScanId, scenario: createDriftedScenario() });

    const response = await request(context.app)
      .post('/api/drift/check')
      .send({ currentScanId, baselineScanId });

    expect(response.status).toBe(200);
    expect(response.body.changes.length).toBeGreaterThan(0);
  });

  it('POST /api/drift/check returns 404 when a scan is missing', async () => {
    const baselineScanId = createTestUuid(42);
    await seedCompletedScan(context, { scanId: baselineScanId, persistPlan: true });

    const response = await request(context.app)
      .post('/api/drift/check')
      .send({ currentScanId: createTestUuid(43), baselineScanId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SCAN_NOT_FOUND');
  });

  it('GET /api/scans/:scanId/drift returns stored drift events', async () => {
    const baselineScanId = createTestUuid(44);
    const currentScanId = createTestUuid(45);
    await seedCompletedScan(context, { scanId: baselineScanId, persistPlan: true });
    await seedCompletedScan(context, { scanId: currentScanId, scenario: createDriftedScenario() });
    await request(context.app).post('/api/drift/check').send({ currentScanId, baselineScanId });

    const response = await request(context.app).get(`/api/scans/${currentScanId}/drift`);

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]?.scanId).toBe(currentScanId);
  });
});

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestUuid } from './fixtures.js';
import { createE2eContext, seedCompletedScan, type E2eContext } from './test-app.js';

describe('Report Flow E2E', () => {
  let context: E2eContext;

  beforeEach(() => {
    context = createE2eContext();
  });

  it('GET /api/scans/:scanId/report returns JSON validation data', async () => {
    const scanId = createTestUuid(20);
    await seedCompletedScan(context, { scanId });

    const response = await request(context.app).get(`/api/scans/${scanId}/report?format=json`);

    expect(response.status).toBe(200);
    expect(response.body.scoreBreakdown.overall).toBeTypeOf('number');
    expect(response.body.proofOfRecovery).toBeDefined();
    expect(response.body.realityGap).toBeDefined();
    expect(response.body.proofOfRecovery.observedCoverage).toBeTypeOf('number');
    expect(Array.isArray(response.body.results)).toBe(true);
  });

  it('GET /api/scans/:scanId/report returns markdown when requested', async () => {
    const scanId = createTestUuid(21);
    await seedCompletedScan(context, { scanId });

    const response = await request(context.app).get(`/api/scans/${scanId}/report?format=markdown`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/markdown');
    expect(response.text).toContain('STRONGHOLD DR Posture Report');
  });

  it('GET /api/scans/:scanId/report filters results by category', async () => {
    const scanId = createTestUuid(22);
    await seedCompletedScan(context, { scanId });

    const response = await request(context.app).get(`/api/scans/${scanId}/report?format=json&category=backup`);

    expect(response.status).toBe(200);
    expect(response.body.results.length).toBeGreaterThan(0);
    expect(response.body.results.every((result: { readonly category: string }) => result.category === 'backup')).toBe(true);
  });

  it('GET /api/scans/:scanId/report returns 404 for an unknown scan', async () => {
    const response = await request(context.app).get(`/api/scans/${createTestUuid(23)}/report?format=json`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SCAN_NOT_FOUND');
  });

  it('GET /api/scans/:scanId/report/summary returns score, grade, and top failures', async () => {
    const scanId = createTestUuid(24);
    await seedCompletedScan(context, { scanId });

    const response = await request(context.app).get(`/api/scans/${scanId}/report/summary`);

    expect(response.status).toBe(200);
    expect(response.body.score).toBeTypeOf('number');
    expect(response.body.grade).toBeTypeOf('string');
    expect(Array.isArray(response.body.topFailures)).toBe(true);
  });
});

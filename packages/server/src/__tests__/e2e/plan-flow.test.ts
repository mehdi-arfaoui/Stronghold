import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestUuid } from './fixtures.js';
import { createE2eContext, seedCompletedScan, type E2eContext } from './test-app.js';

describe('Plan Flow E2E', () => {
  let context: E2eContext;

  beforeEach(() => {
    context = createE2eContext();
  });

  it('POST /api/scans/:scanId/plan/generate returns a JSON DR plan payload', async () => {
    const scanId = createTestUuid(30);
    await seedCompletedScan(context, { scanId });

    const response = await request(context.app).post(`/api/scans/${scanId}/plan/generate?format=json`);

    expect(response.status).toBe(200);
    expect(response.body.plan.services[0]?.components.length ?? 0).toBeGreaterThan(0);
    expect(response.body.plan.services[0]?.recoveryOrder.length ?? 0).toBeGreaterThan(0);
    expect(response.body.validation.isValid).toBeTypeOf('boolean');
    expect(response.body.format).toBe('json');
  });

  it('POST /api/scans/:scanId/plan/generate returns YAML when requested', async () => {
    const scanId = createTestUuid(31);
    await seedCompletedScan(context, { scanId });

    const response = await request(context.app).post(`/api/scans/${scanId}/plan/generate?format=yaml`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/yaml');
    expect(/^(#|id:|version:)/.test(response.text)).toBe(true);
  });

  it('GET /api/scans/:scanId/plan returns the latest stored plan', async () => {
    const scanId = createTestUuid(32);
    await seedCompletedScan(context, { scanId, persistPlan: true });

    const response = await request(context.app).get(`/api/scans/${scanId}/plan`);

    expect(response.status).toBe(200);
    expect(response.body.scanId).toBe(scanId);
    expect(response.body.componentCount).toBeGreaterThan(0);
  });

  it('POST /api/plan/validate accepts a valid plan for the current scan', async () => {
    const scanId = createTestUuid(33);
    await seedCompletedScan(context, { scanId, persistPlan: true });
    const plan = await context.scanRepository.getLatestDRPlan(scanId);

    const response = await request(context.app)
      .post('/api/plan/validate')
      .send({ planContent: plan?.content, scanId });

    expect(response.status).toBe(200);
    expect(response.body.isValid).toBe(true);
  });

  it('POST /api/plan/validate returns 422 for malformed plan content', async () => {
    const scanId = createTestUuid(34);
    await seedCompletedScan(context, { scanId });

    const response = await request(context.app)
      .post('/api/plan/validate')
      .send({ planContent: 'not: [valid', scanId });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PLAN_INVALID');
  });
});

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestUuid } from './fixtures.js';
import { createE2eContext, seedCompletedScan, type E2eContext } from './test-app.js';

describe('Services Flow E2E', () => {
  let context: E2eContext;

  beforeEach(() => {
    context = createE2eContext();
  });

  it('GET /api/services returns the persisted services posture for the latest scan', async () => {
    const scanId = createTestUuid(31);
    await seedCompletedScan(context, { scanId, persistPlan: true });

    const response = await request(context.app).get('/api/services');

    expect(response.status).toBe(200);
    expect(response.body.scanId).toBe(scanId);
    expect(Array.isArray(response.body.services)).toBe(true);
  });

  it('GET /api/services/:id returns a single service detail', async () => {
    const scanId = createTestUuid(32);
    await seedCompletedScan(context, { scanId, persistPlan: true });

    const listResponse = await request(context.app).get('/api/services');
    const serviceId = listResponse.body.services[0]?.service?.id as string;

    const response = await request(context.app).get(`/api/services/${serviceId}`);

    expect(response.status).toBe(200);
    expect(response.body.service.service.id).toBe(serviceId);
    expect(response.body.service.recoveryChain).not.toBeNull();
    expect(Array.isArray(response.body.service.recoveryChain.steps)).toBe(true);
  });
});

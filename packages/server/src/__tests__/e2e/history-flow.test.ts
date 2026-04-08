import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createE2eContext, waitFor, type E2eContext } from './test-app.js';

describe('History Flow E2E', () => {
  let context: E2eContext;

  beforeEach(() => {
    context = createE2eContext({ autoCompleteScan: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists posture history and serves trend and per-service history endpoints', async () => {
    const created = await request(context.app)
      .post('/api/scans')
      .send({ provider: 'aws', regions: ['eu-west-1'] });

    expect(created.status).toBe(202);

    await waitFor(
      async () => request(context.app).get(`/api/scans/${created.body.scanId as string}`),
      (result) => result.status === 200 && result.body.status === 'COMPLETED',
    );

    const history = await request(context.app).get('/api/history');
    expect(history.status).toBe(200);
    expect(history.body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(history.body.snapshots)).toBe(true);

    const trend = await request(context.app).get('/api/history/trend');
    expect(trend.status).toBe(200);
    expect(Array.isArray(trend.body.snapshots)).toBe(true);
    expect(trend.body.trend.global.direction).toBeDefined();

    const services = await request(context.app).get('/api/services');
    expect(services.status).toBe(200);
    const serviceId = services.body.services[0]?.service.id as string | undefined;
    expect(serviceId).toBeTruthy();

    const serviceHistory = await request(context.app).get(`/api/history/service/${serviceId}`);
    expect(serviceHistory.status).toBe(200);
    expect(serviceHistory.body.serviceId).toBe(serviceId);
    expect(Array.isArray(serviceHistory.body.snapshots)).toBe(true);
  });
});

import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createE2eContext, seedCompletedScan } from './test-app.js';

describe('Evidence Flow E2E', () => {
  afterEach(() => {
    process.env.STRONGHOLD_ENCRYPTION_KEY = '';
  });

  it('GET /api/evidence returns scan evidence for the latest completed scan', async () => {
    const context = createE2eContext();
    await seedCompletedScan(context, {
      scanId: '550e8400-e29b-41d4-a716-446655440000',
      persistPlan: true,
    });

    const response = await request(context.app).get('/api/evidence');

    expect(response.status).toBe(200);
    expect(response.body.scanId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(Array.isArray(response.body.evidence)).toBe(true);
    expect(response.body.evidence.length).toBeGreaterThan(0);
  });

  it('POST /api/evidence stores tested evidence and exposes it in the expiring feed', async () => {
    const context = createE2eContext();
    await seedCompletedScan(context, {
      scanId: '550e8400-e29b-41d4-a716-446655440000',
      persistPlan: true,
    });

    const createResponse = await request(context.app).post('/api/evidence').send({
      nodeId: 'rds-payment-primary',
      type: 'restore-test',
      result: 'success',
      expiresDays: 7,
      author: 'team-backend',
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.type).toBe('tested');

    const expiringResponse = await request(context.app).get('/api/evidence/expiring');

    expect(expiringResponse.status).toBe(200);
    expect(
      expiringResponse.body.evidence.some((entry: { id: string }) => entry.id === createResponse.body.id),
    ).toBe(true);
  });
});

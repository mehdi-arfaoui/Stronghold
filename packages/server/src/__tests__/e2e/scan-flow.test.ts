import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestUuid } from './fixtures.js';
import { createE2eContext, seedCompletedScan, waitFor, type E2eContext } from './test-app.js';

describe('Scan Flow E2E', () => {
  let context: E2eContext;

  beforeEach(() => {
    context = createE2eContext({ autoCompleteScan: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /api/scans returns 202 immediately and completes with demo data in background', async () => {
    const response = await request(context.app)
      .post('/api/scans')
      .send({ provider: 'aws', regions: ['eu-west-1'] });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      scanId: expect.any(String),
      status: 'PENDING',
    });

    const completed = await waitFor(
      async () => request(context.app).get(`/api/scans/${response.body.scanId as string}`),
      (result) => result.status === 200 && result.body.status === 'COMPLETED',
    );

    expect(completed.body.resourceCount).toBeGreaterThan(0);
    expect(completed.body.score).toBeTypeOf('number');
  });

  it('POST /api/scans rejects invalid payloads with INVALID_INPUT', async () => {
    const [unknownProvider, emptyBody, emptyRegions] = await Promise.all([
      request(context.app).post('/api/scans').send({ provider: 'gcp' }),
      request(context.app).post('/api/scans').send({}),
      request(context.app).post('/api/scans').send({ provider: 'aws', regions: [] }),
    ]);

    expect(unknownProvider.status).toBe(400);
    expect(emptyBody.status).toBe(400);
    expect(emptyRegions.status).toBe(400);
    expect(unknownProvider.body.error.code).toBe('INVALID_INPUT');
    expect(emptyBody.body.error.code).toBe('INVALID_INPUT');
    expect(emptyRegions.body.error.code).toBe('INVALID_INPUT');
  });

  it('GET /api/scans paginates results with a cursor', async () => {
    await seedCompletedScan(context, {
      scanId: createTestUuid(1),
      timestamp: new Date('2026-03-27T15:00:00.000Z'),
    });
    await seedCompletedScan(context, {
      scanId: createTestUuid(2),
      timestamp: new Date('2026-03-27T15:01:00.000Z'),
    });
    await seedCompletedScan(context, {
      scanId: createTestUuid(3),
      timestamp: new Date('2026-03-27T15:02:00.000Z'),
    });

    const firstPage = await request(context.app).get('/api/scans?limit=2');
    const secondPage = await request(context.app).get(`/api/scans?limit=2&cursor=${firstPage.body.nextCursor as string}`);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.scans).toHaveLength(2);
    expect(firstPage.body.nextCursor).toBe(createTestUuid(2));
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.scans).toHaveLength(1);
    expect(secondPage.body.scans[0]?.id).toBe(createTestUuid(1));
  });

  it('GET /api/scans/:id returns an existing completed scan', async () => {
    const scanId = createTestUuid(10);
    await seedCompletedScan(context, { scanId });

    const response = await request(context.app).get(`/api/scans/${scanId}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(scanId);
    expect(response.body.status).toBe('COMPLETED');
  });

  it('GET /api/scans/:id returns 404 when the scan does not exist', async () => {
    const response = await request(context.app).get(`/api/scans/${createTestUuid(11)}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SCAN_NOT_FOUND');
  });

  it('GET /api/scans/not-a-uuid returns 400', async () => {
    const response = await request(context.app).get('/api/scans/not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('DELETE /api/scans/:id removes the scan and cascades related records', async () => {
    const scanId = createTestUuid(12);
    await seedCompletedScan(context, { scanId, persistPlan: true });

    const response = await request(context.app).delete(`/api/scans/${scanId}`);

    expect(response.status).toBe(204);
    expect(await context.scanRepository.getScanSummary(scanId)).toBeNull();
    expect(context.prisma.store.scanData.has(scanId)).toBe(false);
  });

  it('encrypts persisted scan data when an encryption key is configured', async () => {
    const encryptedContext = createE2eContext({
      encryptionKey:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    const scanId = createTestUuid(13);
    await seedCompletedScan(encryptedContext, { scanId });

    const rawRecord = encryptedContext.prisma.store.scanData.get(scanId) as
      | Record<string, unknown>
      | undefined;

    expect(typeof rawRecord?.nodes).toBe('string');
    expect(String(rawRecord?.nodes)).not.toContain('orders-db');

    const stored = await encryptedContext.infrastructureRepository.getScanData(scanId);
    expect(stored?.nodes.length).toBeGreaterThan(0);
    expect(stored?.analysis.totalNodes).toBeGreaterThan(0);

    const response = await request(encryptedContext.app).get(`/api/scans/${scanId}/data`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.nodes)).toBe(true);
    expect(response.body.proofOfRecovery).toBeDefined();
  });

  it('GET /api/health returns status ok', async () => {
    const response = await request(context.app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('GET /api/health/db returns 200 with the in-memory Prisma probe', async () => {
    const response = await request(context.app).get('/api/health/db');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

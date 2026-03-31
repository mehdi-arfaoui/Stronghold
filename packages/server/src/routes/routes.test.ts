import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServerLogger } from '../adapters/server-logger.js';
import { createApp } from '../app.js';
import type { ServerConfig } from '../config/env.js';
import { ServerError } from '../errors/server-error.js';
import type { DriftService } from '../services/drift-service.js';
import type { ScanService } from '../services/scan-service.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

function createTestApp(options?: {
  readonly dbHealthy?: boolean;
  readonly scanService?: Partial<ScanService>;
  readonly driftService?: Partial<DriftService>;
}): ReturnType<typeof createApp> {
  const config: ServerConfig = {
    port: 3000,
    databaseUrl: 'postgresql://stronghold:stronghold@localhost:5432/stronghold',
    nodeEnv: 'test',
    corsOrigin: 'http://localhost:5173',
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'error',
  };
  const logger = new ServerLogger(config);
  const prisma = {
    $queryRaw: options?.dbHealthy === false ? vi.fn().mockRejectedValue(new Error('db down')) : vi.fn().mockResolvedValue([{ ok: 1 }]),
  } as unknown as PrismaClient;
  const scanService = {
    createScan: vi.fn().mockResolvedValue(VALID_UUID),
    listScans: vi.fn().mockResolvedValue({
      scans: [
        {
          id: VALID_UUID,
          provider: 'aws',
          regions: ['eu-west-1'],
          status: 'COMPLETED',
          resourceCount: 10,
          edgeCount: 8,
          score: 82,
          grade: 'B',
          errorMessage: null,
          createdAt: new Date('2026-03-27T15:00:00.000Z'),
          updatedAt: new Date('2026-03-27T15:00:00.000Z'),
        },
      ],
      nextCursor: '550e8400-e29b-41d4-a716-446655440001',
    }),
    getScanSummary: vi.fn().mockResolvedValue({
      id: VALID_UUID,
      provider: 'aws',
      regions: ['eu-west-1'],
      status: 'COMPLETED',
      resourceCount: 10,
      edgeCount: 8,
      score: 82,
      grade: 'B',
      errorMessage: null,
      createdAt: new Date('2026-03-27T15:00:00.000Z'),
      updatedAt: new Date('2026-03-27T15:00:00.000Z'),
    }),
    getScanData: vi.fn().mockResolvedValue({
      nodes: [],
      edges: [],
      analysis: {},
      validationReport: {},
    }),
    deleteScan: vi.fn().mockResolvedValue(true),
    renderValidationReport: vi.fn(),
    getValidationSummary: vi.fn(),
    generatePlan: vi.fn(),
    getLatestPlan: vi.fn(),
    validatePlan: vi.fn(),
    ...options?.scanService,
  } as unknown as ScanService;
  const driftService = {
    checkDrift: vi.fn(),
    listDriftEvents: vi.fn().mockResolvedValue([]),
    ...options?.driftService,
  } as unknown as DriftService;

  return createApp({
    config,
    prisma,
    logger,
    scanService,
    driftService,
  });
}

describe('server routes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/health returns status ok', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('GET /api/health/db returns 200 when the database is reachable', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /api/health/db returns 503 when the database is unreachable', async () => {
    const app = createTestApp({ dbHealthy: false });

    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
  });

  it('POST /api/scans returns 202 for a valid body', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/scans')
      .send({ provider: 'aws', regions: ['eu-west-1'] });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ scanId: VALID_UUID, status: 'PENDING' });
  });

  it('POST /api/scans returns 400 without a body', async () => {
    const app = createTestApp();

    const response = await request(app).post('/api/scans');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('POST /api/scans returns 400 for an invalid provider', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/scans')
      .send({ provider: 'azure', regions: ['eu-west-1'] });

    expect(response.status).toBe(400);
  });

  it('POST /api/scans returns 400 for empty regions', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/scans')
      .send({ provider: 'aws', regions: [] });

    expect(response.status).toBe(400);
  });

  it('GET /api/scans returns a paginated scan list', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/scans?limit=20');

    expect(response.status).toBe(200);
    expect(response.body.scans).toHaveLength(1);
    expect(response.body.nextCursor).toBe('550e8400-e29b-41d4-a716-446655440001');
  });

  it('GET /api/scans/not-a-uuid returns 400', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/scans/not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('GET /api/scans/:id returns 404 when the scan does not exist', async () => {
    const app = createTestApp({
      scanService: {
        getScanSummary: vi.fn().mockRejectedValue(
          new ServerError('Scan not found', { code: 'SCAN_NOT_FOUND', status: 404 }),
        ),
      },
    });

    const response = await request(app).get(`/api/scans/${VALID_UUID}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SCAN_NOT_FOUND');
  });

  it('DELETE /api/scans/:id returns 204 when the scan is deleted', async () => {
    const app = createTestApp();

    const response = await request(app).delete(`/api/scans/${VALID_UUID}`);

    expect(response.status).toBe(204);
  });
});

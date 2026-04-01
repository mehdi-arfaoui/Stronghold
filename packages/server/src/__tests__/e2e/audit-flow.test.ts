import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestUuid } from './fixtures.js';
import { createE2eContext, type E2eContext } from './test-app.js';

describe('Audit Flow E2E', () => {
  let context: E2eContext;

  beforeEach(() => {
    context = createE2eContext();
  });

  it('GET /api/audit returns paginated audit entries', async () => {
    await context.prisma.prisma.auditLog.create({
      data: createAuditRecord(createTestUuid(70), new Date('2026-03-27T15:00:00.000Z'), 'scan'),
    });
    await context.prisma.prisma.auditLog.create({
      data: createAuditRecord(createTestUuid(71), new Date('2026-03-27T15:01:00.000Z'), 'report'),
    });
    await context.prisma.prisma.auditLog.create({
      data: createAuditRecord(
        createTestUuid(72),
        new Date('2026-03-27T15:02:00.000Z'),
        'plan_generate',
      ),
    });

    const firstPage = await request(context.app).get('/api/audit?limit=2');
    const secondPage = await request(context.app).get(
      `/api/audit?limit=2&cursor=${firstPage.body.nextCursor as string}`,
    );

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.entries).toHaveLength(2);
    expect(firstPage.body.nextCursor).toBe(createTestUuid(71));
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.entries).toHaveLength(1);
    expect(secondPage.body.entries[0]?.id).toBe(createTestUuid(70));
  });
});

function createAuditRecord(id: string, createdAt: Date, action: string) {
  return {
    id,
    createdAt,
    timestamp: createdAt,
    action,
    parameters: {},
    result: {
      status: 'success',
      duration_ms: 123,
    },
  };
}

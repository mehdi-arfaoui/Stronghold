import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { AIFlowSuggesterService } from '../src/services/ai-flow-suggester.service.js';

test('AIFlowSuggesterService generates deterministic suggestions when provider key is missing', async () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const prismaMock = {
    infraNode: {
      findMany: async () => [
        {
          id: 'node-1',
          name: 'Checkout API',
          type: 'API_GATEWAY',
          provider: 'aws',
          region: 'eu-west-1',
          tags: { Application: 'Checkout' },
          metadata: {},
          blastRadius: 4,
          isSPOF: false,
          criticalityScore: 0.9,
          updatedAt: new Date(),
        },
        {
          id: 'node-2',
          name: 'Payments DB',
          type: 'DATABASE',
          provider: 'aws',
          region: 'eu-west-1',
          tags: { Application: 'Checkout' },
          metadata: {},
          blastRadius: 3,
          isSPOF: true,
          criticalityScore: 0.95,
          updatedAt: new Date(),
        },
      ],
    },
    infraEdge: {
      findMany: async () => [
        {
          sourceId: 'node-1',
          targetId: 'node-2',
          type: 'DEPENDS_ON',
          createdAt: new Date(),
        },
      ],
    },
    organizationProfile: {
      findUnique: async () => null,
    },
    businessFlow: {
      findFirst: async () => null,
      create: async (args: any) => ({
        id: 'flow-checkout',
        ...args.data,
      }),
      update: async (args: any) => ({
        id: args.where.id,
        ...args.data,
      }),
    },
    businessFlowNode: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 2 }),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;

  try {
    const service = new AIFlowSuggesterService(prismaMock);
    const suggestions = await service.suggestBusinessFlows('tenant-1');

    assert.ok(suggestions.length >= 1);
    assert.ok((suggestions[0]?.nodes.length || 0) >= 2);
    assert.equal(suggestions[0]?.nodes.some((node) => node.nodeId === 'node-1'), true);
    assert.equal(suggestions[0]?.nodes.some((node) => node.nodeId === 'node-2'), true);
  } finally {
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  }
});

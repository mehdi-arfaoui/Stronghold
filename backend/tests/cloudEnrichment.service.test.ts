import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { CloudEnrichmentService } from '../src/services/cloud-enrichment.service.js';

test('CloudEnrichmentService skips and reports empty flow groups and cleans stale cloud-tag flows', async () => {
  const prismaMock = {
    infraNode: {
      findMany: async () => [
        {
          id: 'node-1',
          name: 'Standalone Service',
          type: 'APPLICATION',
          provider: 'aws',
          region: 'eu-west-1',
          tags: { Application: 'Solo' },
          metadata: {},
          isSPOF: false,
          criticalityScore: 0.4,
          redundancyScore: 0.6,
          updatedAt: new Date(),
        },
      ],
    },
    infraEdge: {
      findMany: async () => [],
    },
    businessFlow: {
      findMany: async () => [
        {
          id: 'stale-flow',
          flowNodes: [],
        },
      ],
      deleteMany: async () => ({ count: 1 }),
      findFirst: async () => null,
      create: async () => {
        throw new Error('create should not be called for single-node groups');
      },
      update: async () => {
        throw new Error('update should not be called for single-node groups');
      },
    },
    businessFlowNode: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;

  const service = new CloudEnrichmentService(prismaMock);
  const result = await service.enrichFromCloudData('tenant-1');

  assert.equal(result.groupedSuggestions, 1);
  assert.equal(result.enrichedFlows, 0);
  assert.equal(result.ignoredEmptyFlows, 1);
  assert.equal(result.cleanedEmptyFlows, 1);
  assert.equal(result.message, 'Aucun flux métier détecté automatiquement — créez-en un manuellement');
  assert.equal(result.suggestions.length, 0);
});

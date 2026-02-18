import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFinancialContext } from '../src/services/financial-dashboard.service.js';

test('loadFinancialContext excludes non-validated BIA processes from financial inputs', async () => {
  const prismaMock = {
    infraNode: {
      findMany: async () => [],
    },
    bIAReport2: {
      findFirst: async () => ({
        processes: [
          {
            serviceNodeId: 'node-validated',
            recoveryTier: 1,
            suggestedRTO: 60,
            validatedRTO: 45,
            suggestedRPO: 15,
            validatedRPO: 10,
            suggestedMTPD: 180,
            validatedMTPD: 120,
            validationStatus: 'validated',
          },
          {
            serviceNodeId: 'node-pending',
            recoveryTier: 2,
            suggestedRTO: 120,
            validatedRTO: null,
            suggestedRPO: 30,
            validatedRPO: null,
            suggestedMTPD: 240,
            validatedMTPD: null,
            validationStatus: 'pending',
          },
          {
            serviceNodeId: 'node-draft',
            recoveryTier: 3,
            suggestedRTO: 240,
            validatedRTO: null,
            suggestedRPO: 60,
            validatedRPO: null,
            suggestedMTPD: 480,
            validatedMTPD: null,
            validationStatus: 'draft',
          },
        ],
      }),
    },
    organizationProfile: {
      findUnique: async () => null,
    },
    nodeFinancialOverride: {
      findMany: async () => [],
    },
  } as any;

  const context = await loadFinancialContext(prismaMock, 'tenant-1');

  assert.equal(context.biaResult.processes.length, 1);
  assert.equal(context.biaResult.processes[0]?.serviceNodeId, 'node-validated');
  assert.deepEqual(context.biaValidationScope, {
    biaValidatedIncluded: 1,
    biaExcludedPending: 2,
  });
});

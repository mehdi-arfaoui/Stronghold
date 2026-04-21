import { beforeAll, describe, expect, it } from 'vitest';

import { createAccountContext } from '../identity/index.js';
import type { MultiAccountScanResult } from '../orchestration/types.js';
import {
  PROD_ACCOUNT_ALIAS,
  PROD_ACCOUNT_ID,
  PARTITION,
  STAGING_ACCOUNT_ALIAS,
  STAGING_ACCOUNT_ID,
} from '../__fixtures__/multi-account/constants.js';
import {
  buildProdAccountEdges,
  buildProdAccountResources,
} from '../__fixtures__/multi-account/prod-account.fixture.js';
import {
  buildStagingAccountEdges,
  buildStagingAccountResources,
} from '../__fixtures__/multi-account/staging-account.fixture.js';
import { expectAccountSuccess } from './helpers/assertions.js';
import { runSyntheticMultiAccountScan } from './helpers/synthetic-scan-runner.js';

describe('Multi-Account Merge (synthetic)', () => {
  let result: MultiAccountScanResult;

  beforeAll(async () => {
    result = await runSyntheticMultiAccountScan({
      accounts: new Map([
        [
          PROD_ACCOUNT_ID,
          {
            resources: buildProdAccountResources(),
            edges: buildProdAccountEdges(),
            accountContext: createAccountContext({
              accountId: PROD_ACCOUNT_ID,
              accountAlias: PROD_ACCOUNT_ALIAS,
              partition: PARTITION,
            }),
          },
        ],
        [
          STAGING_ACCOUNT_ID,
          {
            resources: buildStagingAccountResources(),
            edges: buildStagingAccountEdges(),
            accountContext: createAccountContext({
              accountId: STAGING_ACCOUNT_ID,
              accountAlias: STAGING_ACCOUNT_ALIAS,
              partition: PARTITION,
            }),
          },
        ],
      ]),
    });
  });

  it('merges both accounts successfully', () => {
    expect(result.accounts).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('prod account has expected resources', () => {
    expectAccountSuccess(result, PROD_ACCOUNT_ID, 10);
  });

  it('staging account has expected resources', () => {
    expectAccountSuccess(result, STAGING_ACCOUNT_ID, 7);
  });

  it('merged graph contains nodes from both accounts', () => {
    const nodeAccountIds = new Set<string>();

    result.mergedGraph.forEachNode((_nodeId, attrs) => {
      if (typeof attrs.accountId === 'string') {
        nodeAccountIds.add(attrs.accountId);
      }
    });

    expect(nodeAccountIds.has(PROD_ACCOUNT_ID)).toBe(true);
    expect(nodeAccountIds.has(STAGING_ACCOUNT_ID)).toBe(true);
  });

  it('merged graph node count is at least the sum of fixture resources', () => {
    const prodCount = buildProdAccountResources().length;
    const stagingCount = buildStagingAccountResources().length;

    expect(result.mergedGraph.order).toBeGreaterThanOrEqual(prodCount + stagingCount);
  });

  it('summary is consistent', () => {
    expect(result.summary.totalAccounts).toBe(2);
    expect(result.summary.successfulAccounts).toBe(2);
    expect(result.summary.failedAccounts).toBe(0);
  });

  it('all resources carry the correct derived account attribution', () => {
    for (const accountResult of result.accounts) {
      for (const resource of accountResult.resources) {
        if (resource.service !== 'route53') {
          expect(resource.arn).toContain(accountResult.account.accountId);
        }
        expect(resource.account.accountId).toBe(accountResult.account.accountId);
      }
    }
  });
});

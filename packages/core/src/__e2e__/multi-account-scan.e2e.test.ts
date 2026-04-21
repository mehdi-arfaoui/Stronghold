import { beforeAll, describe, expect, it } from 'vitest';

import type { MultiAccountScanResult } from '../index.js';
import { getE2EConfig } from './helpers/e2e-config.js';
import { runE2EScan } from './helpers/e2e-scan-runner.js';

const config = getE2EConfig();
const describeE2E = config ? describe : describe.skip;

describeE2E('Multi-Account Scan E2E', () => {
  let result: MultiAccountScanResult;

  beforeAll(async () => {
    result = await runE2EScan(config!.configPath);
  }, 300_000);

  it('scans both accounts successfully', () => {
    expect(result.accounts).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.accounts.map((account) => account.account.accountId).sort()).toEqual(
      [config!.prodAccountId, config!.stagingAccountId].sort(),
    );
  });

  it('produces resources from both accounts', () => {
    for (const account of result.accounts) {
      expect(account.resources.length).toBeGreaterThan(0);
      expect(
        account.resources.some((resource) => resource.service === 'ec2' && resource.resourceType === 'vpc'),
      ).toBe(true);
      expect(
        account.resources.some((resource) => resource.service === 'ec2' && resource.resourceType === 'instance'),
      ).toBe(true);
      expect(account.resources.some((resource) => resource.service === 's3')).toBe(true);
    }
  });

  it('attributes resources to the correct accounts', () => {
    const expectedAccounts = new Set([config!.prodAccountId, config!.stagingAccountId]);

    for (const account of result.accounts) {
      for (const resource of account.resources) {
        expect(expectedAccounts.has(resource.account.accountId)).toBe(true);
        if (resource.service !== 'route53') {
          expect(resource.arn.includes(`:${resource.account.accountId}:`)).toBe(true);
        }
      }
    }
  });

  it('merged graph contains nodes from both accounts', () => {
    expect(result.mergedGraph.order).toBeGreaterThan(0);

    const accountIds = new Set<string>();
    result.mergedGraph.forEachNode((_nodeId, attrs) => {
      if (typeof attrs.accountId === 'string') {
        accountIds.add(attrs.accountId);
      }
    });

    expect(accountIds.has(config!.prodAccountId)).toBe(true);
    expect(accountIds.has(config!.stagingAccountId)).toBe(true);
  });

  it('completes the scan within 180 seconds', () => {
    expect(result.totalDurationMs).toBeLessThan(180_000);
  });

  it('keeps the summary consistent with detailed results', () => {
    const totalResources = result.accounts.reduce(
      (sum, account) => sum + account.resources.length,
      0,
    );

    expect(result.summary.totalAccounts).toBe(2);
    expect(result.summary.successfulAccounts).toBe(2);
    expect(result.summary.failedAccounts).toBe(0);
    expect(result.summary.totalResources).toBe(totalResources);
  });
});

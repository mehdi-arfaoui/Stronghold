import { describe, expect, it } from 'vitest';

import type { MultiAccountScanResult } from '../index.js';
import { getE2EConfig } from './helpers/e2e-config.js';
import {
  runE2EScan,
  runE2ESingleAccountScan,
} from './helpers/e2e-scan-runner.js';

const config = getE2EConfig();
const describeE2E = config ? describe : describe.skip;

describeE2E('Backward Compatibility E2E', () => {
  it('single-account profile scan produces valid results', async () => {
    const singleResult = await runE2ESingleAccountScan(
      config!.prodProfile,
      config!.region,
    );

    expect(singleResult.resourceCount).toBeGreaterThan(0);
    expect(singleResult.graph.order).toBeGreaterThan(0);
    expect(singleResult.resources.some((resource) => resource.service === 'ec2')).toBe(true);
  }, 300_000);

  it('single-account and multi-account scans stay within a 10 percent resource delta', async () => {
    const singleResult = await runE2ESingleAccountScan(
      config!.prodProfile,
      config!.region,
    );
    const multiResult: MultiAccountScanResult = await runE2EScan(config!.configPath);
    const prodInMulti = multiResult.accounts.find(
      (account) => account.account.accountId === config!.prodAccountId,
    );

    expect(prodInMulti).toBeDefined();
    const singleCount = singleResult.resourceCount;
    const multiCount = prodInMulti?.resources.length ?? 0;
    const tolerance = Math.max(Math.ceil(singleCount * 0.1), 3);

    expect(Math.abs(singleCount - multiCount)).toBeLessThanOrEqual(tolerance);
  }, 600_000);
});

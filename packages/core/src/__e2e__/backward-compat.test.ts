import { describe, expect, it } from 'vitest';

import { PROD_ACCOUNT_CONTEXT, PROD_ACCOUNT_ID } from '../__fixtures__/multi-account/constants.js';
import {
  buildProdAccountEdges,
  buildProdAccountResources,
} from '../__fixtures__/multi-account/prod-account.fixture.js';
import {
  runSyntheticMultiAccountScan,
  runSyntheticSingleAccountScan,
} from './helpers/synthetic-scan-runner.js';

describe('Backward Compatibility (synthetic)', () => {
  it('single-account scan produces a valid account result', async () => {
    const result = await runSyntheticSingleAccountScan({
      resources: buildProdAccountResources(),
      edges: buildProdAccountEdges(),
      accountContext: PROD_ACCOUNT_CONTEXT,
    });

    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.graph.order).toBeGreaterThan(0);
    expect(result.findings).toHaveLength(0);
  });

  it('multi-account mode with one account matches the single-account resource and graph counts', async () => {
    const singleResult = await runSyntheticSingleAccountScan({
      resources: buildProdAccountResources(),
      edges: buildProdAccountEdges(),
      accountContext: PROD_ACCOUNT_CONTEXT,
    });
    const multiResult = await runSyntheticMultiAccountScan({
      accounts: new Map([
        [
          PROD_ACCOUNT_ID,
          {
            resources: buildProdAccountResources(),
            edges: buildProdAccountEdges(),
            accountContext: PROD_ACCOUNT_CONTEXT,
          },
        ],
      ]),
    });

    const multiProd = multiResult.accounts.find(
      (account) => account.account.accountId === PROD_ACCOUNT_ID,
    );

    expect(multiProd).toBeDefined();
    expect(multiProd?.resources.length).toBe(singleResult.resources.length);
    expect(multiResult.mergedGraph.order).toBe(singleResult.graph.order);
    expect(multiResult.crossAccount.edges).toHaveLength(0);
  });
});

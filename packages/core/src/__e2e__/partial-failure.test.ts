import { describe, expect, it } from 'vitest';

import { AuthenticationError, buildAuthTarget } from '../auth/index.js';
import {
  PROD_ACCOUNT_CONTEXT,
  PROD_ACCOUNT_ID,
  PROD_REGION,
  STAGING_ACCOUNT_CONTEXT,
  STAGING_ACCOUNT_ID,
  STAGING_REGION,
} from '../__fixtures__/multi-account/constants.js';
import {
  buildProdAccountEdges,
  buildProdAccountResources,
} from '../__fixtures__/multi-account/prod-account.fixture.js';
import {
  expectAccountFailed,
  expectAccountSuccess,
  expectPartialEdgesNotInGraph,
} from './helpers/assertions.js';
import { runSyntheticMultiAccountScan } from './helpers/synthetic-scan-runner.js';

describe('Partial Failure (synthetic)', () => {
  it('continues scanning when one account fails authentication', async () => {
    const result = await runSyntheticMultiAccountScan({
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
      failedAccounts: new Map([
        [
          STAGING_ACCOUNT_ID,
          {
            accountContext: STAGING_ACCOUNT_CONTEXT,
            error: new AuthenticationError(
              'Access Denied: unable to assume role',
              buildAuthTarget({
                account: STAGING_ACCOUNT_CONTEXT,
                region: STAGING_REGION,
              }),
              'assume-role',
            ),
            phase: 'authentication',
          },
        ],
      ]),
    });

    expectAccountSuccess(result, PROD_ACCOUNT_ID, 10);
    expectAccountFailed(result, STAGING_ACCOUNT_ID, 'authentication');
    expect(result.summary.successfulAccounts).toBe(1);
    expect(result.summary.failedAccounts).toBe(1);
  });

  it('marks edges involving the failed account as partial', async () => {
    const result = await runSyntheticMultiAccountScan({
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
      failedAccounts: new Map([
        [
          STAGING_ACCOUNT_ID,
          {
            accountContext: STAGING_ACCOUNT_CONTEXT,
            error: new AuthenticationError(
              'Access Denied: unable to assume role',
              buildAuthTarget({
                account: STAGING_ACCOUNT_CONTEXT,
                region: STAGING_REGION,
              }),
              'assume-role',
            ),
            phase: 'authentication',
          },
        ],
      ]),
    });

    const edgesInvolvingStaging = result.crossAccount.edges.filter(
      (edge) =>
        edge.sourceAccountId === STAGING_ACCOUNT_ID ||
        edge.targetAccountId === STAGING_ACCOUNT_ID,
    );

    expect(edgesInvolvingStaging.length).toBeGreaterThan(0);
    for (const edge of edgesInvolvingStaging) {
      expect(edge.completeness).toBe('partial');
      expect(edge.missingAccountId).toBe(STAGING_ACCOUNT_ID);
    }

    expectPartialEdgesNotInGraph(result);
  });

  it('produces zero cross-account edges when all accounts fail', async () => {
    const result = await runSyntheticMultiAccountScan({
      accounts: new Map(),
      failedAccounts: new Map([
        [
          PROD_ACCOUNT_ID,
          {
            accountContext: PROD_ACCOUNT_CONTEXT,
            error: new AuthenticationError(
              'Access Denied: unable to assume role',
              buildAuthTarget({
                account: PROD_ACCOUNT_CONTEXT,
                region: PROD_REGION,
              }),
              'assume-role',
            ),
            phase: 'authentication',
          },
        ],
        [
          STAGING_ACCOUNT_ID,
          {
            accountContext: STAGING_ACCOUNT_CONTEXT,
            error: new AuthenticationError(
              'Access Denied: unable to assume role',
              buildAuthTarget({
                account: STAGING_ACCOUNT_CONTEXT,
                region: STAGING_REGION,
              }),
              'assume-role',
            ),
            phase: 'authentication',
          },
        ],
      ]),
    });

    expect(result.crossAccount.edges).toHaveLength(0);
    expect(result.summary.successfulAccounts).toBe(0);
    expect(result.summary.failedAccounts).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';

import type { AccountContext } from '../identity/index.js';
import type { MultiAccountScanResult } from '../orchestration/types.js';
import {
  PROD_ACCOUNT_CONTEXT,
  PROD_ACCOUNT_ID,
  STAGING_ACCOUNT_CONTEXT,
  STAGING_ACCOUNT_ID,
  STAGING_REGION,
} from '../__fixtures__/multi-account/constants.js';
import {
  buildProdAccountEdges,
  buildProdAccountResources,
} from '../__fixtures__/multi-account/prod-account.fixture.js';
import {
  buildStagingAccountEdges,
  buildStagingAccountResources,
} from '../__fixtures__/multi-account/staging-account.fixture.js';
import { runSyntheticMultiAccountScan } from './helpers/synthetic-scan-runner.js';
import { AuthenticationError, buildAuthTarget } from '../auth/index.js';

describe('CLI Output Format (synthetic)', () => {
  it('JSON output contains accounts, crossAccount, and summary sections', async () => {
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
        [
          STAGING_ACCOUNT_ID,
          {
            resources: buildStagingAccountResources(),
            edges: buildStagingAccountEdges(),
            accountContext: STAGING_ACCOUNT_CONTEXT,
          },
        ],
      ]),
    });

    const payload = serializeSyntheticCliOutput(result, [
      PROD_ACCOUNT_CONTEXT,
      STAGING_ACCOUNT_CONTEXT,
    ]);
    const parsed = JSON.parse(JSON.stringify(payload)) as {
      readonly scan: {
        readonly accounts: readonly unknown[];
        readonly errors: readonly unknown[];
        readonly crossAccount: {
          readonly edges: readonly unknown[];
          readonly summary: Record<string, unknown>;
        };
        readonly summary: Record<string, unknown>;
      };
    };

    expect(parsed.scan.accounts).toHaveLength(2);
    expect(parsed.scan.errors).toHaveLength(0);
    expect(Array.isArray(parsed.scan.crossAccount.edges)).toBe(true);
    expect(parsed.scan.crossAccount.summary).toBeDefined();
    expect(parsed.scan.summary).toBeDefined();
  });

  it('JSON output marks failed accounts explicitly during partial failure', async () => {
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

    const payload = serializeSyntheticCliOutput(result, [
      PROD_ACCOUNT_CONTEXT,
      STAGING_ACCOUNT_CONTEXT,
    ]);
    const accounts = payload.scan.accounts;

    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.accountId === PROD_ACCOUNT_ID)?.status).toBe('success');
    expect(accounts.find((account) => account.accountId === STAGING_ACCOUNT_ID)?.status).toBe('failed');
    expect(payload.scan.errors).toHaveLength(1);
  });

  it('summary.crossAccountEdges matches the detected edge count', async () => {
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
        [
          STAGING_ACCOUNT_ID,
          {
            resources: buildStagingAccountResources(),
            edges: buildStagingAccountEdges(),
            accountContext: STAGING_ACCOUNT_CONTEXT,
          },
        ],
      ]),
    });

    const payload = serializeSyntheticCliOutput(result, [
      PROD_ACCOUNT_CONTEXT,
      STAGING_ACCOUNT_CONTEXT,
    ]);

    expect(payload.scan.summary.crossAccountEdges).toBe(result.crossAccount.edges.length);
  });
});

function serializeSyntheticCliOutput(
  result: MultiAccountScanResult,
  requestedAccounts: readonly AccountContext[],
): {
  readonly scan: {
    readonly accounts: readonly {
      readonly accountId: string;
      readonly alias: string | null;
      readonly status: 'success' | 'failed';
      readonly resourceCount?: number;
      readonly findingCount?: number;
      readonly scanDurationMs?: number;
      readonly error?: string;
    }[];
    readonly errors: readonly {
      readonly accountId: string;
      readonly alias: string | null;
      readonly phase: string;
      readonly message: string;
      readonly timestamp: string;
    }[];
    readonly crossAccount: {
      readonly edges: readonly MultiAccountScanResult['crossAccount']['edges'];
      readonly summary: {
        readonly total: number;
        readonly complete: number;
        readonly partial: number;
        readonly critical: number;
        readonly degraded: number;
        readonly informational: number;
        readonly byKind: Readonly<Record<string, number>>;
      };
    };
    readonly summary: {
      readonly totalAccounts: number;
      readonly successfulAccounts: number;
      readonly failedAccounts: number;
      readonly totalResources: number;
      readonly resourcesByAccount: Readonly<Record<string, number>>;
      readonly totalFindings: number;
      readonly findingsByAccount: Readonly<Record<string, number>>;
      readonly crossAccountEdges: number;
    };
  };
} {
  const successById = new Map(
    result.accounts.map((account) => [account.account.accountId, account] as const),
  );
  const errorById = new Map(
    result.errors.map((error) => [error.account.accountId, error] as const),
  );

  return {
    scan: {
      accounts: requestedAccounts.map((account) => {
        const success = successById.get(account.accountId);
        if (success) {
          return {
            accountId: account.accountId,
            alias: account.accountAlias,
            status: 'success' as const,
            resourceCount: success.resources.length,
            findingCount: success.findings.length,
            scanDurationMs: success.scanDurationMs,
          };
        }

        const error = errorById.get(account.accountId);
        return {
          accountId: account.accountId,
          alias: account.accountAlias,
          status: 'failed' as const,
          error: error?.error.message ?? 'unknown error',
        };
      }),
      errors: result.errors.map((error) => ({
        accountId: error.account.accountId,
        alias: error.account.accountAlias,
        phase: error.phase,
        message: error.error.message,
        timestamp: error.timestamp.toISOString(),
      })),
      crossAccount: {
        edges: result.crossAccount.edges,
        summary: {
          total: result.crossAccount.summary.total,
          complete: result.crossAccount.summary.complete,
          partial: result.crossAccount.summary.partial,
          critical: result.crossAccount.summary.critical,
          degraded: result.crossAccount.summary.degraded,
          informational: result.crossAccount.summary.informational,
          byKind: Object.fromEntries(
            [...result.crossAccount.summary.byKind.entries()].sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        },
      },
      summary: {
        totalAccounts: result.summary.totalAccounts,
        successfulAccounts: result.summary.successfulAccounts,
        failedAccounts: result.summary.failedAccounts,
        totalResources: result.summary.totalResources,
        resourcesByAccount: Object.fromEntries(
          [...result.summary.resourcesByAccount.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
        totalFindings: result.summary.totalFindings,
        findingsByAccount: Object.fromEntries(
          [...result.summary.findingsByAccount.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
        crossAccountEdges: result.summary.crossAccountEdges,
      },
    },
  };
}

import { MultiDirectedGraph } from 'graphology';

import {
  AuthenticationError,
  CredentialExpiredError,
  NoAuthProviderAvailableError,
} from '../auth/index.js';
import type { GraphInstance } from '../graph/graph-instance.js';
import {
  ConcurrencyLimiter,
} from './concurrency-limiter.js';
import type {
  AccountScanError,
  AccountScanPhase,
  AccountScanResult,
  AccountScanTarget,
  MultiAccountScanResult,
  MultiAccountSummary,
  ScanEngine,
} from './types.js';
import {
  DEFAULT_ACCOUNT_SCAN_TIMEOUT_MS,
  DEFAULT_MULTI_ACCOUNT_CONCURRENCY,
  ScanExecutionError,
} from './types.js';

/**
 * Orchestre le scan de N comptes AWS avec concurrence limitée.
 */
export class MultiAccountOrchestrator {
  private readonly maxConcurrency: number;
  private readonly scanEngine: ScanEngine;
  private readonly onAccountStart?: (account: AccountScanTarget['account']) => void;
  private readonly onAccountComplete?: (
    account: AccountScanTarget['account'],
    result: AccountScanResult,
  ) => void;
  private readonly onAccountError?: (
    account: AccountScanTarget['account'],
    error: Error,
  ) => void;

  public constructor(options: {
    maxConcurrency?: number;
    scanEngine: ScanEngine;
    onAccountStart?: (account: AccountScanTarget['account']) => void;
    onAccountComplete?: (
      account: AccountScanTarget['account'],
      result: AccountScanResult,
    ) => void;
    onAccountError?: (account: AccountScanTarget['account'], error: Error) => void;
  }) {
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MULTI_ACCOUNT_CONCURRENCY;
    this.scanEngine = options.scanEngine;
    this.onAccountStart = options.onAccountStart;
    this.onAccountComplete = options.onAccountComplete;
    this.onAccountError = options.onAccountError;
  }

  public async scan(
    targets: readonly AccountScanTarget[],
  ): Promise<MultiAccountScanResult> {
    const startedAt = Date.now();
    const limiter = new ConcurrencyLimiter(this.maxConcurrency);

    const settled = await limiter.all(
      targets.map((target) => async () => this.scanSingleTarget(target)),
    );

    const accounts: AccountScanResult[] = [];
    const errors: AccountScanError[] = [];

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        accounts.push(result.value);
        return;
      }

      const target = targets[index];
      if (!target) {
        return;
      }

      errors.push({
        account: target.account,
        phase: detectScanPhase(result.reason),
        error: normalizeError(result.reason),
        timestamp: new Date(),
      });
    });

    const merged = mergeAccountResults(accounts);
    return {
      accounts,
      mergedGraph: merged.mergedGraph,
      mergedFindings: merged.mergedFindings,
      errors,
      totalDurationMs: Date.now() - startedAt,
      summary: finalizeSummary(merged.summary, targets.length, errors.length),
    };
  }

  private async scanSingleTarget(
    target: AccountScanTarget,
  ): Promise<AccountScanResult> {
    this.onAccountStart?.(target.account);

    try {
      const result = await runWithTimeout(
        () => this.scanEngine.scanAccount(target),
        target.scanTimeoutMs ?? DEFAULT_ACCOUNT_SCAN_TIMEOUT_MS,
      );
      this.onAccountComplete?.(target.account, result);
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      this.onAccountError?.(target.account, normalized);
      throw normalized;
    }
  }
}

function finalizeSummary(
  summary: MultiAccountSummary,
  totalAccounts: number,
  failedAccounts: number,
): MultiAccountSummary {
  return {
    ...summary,
    totalAccounts,
    successfulAccounts: summary.successfulAccounts,
    failedAccounts,
  };
}

function detectScanPhase(error: unknown): AccountScanPhase {
  if (
    error instanceof AuthenticationError ||
    error instanceof NoAuthProviderAvailableError ||
    error instanceof CredentialExpiredError
  ) {
    return 'authentication';
  }

  if (
    error instanceof ScanExecutionError ||
    (error instanceof Error && error.name === 'TimeoutError')
  ) {
    return 'scanning';
  }

  return 'processing';
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

async function runWithTimeout<TValue>(
  fn: () => Promise<TValue>,
  timeoutMs: number,
): Promise<TValue> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<TValue>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const timeoutError = new ScanExecutionError(
        `Account scan exceeded ${timeoutMs}ms timeout.`,
      );
      timeoutError.name = 'TimeoutError';
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function mergeAccountResults(
  results: readonly AccountScanResult[],
): {
  mergedGraph: GraphInstance;
  mergedFindings: readonly AccountScanResult[number]['findings'][number][];
  summary: MultiAccountSummary;
} {
  const mergedGraph = new MultiDirectedGraph<Record<string, unknown>, Record<string, unknown>>();
  const resourcesByAccount = new Map<string, number>();
  const findingsByAccount = new Map<string, number>();
  const mergedFindings: AccountScanResult[number]['findings'][number][] = [];

  for (const result of results) {
    resourcesByAccount.set(result.account.accountId, result.resources.length);
    findingsByAccount.set(result.account.accountId, result.findings.length);
    mergedFindings.push(...result.findings);

    result.graph.forEachNode((nodeId, attrs) => {
      if (mergedGraph.hasNode(nodeId)) {
        process.emitWarning(
          `Duplicate ARN detected during multi-account merge: ${nodeId}. Keeping the first node.`,
        );
        return;
      }

      mergedGraph.addNode(nodeId, {
        ...attrs,
        accountId:
          typeof attrs.accountId === 'string' && attrs.accountId.length > 0
            ? attrs.accountId
            : result.account.accountId,
      });
    });

    result.graph.forEachEdge((edgeKey, attrs, source, target) => {
      if (!mergedGraph.hasNode(source) || !mergedGraph.hasNode(target)) {
        return;
      }

      const type =
        typeof attrs.type === 'string' && attrs.type.length > 0
          ? attrs.type
          : 'DEPENDS_ON';
      const mergedEdgeKey = `${source}->${target}:${type}:${String(edgeKey)}`;
      if (mergedGraph.hasEdge(mergedEdgeKey)) {
        return;
      }

      mergedGraph.addEdgeWithKey(mergedEdgeKey, source, target, { ...attrs });
    });
  }

  return {
    mergedGraph: mergedGraph as unknown as GraphInstance,
    mergedFindings,
    summary: {
      totalAccounts: results.length,
      successfulAccounts: results.length,
      failedAccounts: 0,
      totalResources: sumMapValues(resourcesByAccount),
      resourcesByAccount,
      totalFindings: sumMapValues(findingsByAccount),
      findingsByAccount,
      crossAccountEdges: 0,
    },
  };
}

function sumMapValues(values: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const value of values.values()) {
    total += value;
  }
  return total;
}

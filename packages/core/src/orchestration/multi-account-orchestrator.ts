import {
  AuthenticationError,
  CredentialExpiredError,
  NoAuthProviderAvailableError,
} from '../auth/index.js';
import {
  CrossAccountDetector,
  createEmptyCrossAccountDetectionResult,
} from '../cross-account/index.js';
import {
  ConcurrencyLimiter,
} from './concurrency-limiter.js';
import { ScanResultMerger } from './scan-result-merger.js';
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
  private readonly crossAccountDetector: CrossAccountDetector;
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
    crossAccountDetector?: CrossAccountDetector;
    onAccountStart?: (account: AccountScanTarget['account']) => void;
    onAccountComplete?: (
      account: AccountScanTarget['account'],
      result: AccountScanResult,
    ) => void;
    onAccountError?: (account: AccountScanTarget['account'], error: Error) => void;
  }) {
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MULTI_ACCOUNT_CONCURRENCY;
    this.scanEngine = options.scanEngine;
    this.crossAccountDetector = options.crossAccountDetector ?? new CrossAccountDetector();
    this.onAccountStart = options.onAccountStart;
    this.onAccountComplete = options.onAccountComplete;
    this.onAccountError = options.onAccountError;
  }

  public async scan(
    targets: readonly AccountScanTarget[],
  ): Promise<MultiAccountScanResult> {
    const startedAt = Date.now();
    const limiter = new ConcurrencyLimiter(this.maxConcurrency);
    const merger = new ScanResultMerger();

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

    const merged = merger.merge(accounts);
    const totalDurationMs = Date.now() - startedAt;
    const baseSummary = finalizeSummary(merged.summary, targets.length, errors.length);
    const provisionalResult: MultiAccountScanResult = {
      accounts,
      mergedGraph: merged.mergedGraph,
      mergedFindings: merged.mergedFindings,
      crossAccount: createEmptyCrossAccountDetectionResult(),
      errors,
      totalDurationMs,
      summary: baseSummary,
    };
    const crossAccount = this.crossAccountDetector.detect(
      merged.mergedGraph,
      provisionalResult,
    );

    return {
      accounts,
      mergedGraph: merged.mergedGraph,
      mergedFindings: merged.mergedFindings,
      crossAccount,
      errors,
      totalDurationMs,
      summary: {
        ...baseSummary,
        crossAccountEdges: crossAccount.summary.total,
      },
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

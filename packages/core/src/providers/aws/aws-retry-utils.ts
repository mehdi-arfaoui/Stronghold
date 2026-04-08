import { sleep } from './scan-utils.js';

export interface AwsRetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoffMs: number;
  readonly backoffMultiplier: number;
  readonly maxJitterMs: number;
}

export const DEFAULT_AWS_RETRY_POLICY: AwsRetryPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 1_000,
  backoffMultiplier: 2,
  maxJitterMs: 250,
};

export function getAwsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const candidate = error as Record<string, unknown>;
  return String(candidate.name ?? candidate.Code ?? candidate.code ?? '');
}

export function getAwsErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export function getAwsFailureType(error: unknown): string {
  const code = getAwsErrorCode(error);
  if (code) {
    return code;
  }
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name;
  }
  return 'UnknownError';
}

export function isAwsThrottlingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  const code = getAwsErrorCode(error).toLowerCase();
  const message = getAwsErrorMessage(error).toLowerCase();
  if (
    code.includes('throttl') ||
    code.includes('toomanyrequests') ||
    code === 'priorrequestnotcomplete' ||
    code === 'provisionedthroughputexceededexception' ||
    message.includes('throttl') ||
    message.includes('too many requests') ||
    message.includes('rate exceeded')
  ) {
    return true;
  }

  if (candidate.$retryable && typeof candidate.$retryable === 'object') {
    return (candidate.$retryable as Record<string, unknown>).throttling === true;
  }

  return false;
}

export function isAwsAbortError(error: unknown): boolean {
  const failureType = getAwsFailureType(error).toLowerCase();
  if (failureType === 'aborterror' || failureType.includes('timeout')) {
    return true;
  }

  const message = getAwsErrorMessage(error).toLowerCase();
  return message.includes('aborted') || message.includes('timed out');
}

export function isAwsAccessDeniedError(error: unknown): boolean {
  const code = getAwsErrorCode(error).toLowerCase();
  const message = getAwsErrorMessage(error).toLowerCase();
  return (
    code.includes('accessdenied') ||
    message.includes('access denied') ||
    message.includes('not authorized')
  );
}

export function computeRetryDelayMs(
  retryAttempt: number,
  policy: AwsRetryPolicy = DEFAULT_AWS_RETRY_POLICY,
  random = Math.random,
): number {
  const baseDelay =
    policy.initialBackoffMs * policy.backoffMultiplier ** Math.max(retryAttempt - 1, 0);
  const jitterCap = Math.min(policy.maxJitterMs, Math.round(baseDelay * 0.25));
  return baseDelay + Math.round(random() * jitterCap);
}

interface RunAwsReadWithRetryOptions {
  readonly description: string;
  readonly warnings?: string[];
  readonly warningDeduper?: Set<string>;
  readonly retryPolicy?: AwsRetryPolicy;
  readonly random?: () => number;
  readonly ignoreErrorCodes?: readonly string[];
  readonly ignoreError?: (error: unknown) => boolean;
}

export function addWarningOnce(
  warnings: string[],
  deduper: Set<string> | undefined,
  key: string,
  message: string,
): void {
  if (deduper?.has(key)) {
    return;
  }
  deduper?.add(key);
  warnings.push(message);
}

export async function runAwsReadWithRetry<TValue>(
  action: () => Promise<TValue>,
  options: RunAwsReadWithRetryOptions,
): Promise<TValue | null> {
  const retryPolicy = options.retryPolicy ?? DEFAULT_AWS_RETRY_POLICY;
  let retryCount = 0;

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (
        options.ignoreErrorCodes?.includes(getAwsFailureType(error)) ||
        options.ignoreError?.(error) === true
      ) {
        return null;
      }

      if (isAwsAbortError(error)) {
        throw error;
      }

      if (isAwsThrottlingError(error) && attempt < retryPolicy.maxAttempts) {
        retryCount += 1;
        await sleep(computeRetryDelayMs(retryCount, retryPolicy, options.random));
        continue;
      }

      if (options.warnings) {
        const failureType = getAwsFailureType(error);
        addWarningOnce(
          options.warnings,
          options.warningDeduper,
          `${options.description}|${failureType}`,
          `${options.description} (${failureType}). Continuing without tags.`,
        );
      }
      return null;
    }
  }

  return null;
}

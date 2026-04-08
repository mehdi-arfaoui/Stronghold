import { normalizeTagValue } from './tag-utils.internal.js';
import { runAwsReadWithRetry, type AwsRetryPolicy } from './aws-retry-utils.js';

export { addWarningOnce, runAwsReadWithRetry } from './aws-retry-utils.js';

export interface AwsTagLike {
  readonly Key?: string;
  readonly key?: string;
  readonly Value?: string;
  readonly value?: string;
}

export function tagsArrayToMap(tags: readonly AwsTagLike[] | undefined | null): Record<string, string> {
  const result: Record<string, string> = {};

  for (const tag of tags ?? []) {
    const key = normalizeTagValue(tag.Key ?? tag.key);
    if (!key) continue;
    result[key] = tag.Value ?? tag.value ?? '';
  }

  return result;
}

export function normalizeTagMap(
  tags: Record<string, string | undefined> | undefined | null,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(tags ?? {})) {
    const key = normalizeTagValue(rawKey);
    if (!key) continue;
    result[key] = rawValue ?? '';
  }

  return result;
}

export function getNameTag(tags: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(tags)) {
    if (key.toLowerCase() !== 'name') continue;
    const normalized = normalizeTagValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

interface FetchAwsTagsWithRetryOptions {
  readonly description: string;
  readonly warnings?: string[];
  readonly warningDeduper?: Set<string>;
  readonly retryPolicy?: AwsRetryPolicy;
  readonly random?: () => number;
  readonly ignoreErrorCodes?: readonly string[];
  readonly ignoreError?: (error: unknown) => boolean;
}

export async function fetchAwsTagsWithRetry<TResponse>(
  action: () => Promise<TResponse>,
  extractTags: (response: TResponse) => Record<string, string>,
  options: FetchAwsTagsWithRetryOptions,
): Promise<Record<string, string>> {
  const response = await runAwsReadWithRetry(action, options);
  return response ? normalizeTagMap(extractTags(response)) : {};
}

/**
 * Shared utilities for AWS service scanners.
 */

import {
  createAccountContext,
  type AccountContext,
} from '../../identity/index.js';
import {
  createResource as createDiscoveredResource,
  type CreateResourceInput,
  type DiscoveredResource,
} from '../../types/discovery.js';
import { getCallerIdentity } from './get-caller-identity.js';
import type { AwsClientOptions } from './aws-client-factory.js';

/** Paginates an AWS SDK call and concatenates items from every page. */
export async function paginateAws<TResponse, TItem>(
  callFn: (nextToken?: string) => Promise<TResponse>,
  extractItems: (response: TResponse) => TItem[] | undefined,
  getNextToken: (response: TResponse) => string | undefined | null,
): Promise<TItem[]> {
  const allItems: TItem[] = [];
  let nextToken: string | undefined;

  do {
    const response = await callFn(nextToken);
    const items = extractItems(response) || [];
    allItems.push(...items);
    nextToken = getNextToken(response) ?? undefined;
  } while (nextToken);

  return allItems;
}

/** Builds a DiscoveredResource with validated ARN-backed identity. */
export function createResource(input: CreateResourceInput): DiscoveredResource {
  return createDiscoveredResource({
    name: input.name ?? input.arn,
    kind: input.kind ?? 'infra',
    ...input,
  });
}

export function inferAwsPartition(region: string): string {
  const normalized = region.trim().toLowerCase();
  if (normalized.startsWith('cn-')) {
    return 'aws-cn';
  }
  if (normalized.startsWith('us-gov-')) {
    return 'aws-us-gov';
  }
  return 'aws';
}

export function createAccountContextResolver(
  options: AwsClientOptions,
): () => Promise<AccountContext> {
  let accountContextPromise: Promise<AccountContext> | null = null;

  return async () => {
    if (!accountContextPromise) {
      accountContextPromise = getCallerIdentity({
        ...options.credentials,
        region: options.region,
      }).then((identity) => {
        if (!identity) {
          throw new Error(`Unable to resolve AWS account identity for region ${options.region}.`);
        }

        return createAccountContext({
          accountId: identity.accountId,
          partition: inferAwsPartition(options.region),
        });
      });
    }

    return accountContextPromise;
  };
}

/** Process items in batches with a concurrency limit. */
export async function processInBatches<TItem, TResult>(
  items: TItem[],
  batchSize: number,
  processor: (item: TItem) => Promise<TResult>,
): Promise<PromiseSettledResult<TResult>[]> {
  const results: PromiseSettledResult<TResult>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/** Process items with a bounded concurrency limit while preserving item order. */
export async function processWithConcurrencyLimit<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  processor: (item: TItem, index: number) => Promise<TResult>,
): Promise<PromiseSettledResult<TResult>[]> {
  const results = new Array<PromiseSettledResult<TResult>>(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await processor(items[index] as TItem, index),
        };
      } catch (error) {
        results[index] = {
          status: 'rejected',
          reason: error,
        };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

const BUSINESS_TAG_KEYS = new Set(
  [
    'Business',
    'BusinessUnit',
    'business-unit',
    'CostCenter',
    'cost-center',
    'cost_center',
    'Application',
    'app',
    'application',
    'Service',
    'service-name',
    'Environment',
    'env',
    'Owner',
    'team',
    'Team',
    'Revenue',
    'revenue-stream',
    'Criticality',
    'criticality-level',
  ].map((key) => key.toLowerCase()),
);

/** Extracts business-relevant tags from raw tag data. */
export function toBusinessTagMap(rawTags: unknown): Record<string, string> {
  const businessTags: Record<string, string> = {};

  if (Array.isArray(rawTags)) {
    for (const rawTag of rawTags) {
      if (typeof rawTag !== 'string') continue;
      const [rawKey, ...rest] = rawTag.split(':');
      const key = String(rawKey || '').trim();
      const value = rest.join(':').trim();
      if (!key || !value) continue;
      if (!BUSINESS_TAG_KEYS.has(key.toLowerCase())) continue;
      businessTags[key] = value;
    }
    return businessTags;
  }

  if (rawTags && typeof rawTags === 'object' && !Array.isArray(rawTags)) {
    for (const [key, value] of Object.entries(rawTags as Record<string, unknown>)) {
      if (!BUSINESS_TAG_KEYS.has(key.toLowerCase())) continue;
      if (value == null) continue;
      const normalized = String(value).trim();
      if (!normalized) continue;
      businessTags[key] = normalized;
    }
  }

  return businessTags;
}

/**
 * Shared utilities for AWS service scanners.
 */

import type { DiscoveredResource } from '../../types/discovery.js';

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

/** Builds a DiscoveredResource with sensible defaults. */
export function buildResource(
  input: Partial<DiscoveredResource> & { source: string; externalId: string },
): DiscoveredResource {
  return {
    name: input.name || input.externalId,
    kind: input.kind || 'infra',
    type: input.type || 'CLOUD',
    ...input,
  } satisfies DiscoveredResource;
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

import * as cache from '@actions/cache';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import type { ActionConfig } from './config';
import type { ScanResult } from './scanner';

export interface CategoryChange {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface Comparison {
  readonly hasBaseline: boolean;
  readonly baselineScore: number | null;
  readonly currentScore: number;
  readonly delta: number;
  readonly newFailures: readonly string[];
  readonly resolvedFailures: readonly string[];
  readonly categoryChanges: Readonly<Record<string, CategoryChange>>;
}

interface BaselineSnapshot {
  readonly score: number;
  readonly failures: readonly string[];
  readonly categories: Readonly<Record<string, number>>;
}

const BASELINE_FILENAME = 'baseline-score.json';

/** Restore the previous branch baseline, compare it with the current scan, then persist the new baseline. */
export async function compareWithBaseline(
  current: ScanResult,
  config: ActionConfig,
): Promise<Comparison> {
  const baselinePath = path.join(config.workspaceRoot, '.stronghold', BASELINE_FILENAME);
  const baseline = await restoreBaseline(config, baselinePath);
  const comparison = buildComparison(current, baseline);

  await persistBaseline(current, config, baselinePath);
  return comparison;
}

async function restoreBaseline(
  config: ActionConfig,
  baselinePath: string,
): Promise<BaselineSnapshot | null> {
  try {
    await cache.restoreCache(
      [baselinePath],
      buildPrimaryKey(config),
      buildRestoreKeys(config),
    );
    await access(baselinePath, constants.F_OK);
    const raw = await readFile(baselinePath, 'utf8');
    return JSON.parse(raw) as BaselineSnapshot;
  } catch {
    return null;
  }
}

async function persistBaseline(
  current: ScanResult,
  config: ActionConfig,
  baselinePath: string,
): Promise<void> {
  const snapshot: BaselineSnapshot = {
    score: current.score,
    failures: current.failureIds,
    categories: current.categories,
  };

  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  try {
    await cache.saveCache([baselinePath], buildSaveKey(config));
  } catch {
    return;
  }
}

function buildComparison(
  current: ScanResult,
  baseline: BaselineSnapshot | null,
): Comparison {
  const baselineFailures = baseline?.failures ?? [];
  const currentFailures = current.failureIds;

  return {
    hasBaseline: baseline !== null,
    baselineScore: baseline?.score ?? null,
    currentScore: current.score,
    delta: baseline ? current.score - baseline.score : 0,
    newFailures: currentFailures.filter((failureId) => !baselineFailures.includes(failureId)),
    resolvedFailures: baselineFailures.filter(
      (failureId) => !currentFailures.includes(failureId),
    ),
    categoryChanges: buildCategoryChanges(current.categories, baseline?.categories ?? {}),
  };
}

function buildCategoryChanges(
  current: Readonly<Record<string, number>>,
  baseline: Readonly<Record<string, number>>,
): Readonly<Record<string, CategoryChange>> {
  const names = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  return Array.from(names).reduce<Record<string, CategoryChange>>((changes, name) => {
    const after = current[name] ?? 0;
    const before = baseline[name] ?? after;
    changes[name] = { before, after, delta: after - before };
    return changes;
  }, {});
}

function buildPrimaryKey(config: ActionConfig): string {
  return `${buildCachePrefix(config.currentBranch, config)}${sanitize(config.sha)}`;
}

function buildRestoreKeys(config: ActionConfig): string[] {
  const currentPrefix = buildCachePrefix(config.currentBranch, config);
  const baselinePrefix = buildCachePrefix(config.comparisonBranch, config);
  return currentPrefix === baselinePrefix
    ? [currentPrefix]
    : [currentPrefix, baselinePrefix];
}

function buildSaveKey(config: ActionConfig): string {
  return `${buildPrimaryKey(config)}-${sanitize(config.runId)}`;
}

function buildCachePrefix(branch: string, config: ActionConfig): string {
  return [
    'stronghold-baseline',
    sanitize(branch),
    sanitize(config.baselineBranch),
    sanitize(config.regions.join('-')),
    sanitize(config.services.join('-') || 'all'),
  ].join('-') + '-';
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

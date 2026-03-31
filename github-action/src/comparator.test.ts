import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const restoreCache = vi.fn();
const saveCache = vi.fn();

vi.mock('@actions/cache', () => ({
  restoreCache,
  saveCache,
}));

describe('compareWithBaseline', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await createTempWorkspace();
    restoreCache.mockReset();
    saveCache.mockReset();
    restoreCache.mockResolvedValue(undefined);
    saveCache.mockResolvedValue(1);
  });

  afterEach(() => {
    restoreCache.mockReset();
    saveCache.mockReset();
  });

  it('returns delta 0 without baseline', async () => {
    const { compareWithBaseline } = await import('./comparator');
    const comparison = await compareWithBaseline(createScanResult(), createConfig(workspaceRoot));

    expect(comparison.hasBaseline).toBe(false);
    expect(comparison.delta).toBe(0);
  });

  it('calculates the delta from an existing baseline', async () => {
    const baselinePath = await writeBaseline(workspaceRoot, {
      score: 70,
      failures: [],
      categories: { backup: 70 },
    });
    restoreCache.mockResolvedValue('stronghold-baseline-feature');

    const { compareWithBaseline } = await import('./comparator');
    const comparison = await compareWithBaseline(createScanResult(), createConfig(workspaceRoot));

    expect(comparison.hasBaseline).toBe(true);
    expect(comparison.baselineScore).toBe(70);
    expect(comparison.delta).toBe(-8);
    expect(restoreCache).toHaveBeenCalledWith(
      [baselinePath],
      expect.stringContaining('feature-dr-check'),
      expect.arrayContaining([expect.stringContaining('main')]),
    );
  });

  it('detects new failures', async () => {
    await writeBaseline(workspaceRoot, {
      score: 70,
      failures: ['old_rule:db'],
      categories: { backup: 70 },
    });
    restoreCache.mockResolvedValue('stronghold-baseline-feature');

    const { compareWithBaseline } = await import('./comparator');
    const comparison = await compareWithBaseline(createScanResult(), createConfig(workspaceRoot));

    expect(comparison.newFailures).toContain('backup_plan_exists:prod-db-primary');
  });

  it('detects resolved failures', async () => {
    await writeBaseline(workspaceRoot, {
      score: 70,
      failures: ['old_rule:db', 'backup_plan_exists:prod-db-primary'],
      categories: { backup: 70 },
    });
    restoreCache.mockResolvedValue('stronghold-baseline-feature');

    const { compareWithBaseline } = await import('./comparator');
    const comparison = await compareWithBaseline(
      { ...createScanResult(), failureIds: ['backup_plan_exists:prod-db-primary'] },
      createConfig(workspaceRoot),
    );

    expect(comparison.resolvedFailures).toEqual(['old_rule:db']);
  });

  it('calculates category changes', async () => {
    await writeBaseline(workspaceRoot, {
      score: 70,
      failures: [],
      categories: { backup: 70, redundancy: 80 },
    });
    restoreCache.mockResolvedValue('stronghold-baseline-feature');

    const { compareWithBaseline } = await import('./comparator');
    const comparison = await compareWithBaseline(createScanResult(), createConfig(workspaceRoot));

    expect(comparison.categoryChanges.backup).toEqual({ before: 70, after: 50, delta: -20 });
    expect(comparison.categoryChanges.redundancy).toEqual({ before: 80, after: 70, delta: -10 });
  });
});

async function createTempWorkspace(): Promise<string> {
  const workspaceRoot = path.join(
    os.tmpdir(),
    `stronghold-action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(workspaceRoot, { recursive: true });
  return workspaceRoot;
}

async function writeBaseline(
  workspaceRoot: string,
  baseline: {
    score: number;
    failures: readonly string[];
    categories: Readonly<Record<string, number>>;
  },
): Promise<string> {
  const baselinePath = path.join(workspaceRoot, '.stronghold', 'baseline-score.json');
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return baselinePath;
}

function createConfig(workspaceRoot: string) {
  return {
    regions: ['eu-west-1'],
    awsAccessKeyId: 'access-key',
    awsSecretAccessKey: 'secret-key',
    services: [],
    failOnScoreDrop: 0,
    failUnderScore: 0,
    commentOnPR: true,
    baselineBranch: 'main',
    comparisonBranch: 'main',
    currentBranch: 'feature/dr-check',
    repositoryOwner: 'mehdi-arfaoui',
    repositoryName: 'stronghold',
    sha: 'abc123',
    runId: '42',
    workspaceRoot,
  };
}

function createScanResult() {
  return {
    score: 62,
    grade: 'C',
    criticalCount: 1,
    highCount: 1,
    totalChecks: 12,
    passed: 8,
    failed: 3,
    warnings: 1,
    categories: { backup: 50, redundancy: 70 },
    topFailures: [],
    failureIds: ['backup_plan_exists:prod-db-primary'],
  };
}

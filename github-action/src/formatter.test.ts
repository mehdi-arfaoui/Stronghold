import { describe, expect, it } from 'vitest';

import { formatComment } from './formatter';

describe('formatComment', () => {
  it('contains the score and grade', () => {
    const comment = formatComment(createScan(), createComparison(), createConfig());
    expect(comment).toContain('DR Posture Score: 62/100 (Grade: C)');
  });

  it('contains the delta when a baseline exists', () => {
    const comment = formatComment(createScan(), createComparison(), createConfig());
    expect(comment).toContain('📉 Score change: **-8** (baseline: 70)');
  });

  it('shows the first scan message when no baseline exists', () => {
    const comment = formatComment(
      createScan(),
      { ...createComparison(), hasBaseline: false, baselineScore: null, delta: 0 },
      createConfig(),
    );
    expect(comment).toContain('First scan — no baseline to compare against.');
  });

  it('lists new critical failures with the new badge', () => {
    const comment = formatComment(createScan(), createComparison(), createConfig());
    expect(comment).toContain('**backup_plan_exists** — `prod-db-primary` 🆕');
  });

  it('renders resolved failures with a check mark and strikethrough', () => {
    const comment = formatComment(createScan(), createComparison(), createConfig());
    expect(comment).toContain('✅ ~~multi_az_enabled:legacy-db~~ — fixed');
  });

  it('renders category bars correctly', () => {
    const comment = formatComment(createScan(), createComparison(), createConfig());
    expect(comment).toContain('| backup | █████░░░░░ 50/100 | ⚠️ -20 |');
  });

  it('includes the Stronghold footer link', () => {
    const comment = formatComment(createScan(), createComparison(), createConfig());
    expect(comment).toContain('[Stronghold](https://github.com/mehdi-arfaoui/stronghold)');
  });
});

function createScan() {
  return {
    score: 62,
    grade: 'C',
    criticalCount: 1,
    highCount: 1,
    totalChecks: 12,
    passed: 8,
    failed: 3,
    warnings: 1,
    categories: {
      backup: 50,
      redundancy: 70,
      failover: 60,
      detection: 80,
      recovery: 40,
      replication: 55,
    },
    topFailures: [
      {
        ruleId: 'backup_plan_exists',
        nodeId: 'prod-db-primary',
        message: 'No backup plan covers this database.',
        impact: '8 direct dependents',
        severity: 'critical',
      },
    ],
    failureIds: ['backup_plan_exists:prod-db-primary'],
  };
}

function createComparison() {
  return {
    hasBaseline: true,
    baselineScore: 70,
    currentScore: 62,
    delta: -8,
    newFailures: ['backup_plan_exists:prod-db-primary'],
    resolvedFailures: ['multi_az_enabled:legacy-db'],
    categoryChanges: {
      backup: { before: 70, after: 50, delta: -20 },
      redundancy: { before: 80, after: 70, delta: -10 },
      failover: { before: 65, after: 60, delta: -5 },
      detection: { before: 80, after: 80, delta: 0 },
      recovery: { before: 45, after: 40, delta: -5 },
      replication: { before: 60, after: 55, delta: -5 },
    },
  };
}

function createConfig() {
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
    workspaceRoot: 'C:/repo',
  };
}

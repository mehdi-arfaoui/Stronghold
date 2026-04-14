import { describe, expect, it } from 'vitest';

import { analyzeTrend } from '../trend-analyzer.js';
import type { ServiceDebt } from '../debt-calculator.js';
import type { FindingLifecycle } from '../finding-lifecycle-types.js';
import type { ScanSnapshot } from '../history-types.js';

describe('analyzeTrend', () => {
  it('marks increasing scores as improving', () => {
    const trend = analyzeTrend(
      [snapshot('2026-04-01', 60), snapshot('2026-04-08', 68), snapshot('2026-04-15', 75)],
      [],
      currentDebt(100),
    );

    expect(trend.global.direction).toBe('improving');
  });

  it('marks decreasing scores as degrading', () => {
    const trend = analyzeTrend(
      [snapshot('2026-04-01', 80), snapshot('2026-04-08', 72), snapshot('2026-04-15', 64)],
      [],
      currentDebt(300),
    );

    expect(trend.global.direction).toBe('degrading');
  });

  it('marks small score changes as stable', () => {
    const trend = analyzeTrend(
      [snapshot('2026-04-01', 70), snapshot('2026-04-08', 71), snapshot('2026-04-15', 69)],
      [],
      currentDebt(200),
    );

    expect(trend.global.direction).toBe('stable');
  });

  it('includes proof-of-recovery datapoints in the global trend', () => {
    const trend = analyzeTrend(
      [
        snapshot('2026-04-01', 60, { proofOfRecovery: 0, observedCoverage: 40, realityGap: 80 }),
        snapshot('2026-04-08', 68, { proofOfRecovery: 33, observedCoverage: 55, realityGap: 42 }),
        snapshot('2026-04-15', 75, { proofOfRecovery: 67, observedCoverage: 70, realityGap: 8 }),
      ],
      [],
      currentDebt(100),
    );

    expect(trend.global.realityGapTrend.map((point) => point.value)).toEqual([80, 42, 8]);
    expect(trend.global.proofOfRecoveryTrend.map((point) => point.value)).toEqual([0, 33, 67]);
    expect(trend.global.observedCoverageTrend.map((point) => point.value)).toEqual([40, 55, 70]);
  });

  it('generates highlights for notable scan changes', () => {
    const snapshots = [
      snapshot('2026-04-01', 75, { covered: 3, expired: 0, totalDebt: 400, findingIds: ['rule-a::node-1'] }),
      snapshot('2026-04-08', 65, { covered: 2, expired: 1, totalDebt: 520, findingIds: ['rule-b::node-2'] }),
    ];
    const lifecycles: FindingLifecycle[] = [
      lifecycle('rule-a::node-1', 'critical', { status: 'resolved', resolvedAt: '2026-04-08T00:00:00.000Z' }),
      lifecycle('rule-b::node-2', 'critical', { status: 'active', firstSeenAt: '2026-04-08T00:00:00.000Z' }),
      lifecycle('rule-c::node-3', 'high', { status: 'recurrent', lastSeenAt: '2026-04-08T00:00:00.000Z', isRecurrent: true, recurrenceCount: 1 }),
    ];
    const debt = currentDebt(520);

    const trend = analyzeTrend(snapshots, lifecycles, debt);

    expect(trend.highlights.some((highlight) => highlight.type === 'score_degraded')).toBe(true);
    expect(trend.highlights.some((highlight) => highlight.type === 'new_critical_finding')).toBe(true);
    expect(trend.highlights.some((highlight) => highlight.type === 'critical_resolved')).toBe(true);
    expect(trend.highlights.some((highlight) => highlight.type === 'scenario_uncovered')).toBe(true);
    expect(trend.highlights.some((highlight) => highlight.type === 'evidence_expired')).toBe(true);
    expect(trend.highlights.some((highlight) => highlight.type === 'debt_milestone')).toBe(true);
    expect(trend.highlights.some((highlight) => highlight.type === 'finding_recurrent')).toBe(true);
  });

  it('caps highlights at ten entries', () => {
    const trend = analyzeTrend(
      [snapshot('2026-04-01', 80, { totalDebt: 0 }), snapshot('2026-04-08', 60, { totalDebt: 1200, expired: 5 })],
      Array.from({ length: 12 }, (_, index) =>
        lifecycle(`rule-${index}::node-${index}`, 'critical', {
          status: 'recurrent',
          lastSeenAt: '2026-04-08T00:00:00.000Z',
          isRecurrent: true,
          recurrenceCount: 1,
          resolvedAt: index === 0 ? '2026-04-08T00:00:00.000Z' : undefined,
        }),
      ),
      currentDebt(1200),
    );

    expect(trend.highlights.length).toBeLessThanOrEqual(10);
  });

  it('returns a first-scan highlight when history has a single snapshot', () => {
    const trend = analyzeTrend([snapshot('2026-04-08', 68)], [], currentDebt(0));

    expect(trend.global.direction).toBe('stable');
    expect(trend.highlights[0]?.type).toBe('first_scan');
  });
});

function snapshot(
  date: string,
  score: number,
  overrides: {
    readonly covered?: number;
    readonly expired?: number;
    readonly proofOfRecovery?: number | null;
    readonly realityGap?: number | null;
    readonly observedCoverage?: number;
    readonly totalDebt?: number;
    readonly findingIds?: readonly string[];
  } = {},
): ScanSnapshot {
  return {
    id: `scan-${date}`,
    timestamp: `${date}T00:00:00.000Z`,
    globalScore: score,
    globalGrade: score >= 75 ? 'B' : score >= 60 ? 'C' : 'D',
    proofOfRecovery: overrides.proofOfRecovery ?? 33,
    claimedProtection: 80,
    provenRecoverability: overrides.proofOfRecovery ?? 33,
    realityGap: overrides.realityGap ?? 47,
    observedCoverage: overrides.observedCoverage ?? 60,
    totalResources: 42,
    totalFindings: overrides.findingIds?.length ?? 2,
    findingsBySeverity: { critical: 1, high: 1, medium: 0, low: 0 },
    services: [
      {
        serviceId: 'payment',
        serviceName: 'Payment',
        score,
        grade: score >= 75 ? 'B' : score >= 60 ? 'C' : 'D',
        findingCount: overrides.findingIds?.length ?? 2,
        criticalFindingCount: 1,
        resourceCount: 5,
        debt: overrides.totalDebt ?? 0,
      },
    ],
    totalDebt: overrides.totalDebt ?? 0,
    scenarioCoverage: {
      total: 8,
      covered: overrides.covered ?? 3,
      partiallyCovered: 1,
      uncovered: 8 - (overrides.covered ?? 3) - 1,
    },
    evidenceDistribution: {
      observed: 20,
      inferred: 0,
      declared: 0,
      tested: 3,
      expired: overrides.expired ?? 0,
    },
    findingIds: overrides.findingIds ?? ['rule-a::node-1', 'rule-b::node-2'],
    regions: ['eu-west-1'],
    scanDurationMs: 10_000,
    scannerSuccessCount: 4,
    scannerFailureCount: 0,
  };
}

function lifecycle(
  findingKey: string,
  severity: 'critical' | 'high' | 'medium' | 'low',
  overrides: Partial<FindingLifecycle> = {},
): FindingLifecycle {
  const [ruleId, nodeId] = findingKey.split('::');
  return {
    findingKey,
    ruleId: ruleId ?? findingKey,
    nodeId: nodeId ?? findingKey,
    severity,
    status: overrides.status ?? 'active',
    firstSeenAt: overrides.firstSeenAt ?? '2026-04-01T00:00:00.000Z',
    lastSeenAt: overrides.lastSeenAt ?? '2026-04-08T00:00:00.000Z',
    recurrenceCount: overrides.recurrenceCount ?? 0,
    isRecurrent: overrides.isRecurrent ?? false,
    ageInDays: overrides.ageInDays ?? 7,
    ...overrides,
  };
}

function currentDebt(totalDebt: number): readonly ServiceDebt[] {
  return [
    {
      serviceId: 'payment',
      serviceName: 'Payment',
      totalDebt,
      criticalDebt: totalDebt,
      findingDebts: [
        {
          findingKey: 'rule-b::node-2',
          ruleId: 'rule-b',
          nodeId: 'node-2',
          severity: 'critical',
          ageInDays: 0,
          severityFactor: 4,
          serviceCriticalityFactor: 4,
          debt: totalDebt,
          isRecurrent: false,
        },
      ],
      trend: 'increasing',
    },
  ];
}

import { describe, expect, it } from 'vitest';
import {
  buildFindingKey,
  type FindingLifecycle,
  type FindingLifecycleDelta,
  type PostureTrend,
  type ScanSnapshot,
} from '@stronghold-dr/core';

import { renderStatusSnapshot } from '../commands/status.js';
import { renderHistoryTimeline, renderServiceHistory } from '../output/history-renderer.js';
import { renderTerminalServiceReport } from '../output/report-renderer.js';
import { renderScanSummary } from '../output/scan-summary.js';
import type { LoadedPostureMemory } from '../history/posture-memory.js';
import { createDemoResults } from './test-utils.js';

describe('history renderers', () => {
  it('renders the global posture timeline', () => {
    const snapshots = [
      createSnapshot({
        timestamp: '2026-03-25T00:00:00.000Z',
        globalScore: 74,
        totalFindings: 9,
        totalDebt: 280,
      }),
      createSnapshot({
        timestamp: '2026-04-01T00:00:00.000Z',
        globalScore: 72,
        totalFindings: 10,
        totalDebt: 310,
      }),
      createSnapshot({
        timestamp: '2026-04-08T00:00:00.000Z',
        globalScore: 68,
        totalFindings: 12,
        totalDebt: 420,
      }),
    ] satisfies readonly ScanSnapshot[];

    const rendered = renderHistoryTimeline({
      snapshots,
      trend: createTrend('degrading', 'Global score dropped by 6 points (74 -> 68).'),
    });

    expect(rendered).toContain('DR Posture History');
    expect(rendered).toContain('2026-04-08');
    expect(rendered).toContain('420');
    expect(rendered).toContain('Global score dropped by 6 points');
  });

  it('renders per-service history with oldest unresolved and recurrent findings', () => {
    const snapshots = [
      createSnapshot({
        timestamp: '2026-04-01T00:00:00.000Z',
        services: [
          {
            serviceId: 'payment',
            serviceName: 'Payment',
            score: 38,
            grade: 'D',
            findingCount: 5,
            criticalFindingCount: 1,
            resourceCount: 3,
            debt: 560,
          },
        ],
      }),
      createSnapshot({
        timestamp: '2026-04-08T00:00:00.000Z',
        services: [
          {
            serviceId: 'payment',
            serviceName: 'Payment',
            score: 34,
            grade: 'D',
            findingCount: 5,
            criticalFindingCount: 1,
            resourceCount: 3,
            debt: 680,
          },
        ],
      }),
    ] satisfies readonly ScanSnapshot[];

    const rendered = renderServiceHistory({
      snapshots,
      serviceId: 'payment',
      serviceName: 'Payment',
      lifecycles: [
        {
          findingKey: 'backup_plan_exists::payment-db',
          ruleId: 'backup_plan_exists',
          nodeId: 'payment-db',
          severity: 'critical',
          status: 'active',
          firstSeenAt: '2026-02-23T00:00:00.000Z',
          lastSeenAt: '2026-04-08T00:00:00.000Z',
          recurrenceCount: 0,
          isRecurrent: false,
          ageInDays: 45,
          serviceId: 'payment',
          serviceName: 'Payment',
        },
        {
          findingKey: 'rds_multi_az::payment-db',
          ruleId: 'rds_multi_az',
          nodeId: 'payment-db',
          severity: 'high',
          status: 'recurrent',
          firstSeenAt: '2026-03-01T00:00:00.000Z',
          lastSeenAt: '2026-04-08T00:00:00.000Z',
          recurrenceCount: 1,
          isRecurrent: true,
          ageInDays: 12,
          serviceId: 'payment',
          serviceName: 'Payment',
        },
      ],
    });

    expect(rendered).toContain('Payment Service History');
    expect(rendered).toContain('Oldest unresolved finding: backup_plan_exists on payment-db (45 days)');
    expect(rendered).toContain('Recurrent findings: 1');
  });
});

describe('posture-aware output', () => {
  it('scan summary shows deltas from the previous scan', async () => {
    const results = await createDemoResults('startup');
    const summary = renderScanSummary(results, {
      postureDelta: {
        currentSnapshot: createSnapshot({
          timestamp: results.timestamp,
          globalScore: 68,
          globalGrade: 'C',
          totalFindings: 12,
          scenarioCoverage: {
            total: 8,
            covered: 2,
            partiallyCovered: 1,
            uncovered: 5,
          },
        }),
        previousSnapshot: createSnapshot({
          timestamp: '2026-03-27T00:00:00.000Z',
          globalScore: 72,
          totalFindings: 11,
          scenarioCoverage: {
            total: 8,
            covered: 2,
            partiallyCovered: 1,
            uncovered: 5,
          },
        }),
        lifecycleDelta: {
          newFindings: [],
          resolvedFindings: [],
          recurrentFindings: [],
          persistentFindings: [],
          summary: {
            newCount: 2,
            resolvedCount: 1,
            recurrentCount: 1,
            persistentCount: 8,
          },
        } satisfies FindingLifecycleDelta,
      },
    });

    expect(summary).toContain('Score: 68/100 (C) v -4 from last scan');
    expect(summary).toContain('Findings: 12 (2 new, 1 resolved, 1 recurrent)');
    expect(summary).toContain('Scenarios: 2/8 covered (unchanged)');
  });

  it('status falls back to first-scan messaging when no history is available', async () => {
    const results = await createDemoResults('startup');
    const rendered = renderStatusSnapshot(results, 'missing-audit.jsonl', []);

    expect(rendered).toContain('Trend: - first scan');
    expect(rendered).toContain("Run 'stronghold history' for the full timeline.");
  });

  it('service report shows finding age and resolved sections when lifecycle data is available', async () => {
    const results = await createDemoResults('startup');
    const service = results.servicePosture?.services.find(
      (entry) => entry.contextualFindings.length > 0,
    );

    expect(service).toBeTruthy();

    const activeFinding = service?.contextualFindings[0];
    expect(activeFinding).toBeTruthy();

    const rendered = renderTerminalServiceReport(results, {
      findingLifecycles: new Map(
        activeFinding
          ? [
              [
                buildFindingKey(activeFinding.ruleId, activeFinding.nodeId),
                {
                  findingKey: buildFindingKey(activeFinding.ruleId, activeFinding.nodeId),
                  ruleId: activeFinding.ruleId,
                  nodeId: activeFinding.nodeId,
                  severity: activeFinding.severity,
                  status: 'active',
                  firstSeenAt: '2026-02-11T00:00:00.000Z',
                  lastSeenAt: results.timestamp,
                  recurrenceCount: 0,
                  isRecurrent: false,
                  ageInDays: 45,
                  serviceId: activeFinding.serviceId ?? undefined,
                  serviceName: activeFinding.serviceName ?? undefined,
                } satisfies FindingLifecycle,
              ],
            ]
          : [],
      ),
      showResolved: true,
      resolvedLifecycles: [
        {
          findingKey: 'rds_multi_az_active::analytics-db',
          ruleId: 'rds_multi_az_active',
          nodeId: 'analytics-db',
          severity: 'high',
          status: 'resolved',
          firstSeenAt: '2026-03-01T00:00:00.000Z',
          lastSeenAt: '2026-03-12T00:00:00.000Z',
          resolvedAt: '2026-03-13T00:00:00.000Z',
          recurrenceCount: 0,
          isRecurrent: false,
          ageInDays: 12,
          serviceId: 'analytics',
          serviceName: 'Analytics',
        },
      ],
    });

    expect(rendered).toContain('Age: 45 days (first seen: 2026-02-11)');
    expect(rendered).toContain('Resolved findings:');
    expect(rendered).toContain('Was active for 12 days (2026-03-01 -> 2026-03-13)');
  });

  it('status shows trend direction and highlights when posture memory is present', async () => {
    const results = await createDemoResults('startup');
    const postureMemory: LoadedPostureMemory = {
      snapshots: [
        createSnapshot({
          timestamp: '2026-04-01T00:00:00.000Z',
          globalScore: 72,
          totalFindings: 10,
          totalDebt: 310,
        }),
        createSnapshot({
          timestamp: '2026-04-08T00:00:00.000Z',
          globalScore: 68,
          totalFindings: 12,
          totalDebt: 420,
        }),
      ],
      currentSnapshot: createSnapshot({
        timestamp: '2026-04-08T00:00:00.000Z',
        globalScore: 68,
        totalFindings: 12,
        totalDebt: 420,
      }),
      previousSnapshot: createSnapshot({
        timestamp: '2026-04-01T00:00:00.000Z',
        globalScore: 72,
        totalFindings: 10,
        totalDebt: 310,
      }),
      allLifecycles: [
        {
          findingKey: 'backup_plan_exists::payment-db',
          ruleId: 'backup_plan_exists',
          nodeId: 'payment-db',
          severity: 'critical',
          status: 'active',
          firstSeenAt: '2026-02-23T00:00:00.000Z',
          lastSeenAt: '2026-04-08T00:00:00.000Z',
          recurrenceCount: 0,
          isRecurrent: false,
          ageInDays: 45,
          serviceId: 'database',
          serviceName: 'Database',
        },
      ],
      activeLifecycles: [
        {
          findingKey: 'backup_plan_exists::payment-db',
          ruleId: 'backup_plan_exists',
          nodeId: 'payment-db',
          severity: 'critical',
          status: 'active',
          firstSeenAt: '2026-02-23T00:00:00.000Z',
          lastSeenAt: '2026-04-08T00:00:00.000Z',
          recurrenceCount: 0,
          isRecurrent: false,
          ageInDays: 45,
          serviceId: 'database',
          serviceName: 'Database',
        },
      ],
      resolvedLifecycles: [],
      recurrentLifecycles: [],
      currentDebt: [
        {
          serviceId: 'database',
          serviceName: 'Database',
          totalDebt: 680,
          criticalDebt: 680,
          findingDebts: [
            {
              findingKey: 'backup_plan_exists::payment-db',
              ruleId: 'backup_plan_exists',
              nodeId: 'payment-db',
              severity: 'critical',
              ageInDays: 45,
              severityFactor: 4,
              serviceCriticalityFactor: 4,
              debt: 680,
              isRecurrent: false,
            },
          ],
          trend: 'increasing',
        },
      ],
      trend: createTrend('degrading', 'Global score dropped by 4 points (72 -> 68).'),
      warning: null,
    };

    const rendered = renderStatusSnapshot(results, 'missing-audit.jsonl', [], postureMemory);

    expect(rendered).toContain('Trend: v degrading');
    expect(rendered).toContain('Highlights:');
    expect(rendered).toContain('backup_plan_exists on payment-db - 45 days unresolved (critical)');
  });
});

function createSnapshot(overrides: Partial<ScanSnapshot>): ScanSnapshot {
  return {
    id: overrides.id ?? `scan-${overrides.timestamp ?? '2026-04-08T00:00:00.000Z'}`,
    timestamp: overrides.timestamp ?? '2026-04-08T00:00:00.000Z',
    globalScore: overrides.globalScore ?? 68,
    globalGrade: overrides.globalGrade ?? 'C',
    proofOfRecovery: overrides.proofOfRecovery ?? 33,
    observedCoverage: overrides.observedCoverage ?? 60,
    totalResources: overrides.totalResources ?? 142,
    totalFindings: overrides.totalFindings ?? 12,
    findingsBySeverity: overrides.findingsBySeverity ?? {
      critical: 2,
      high: 5,
      medium: 3,
      low: 2,
    },
    services: overrides.services ?? [
      {
        serviceId: 'payment',
        serviceName: 'Payment',
        score: 34,
        grade: 'D',
        findingCount: 5,
        criticalFindingCount: 1,
        resourceCount: 3,
        debt: 680,
      },
    ],
    totalDebt: overrides.totalDebt ?? 420,
    scenarioCoverage: overrides.scenarioCoverage ?? {
      total: 8,
      covered: 2,
      partiallyCovered: 1,
      uncovered: 5,
    },
    evidenceDistribution: overrides.evidenceDistribution ?? {
      observed: 20,
      tested: 3,
      inferred: 0,
      declared: 0,
      expired: 1,
    },
    findingIds: overrides.findingIds ?? ['backup_plan_exists::payment-db'],
    regions: overrides.regions ?? ['eu-west-1'],
    scanDurationMs: overrides.scanDurationMs ?? 14_200,
    scannerSuccessCount: overrides.scannerSuccessCount ?? 12,
    scannerFailureCount: overrides.scannerFailureCount ?? 0,
  };
}

function createTrend(
  direction: PostureTrend['global']['direction'],
  message: string,
): PostureTrend {
  return {
    global: {
      direction,
      scoreTrend: [],
      proofOfRecoveryTrend: [],
      observedCoverageTrend: [],
      findingTrend: [],
      scenarioCoverageTrend: [],
    },
    services: [],
    evidenceTrend: {
      testedCount: [],
      expiredCount: [],
    },
    highlights: [
      {
        type: 'score_degraded',
        message,
        severity: 'warning',
      },
    ],
  };
}

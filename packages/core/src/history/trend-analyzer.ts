import type { FindingLifecycle } from './finding-lifecycle-types.js';
import type { ScanSnapshot } from './history-types.js';
import type { ServiceDebt } from './debt-calculator.js';
import type {
  PostureTrend,
  ServiceTrend,
  TrendDirection,
  TrendHighlight,
  TrendPoint,
} from './trend-types.js';

const HIGHLIGHT_LIMIT = 10;
const SEVERITY_RANK = {
  critical: 3,
  warning: 2,
  info: 1,
} as const;

export function analyzeTrend(
  snapshots: readonly ScanSnapshot[],
  findingLifecycles: readonly FindingLifecycle[],
  currentDebt: readonly ServiceDebt[],
): PostureTrend {
  const orderedSnapshots = [...snapshots].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const currentSnapshot = orderedSnapshots.at(-1) ?? null;
  const previousSnapshot = orderedSnapshots.length >= 2 ? orderedSnapshots[orderedSnapshots.length - 2] ?? null : null;

  if (!currentSnapshot) {
    return {
      global: {
        direction: 'stable',
        scoreTrend: [],
        findingTrend: [],
        scenarioCoverageTrend: [],
      },
      services: [],
      evidenceTrend: {
        testedCount: [],
        expiredCount: [],
      },
      highlights: [],
    };
  }

  const scoreTrend = orderedSnapshots.map((snapshot) => point(snapshot.timestamp, snapshot.globalScore));
  const findingTrend = orderedSnapshots.map((snapshot) => point(snapshot.timestamp, snapshot.totalFindings));
  const scenarioCoverageTrend = orderedSnapshots.map((snapshot) =>
    point(snapshot.timestamp, scenarioCoveragePercent(snapshot)),
  );
  const evidenceTrend = {
    testedCount: orderedSnapshots.map((snapshot) =>
      point(snapshot.timestamp, snapshot.evidenceDistribution.tested ?? 0),
    ),
    expiredCount: orderedSnapshots.map((snapshot) =>
      point(snapshot.timestamp, snapshot.evidenceDistribution.expired ?? 0),
    ),
  };

  if (orderedSnapshots.length < 2) {
    return {
      global: {
        direction: 'stable',
        scoreTrend,
        findingTrend,
        scenarioCoverageTrend,
      },
      services: buildServiceTrends(orderedSnapshots, currentDebt),
      evidenceTrend,
      highlights: [
        {
          type: 'first_scan',
          message: 'First scan recorded. Trend data will appear after the next run.',
          severity: 'info',
        },
      ],
    };
  }

  return {
    global: {
      direction: resolveTrendDirection(scoreTrend),
      scoreTrend,
      findingTrend,
      scenarioCoverageTrend,
    },
    services: buildServiceTrends(orderedSnapshots, currentDebt),
    evidenceTrend,
    highlights: buildHighlights(currentSnapshot, previousSnapshot, findingLifecycles, currentDebt),
  };
}

function buildServiceTrends(
  snapshots: readonly ScanSnapshot[],
  currentDebt: readonly ServiceDebt[],
): readonly ServiceTrend[] {
  const latestSnapshot = snapshots.at(-1);
  if (!latestSnapshot) {
    return [];
  }

  const latestDebtByService = new Map(
    currentDebt.map((service) => [service.serviceId, service.totalDebt] as const),
  );

  return latestSnapshot.services
    .map((service) => {
      const scoreTrend = snapshots
        .flatMap((snapshot) => {
          const entry = snapshot.services.find((candidate) => candidate.serviceId === service.serviceId);
          return entry ? [point(snapshot.timestamp, entry.score)] : [];
        });
      const debtTrend = snapshots
        .flatMap((snapshot, index) => {
          const entry = snapshot.services.find((candidate) => candidate.serviceId === service.serviceId);
          const debt =
            index === snapshots.length - 1
              ? latestDebtByService.get(service.serviceId) ?? entry?.debt ?? 0
              : entry?.debt;
          return typeof debt === 'number' ? [point(snapshot.timestamp, debt)] : [];
        });

      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        direction: resolveTrendDirection(scoreTrend),
        scoreTrend,
        debtTrend,
      } satisfies ServiceTrend;
    })
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
}

function buildHighlights(
  currentSnapshot: ScanSnapshot,
  previousSnapshot: ScanSnapshot | null,
  findingLifecycles: readonly FindingLifecycle[],
  currentDebt: readonly ServiceDebt[],
): readonly TrendHighlight[] {
  if (!previousSnapshot) {
    return [
      {
        type: 'first_scan',
        message: 'First scan recorded. Trend data will appear after the next run.',
        severity: 'info',
      },
    ];
  }

  const highlights: TrendHighlight[] = [];
  const scoreDelta = currentSnapshot.globalScore - previousSnapshot.globalScore;
  if (scoreDelta >= 5) {
    highlights.push({
      type: 'score_improved',
      message: `Global score improved by ${scoreDelta} points (${previousSnapshot.globalScore} -> ${currentSnapshot.globalScore}).`,
      severity: 'info',
    });
  } else if (scoreDelta <= -5) {
    highlights.push({
      type: 'score_degraded',
      message: `Global score dropped by ${Math.abs(scoreDelta)} points (${previousSnapshot.globalScore} -> ${currentSnapshot.globalScore}).`,
      severity: 'warning',
    });
  }

  const currentDebtByKey = new Map(
    currentDebt.flatMap((service) => service.findingDebts.map((finding) => [finding.findingKey, finding] as const)),
  );
  const previousKeys = new Set(previousSnapshot.findingIds);
  const newCritical = currentSnapshot.findingIds
    .filter((findingKey) => !previousKeys.has(findingKey))
    .map((findingKey) => currentDebtByKey.get(findingKey))
    .filter((finding): finding is NonNullable<typeof finding> => finding?.severity === 'critical');
  if (newCritical.length > 0) {
    const finding = newCritical[0];
    if (finding) {
      highlights.push({
        type: 'new_critical_finding',
        message: `New critical finding: ${finding.ruleId} on ${finding.nodeId}.`,
        severity: 'critical',
      });
    }
  }

  const resolvedCritical = findingLifecycles.find(
    (lifecycle) =>
      lifecycle.status === 'resolved' &&
      lifecycle.resolvedAt === currentSnapshot.timestamp &&
      lifecycle.severity === 'critical',
  );
  if (resolvedCritical) {
    highlights.push({
      type: 'critical_resolved',
      message: `Critical finding resolved: ${resolvedCritical.ruleId} on ${resolvedCritical.nodeId}.`,
      severity: 'info',
    });
  }

  if (currentSnapshot.scenarioCoverage.covered < previousSnapshot.scenarioCoverage.covered) {
    highlights.push({
      type: 'scenario_uncovered',
      message: `Scenario coverage dropped from ${previousSnapshot.scenarioCoverage.covered}/${previousSnapshot.scenarioCoverage.total} to ${currentSnapshot.scenarioCoverage.covered}/${currentSnapshot.scenarioCoverage.total}.`,
      severity: 'warning',
    });
  } else if (currentSnapshot.scenarioCoverage.covered > previousSnapshot.scenarioCoverage.covered) {
    highlights.push({
      type: 'scenario_covered',
      message: `Scenario coverage improved from ${previousSnapshot.scenarioCoverage.covered}/${previousSnapshot.scenarioCoverage.total} to ${currentSnapshot.scenarioCoverage.covered}/${currentSnapshot.scenarioCoverage.total}.`,
      severity: 'info',
    });
  }

  const expiredDelta =
    (currentSnapshot.evidenceDistribution.expired ?? 0) -
    (previousSnapshot.evidenceDistribution.expired ?? 0);
  if (expiredDelta > 0) {
    highlights.push({
      type: 'evidence_expired',
      message: `${expiredDelta} evidence item${expiredDelta === 1 ? '' : 's'} expired since the previous scan.`,
      severity: 'warning',
    });
  }

  const currentTotalDebt = currentSnapshot.totalDebt ?? currentDebt.reduce((sum, service) => sum + service.totalDebt, 0);
  const previousTotalDebt = previousSnapshot.totalDebt ?? 0;
  [500, 1000].forEach((threshold) => {
    if (currentTotalDebt >= threshold && previousTotalDebt < threshold) {
      highlights.push({
        type: 'debt_milestone',
        message: `Total DR debt crossed ${threshold} (now ${Math.round(currentTotalDebt)}).`,
        severity: threshold >= 1000 ? 'critical' : 'warning',
      });
    }
  });

  const recurrentFinding = findingLifecycles.find(
    (lifecycle) => lifecycle.status === 'recurrent' && lifecycle.lastSeenAt === currentSnapshot.timestamp,
  );
  if (recurrentFinding) {
    highlights.push({
      type: 'finding_recurrent',
      message: `Finding regressed after a prior fix: ${recurrentFinding.ruleId} on ${recurrentFinding.nodeId}.`,
      severity: 'warning',
    });
  }

  return highlights
    .sort(
      (left, right) =>
        SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
        left.message.localeCompare(right.message),
    )
    .slice(0, HIGHLIGHT_LIMIT);
}

function resolveTrendDirection(points: readonly TrendPoint[]): TrendDirection {
  if (points.length < 2) {
    return 'stable';
  }

  const currentValue = points.at(-1)?.value ?? 0;
  const previousValues = points
    .slice(Math.max(0, points.length - 6), points.length - 1)
    .map((point) => point.value);
  const average = previousValues.reduce((sum, value) => sum + value, 0) / previousValues.length;

  if (currentValue >= average + 5) {
    return 'improving';
  }
  if (currentValue <= average - 5) {
    return 'degrading';
  }
  return 'stable';
}

function scenarioCoveragePercent(snapshot: ScanSnapshot): number {
  if (snapshot.scenarioCoverage.total === 0) {
    return 0;
  }
  return Math.round((snapshot.scenarioCoverage.covered / snapshot.scenarioCoverage.total) * 100);
}

function point(timestamp: string, value: number): TrendPoint {
  return { timestamp, value };
}

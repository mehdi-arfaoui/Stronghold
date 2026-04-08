import { analyzeTrend, type FindingLifecycle, type PostureTrend, type ScanSnapshot } from '@stronghold-dr/core';

export function renderHistoryTimeline(input: {
  readonly snapshots: readonly ScanSnapshot[];
  readonly trend: PostureTrend;
  readonly limit?: number;
}): string {
  if (input.snapshots.length === 0) {
    return "No posture history yet. Run 'stronghold scan' or 'stronghold demo' to create the first snapshot.";
  }

  const limited = takeMostRecent(input.snapshots, input.limit);
  const rows = [...limited].reverse();
  const directions = buildGlobalDirections(limited);
  const spanDays = diffDays(limited[0]?.timestamp ?? rows.at(-1)?.timestamp ?? '', rows[0]?.timestamp ?? '');
  const lines = [
    `DR Posture History - ${rows.length} scan${rows.length === 1 ? '' : 's'} over ${spanDays} day${spanDays === 1 ? '' : 's'}`,
    '',
    '  Date         Score  Grade  Findings  Scenarios   Debt    Trend',
  ];

  rows.forEach((snapshot) => {
    const direction = directions.get(snapshot.timestamp) ?? 'stable';
    lines.push(
      `  ${snapshot.timestamp.slice(0, 10)}   ${pad(String(snapshot.globalScore), 5)}  ${pad(snapshot.globalGrade, 5)}  ${pad(String(snapshot.totalFindings), 8)}  ${pad(formatScenarioCoverage(snapshot), 10)}  ${pad(formatDebt(snapshot.totalDebt), 6)}  ${formatTrend(direction, limited.length === 1 && snapshot === rows.at(-1))}`,
    );
  });

  if (input.trend.highlights.length > 0) {
    lines.push('');
    lines.push('Highlights:');
    input.trend.highlights.slice(0, 4).forEach((highlight) => {
      lines.push(`  ${highlightPrefix(highlight.severity)} ${highlight.message}`);
    });
  }

  lines.push('');
  lines.push("Run 'stronghold history --service <name>' for per-service history.");
  return lines.join('\n');
}

export function renderServiceHistory(input: {
  readonly snapshots: readonly ScanSnapshot[];
  readonly serviceId: string;
  readonly serviceName: string;
  readonly lifecycles: readonly FindingLifecycle[];
  readonly limit?: number;
}): string {
  const serviceSnapshots = takeMostRecent(
    input.snapshots.filter((snapshot) =>
      snapshot.services.some((service) => service.serviceId === input.serviceId),
    ),
    input.limit,
  );
  const rows = [...serviceSnapshots].reverse();
  const directions = buildServiceDirections(serviceSnapshots, input.serviceId);
  const activeLifecycles = input.lifecycles.filter(
    (lifecycle) =>
      lifecycle.serviceId === input.serviceId &&
      (lifecycle.status === 'active' || lifecycle.status === 'recurrent'),
  );
  const oldest = activeLifecycles.sort((left, right) => right.ageInDays - left.ageInDays)[0] ?? null;
  const recurrentCount = input.lifecycles.filter(
    (lifecycle) => lifecycle.serviceId === input.serviceId && lifecycle.isRecurrent,
  ).length;
  const recurrentExample = input.lifecycles.find(
    (lifecycle) => lifecycle.serviceId === input.serviceId && lifecycle.isRecurrent,
  );

  const lines = [
    `${input.serviceName} Service History - ${rows.length} scan${rows.length === 1 ? '' : 's'}`,
    '',
    '  Date         Score  Grade  Findings  Debt    Trend',
  ];

  rows.forEach((snapshot) => {
    const service = snapshot.services.find((entry) => entry.serviceId === input.serviceId);
    if (!service) {
      return;
    }
    lines.push(
      `  ${snapshot.timestamp.slice(0, 10)}   ${pad(String(service.score), 5)}  ${pad(service.grade, 5)}  ${pad(String(service.findingCount), 8)}  ${pad(formatDebt(service.debt), 6)}  ${formatTrend(directions.get(snapshot.timestamp) ?? 'stable', rows.length === 1)}`,
    );
  });

  lines.push('');
  lines.push(
    `  Oldest unresolved finding: ${oldest ? `${oldest.ruleId} on ${oldest.nodeId} (${oldest.ageInDays} days)` : 'none'}`,
  );
  lines.push(
    `  Recurrent findings: ${recurrentCount}${recurrentExample ? ` (${recurrentExample.ruleId} - reappeared ${recurrentExample.lastSeenAt.slice(0, 10)})` : ''}`,
  );
  return lines.join('\n');
}

export function buildHistoryJson(input: {
  readonly snapshots: readonly ScanSnapshot[];
  readonly trend: PostureTrend;
  readonly serviceId?: string;
  readonly serviceName?: string;
  readonly lifecycles?: readonly FindingLifecycle[];
  readonly limit?: number;
}): Record<string, unknown> {
  const snapshots = takeMostRecent(input.snapshots, input.limit);
  return {
    summary: {
      count: snapshots.length,
      since: snapshots[0]?.timestamp ?? null,
      until: snapshots.at(-1)?.timestamp ?? null,
      trend: input.trend.global.direction,
    },
    trend: input.trend,
    snapshots,
    ...(input.serviceId
      ? {
          service: {
            id: input.serviceId,
            name: input.serviceName ?? input.serviceId,
            lifecycles:
              input.lifecycles?.filter((lifecycle) => lifecycle.serviceId === input.serviceId) ?? [],
          },
        }
      : {}),
  };
}

function takeMostRecent(
  snapshots: readonly ScanSnapshot[],
  limit = 50,
): readonly ScanSnapshot[] {
  if (snapshots.length <= limit) {
    return snapshots;
  }
  return snapshots.slice(snapshots.length - limit);
}

function buildGlobalDirections(
  snapshots: readonly ScanSnapshot[],
): ReadonlyMap<string, PostureTrend['global']['direction']> {
  return new Map(
    snapshots.map((_, index) => {
      const prefix = snapshots.slice(0, index + 1);
      return [prefix.at(-1)?.timestamp ?? '', analyzeTrend(prefix, [], []).global.direction] as const;
    }),
  );
}

function buildServiceDirections(
  snapshots: readonly ScanSnapshot[],
  serviceId: string,
): ReadonlyMap<string, PostureTrend['global']['direction']> {
  return new Map(
    snapshots.map((_, index) => {
      const prefix = snapshots.slice(0, index + 1);
      const serviceTrend = analyzeTrend(prefix, [], []).services.find(
        (service) => service.serviceId === serviceId,
      );
      return [prefix.at(-1)?.timestamp ?? '', serviceTrend?.direction ?? 'stable'] as const;
    }),
  );
}

function formatScenarioCoverage(snapshot: ScanSnapshot): string {
  return `${snapshot.scenarioCoverage.covered}/${snapshot.scenarioCoverage.total}`;
}

function formatDebt(value: number | undefined): string {
  return typeof value === 'number' ? String(Math.round(value)) : '-';
}

function formatTrend(
  direction: 'improving' | 'stable' | 'degrading',
  isFirstScan: boolean,
): string {
  if (isFirstScan) {
    return '- first scan';
  }
  if (direction === 'improving') {
    return '^ improving';
  }
  if (direction === 'degrading') {
    return 'v degrading';
  }
  return '- stable';
}

function highlightPrefix(severity: 'info' | 'warning' | 'critical'): string {
  if (severity === 'critical') {
    return 'x';
  }
  if (severity === 'warning') {
    return '!';
  }
  return 'i';
}

function diffDays(startAt: string, endAt: string): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width);
}

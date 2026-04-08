import type {
  ApiServiceDetailResponse,
  ApiServiceHistoryResponse,
  ContextualFinding,
} from '@stronghold-dr/core';

import {
  describeOwnerPresentation,
  formatOwnerName,
  ownerStatusLabel,
  ownerStatusTone,
  resolveOwnerPresentation,
} from '@/components/governance/governance-utils';
import { cn } from '@/lib/utils';

import { ServiceFindings } from './ServiceFindings';

function buildEvidenceSummary(findings: readonly ContextualFinding[]): Array<{
  readonly type: string;
  readonly count: number;
  readonly tone: string;
}> {
  const counts = findings.reduce<Record<string, number>>((accumulator, finding) => {
    const type = finding.evidenceSummary?.strongestType ?? 'observed';
    accumulator[type] = (accumulator[type] ?? 0) + 1;
    return accumulator;
  }, {});

  return [
    { type: 'tested', count: counts.tested ?? 0, tone: 'bg-emerald-400' },
    { type: 'observed', count: counts.observed ?? 0, tone: 'bg-sky-400' },
    { type: 'inferred', count: counts.inferred ?? 0, tone: 'bg-amber-400' },
    { type: 'declared', count: counts.declared ?? 0, tone: 'bg-indigo-400' },
    { type: 'expired', count: counts.expired ?? 0, tone: 'bg-red-400' },
  ].filter((entry) => entry.count > 0);
}

export function ServiceDetail({
  detail,
  history,
  onOpenGraph,
}: {
  readonly detail: ApiServiceDetailResponse['service'] | null;
  readonly history: ApiServiceHistoryResponse | null;
  readonly onOpenGraph: (serviceId: string) => void;
}): JSX.Element {
  if (!detail) {
    return (
      <div className="panel p-6 text-sm text-muted-foreground">
        Select a service to inspect its resources, contextual findings, and recommendations.
      </div>
    );
  }

  const evidenceSummary = buildEvidenceSummary(detail.contextualFindings);
  const totalEvidenceFindings = evidenceSummary.reduce((sum, entry) => sum + entry.count, 0);
  const sparklinePoints = buildSparklinePoints(history?.snapshots ?? []);
  const sparklineDirection = history?.trend?.direction ?? 'stable';
  const owner = resolveOwnerPresentation(detail.service);
  const activeFindings = detail.contextualFindings.filter((finding) => finding.riskAccepted !== true).length;
  const acceptedFindings = detail.contextualFindings.filter((finding) => finding.riskAccepted === true).length;
  const policyViolations = detail.contextualFindings.reduce(
    (count, finding) => count + (finding.policyViolations?.length ?? 0),
    0,
  );

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">{detail.score.criticality}</p>
            <h2 className="mt-2 text-3xl font-semibold text-foreground">{detail.service.name}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-foreground">{formatOwnerName(owner)}</div>
              <div
                className={cn(
                  'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em]',
                  ownerStatusTone(owner.status),
                )}
              >
                {ownerStatusLabel(owner.status)}
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{describeOwnerPresentation(owner)}</p>
            {owner.contact ? (
              <p className="mt-2 text-sm text-muted-foreground">Contact: {owner.contact}</p>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-4xl font-semibold text-foreground">{detail.score.score}</div>
            <div className="text-sm text-muted-foreground">Grade {detail.score.grade}</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onOpenGraph(detail.service.id)}
            className="btn-secondary"
          >
            View in Graph
          </button>
          <div className="rounded-full border border-border bg-card/70 px-4 py-2 text-sm text-muted-foreground">
            {detail.service.resources.length} resources
          </div>
          <div className="rounded-full border border-border bg-card/70 px-4 py-2 text-sm text-muted-foreground">
            {activeFindings} active finding{activeFindings === 1 ? '' : 's'}
          </div>
          {acceptedFindings > 0 ? (
            <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
              {acceptedFindings} risk accepted
            </div>
          ) : null}
          {policyViolations > 0 ? (
            <div className="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-100">
              {policyViolations} policy violation{policyViolations === 1 ? '' : 's'}
            </div>
          ) : null}
        </div>
        <div className="mt-5 rounded-2xl border border-border bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Service trend</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Last {Math.max(sparklinePoints.length, 1)} scan{sparklinePoints.length === 1 ? '' : 's'} • {sparklineDirection}
              </p>
            </div>
            <div className="rounded-full border border-border bg-card/70 px-3 py-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {sparklineDirection}
            </div>
          </div>
          <div className="mt-4">
            {sparklinePoints.length > 1 ? (
              <svg viewBox="0 0 220 64" className="h-16 w-full">
                <path
                  d={sparklinePoints}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-sky-300"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                Trend data will appear after more history is collected for this service.
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-border bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Evidence maturity</p>
            <p className="text-sm text-muted-foreground">
              {totalEvidenceFindings} finding{totalEvidenceFindings === 1 ? '' : 's'} with evidence context
            </p>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-card/70">
            {evidenceSummary.length ? (
              evidenceSummary.map((entry) => (
                <div
                  key={entry.type}
                  className={entry.tone}
                  style={{ width: `${(entry.count / totalEvidenceFindings) * 100}%` }}
                />
              ))
            ) : (
              <div className="h-full w-full bg-border" />
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {evidenceSummary.length ? (
              evidenceSummary.map((entry) => (
                <div
                  key={entry.type}
                  className="rounded-full border border-border bg-card/70 px-3 py-1 text-xs uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {entry.type}: {entry.count}
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No evidence summary available for this service yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="panel p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Resources</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {detail.service.resources.map((resource) => (
            <div key={resource.nodeId} className="rounded-2xl border border-border bg-card/70 p-4">
              <div className="text-sm font-medium text-foreground">{resource.nodeId}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {resource.role ?? 'other'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Contextual findings</p>
        <div className="mt-4">
          <ServiceFindings findings={detail.contextualFindings} />
        </div>
      </div>

      <div className="panel p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Recommendations</p>
        <div className="mt-4 space-y-3">
          {detail.recommendations.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
              No service-specific recommendations available.
            </div>
          ) : (
            detail.recommendations.map((recommendation) => (
              <div key={recommendation.id} className="rounded-2xl border border-border bg-card/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">{recommendation.title}</div>
                  <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                    {recommendation.risk}
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{recommendation.description}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-subtle-foreground">
                  Score delta +{recommendation.impact.scoreDelta}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function buildSparklinePoints(
  snapshots: readonly ApiServiceHistoryResponse['snapshots'][number][],
): string {
  if (snapshots.length < 2) {
    return '';
  }

  const step = 220 / Math.max(1, snapshots.length - 1);
  return snapshots
    .map((snapshot, index) => {
      const x = index * step;
      const y = 56 - Math.round((snapshot.score / 100) * 48);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

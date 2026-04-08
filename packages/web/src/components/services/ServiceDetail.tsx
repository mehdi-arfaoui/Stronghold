import type { ApiServiceDetailResponse } from '@stronghold-dr/core';

import { ServiceFindings } from './ServiceFindings';

export function ServiceDetail({
  detail,
  onOpenGraph,
}: {
  readonly detail: ApiServiceDetailResponse['service'] | null;
  readonly onOpenGraph: (serviceId: string) => void;
}): JSX.Element {
  if (!detail) {
    return (
      <div className="panel p-6 text-sm text-muted-foreground">
        Select a service to inspect its resources, contextual findings, and recommendations.
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">{detail.score.criticality}</p>
            <h2 className="mt-2 text-3xl font-semibold text-foreground">{detail.service.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Owner: {detail.score.owner ? `${detail.score.owner} (declared)` : 'Not declared'}
            </p>
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

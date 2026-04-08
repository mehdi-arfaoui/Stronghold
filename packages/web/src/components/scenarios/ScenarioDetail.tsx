import type {
  ApiServiceSummary,
  CoverageVerdict,
  Scenario,
  ServiceRecommendationProjection,
} from '@stronghold-dr/core';

import { ImpactChain } from './ImpactChain';

function verdictClasses(verdict: CoverageVerdict | undefined): string {
  switch (verdict) {
    case 'covered':
      return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25';
    case 'partially_covered':
      return 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/25';
    case 'degraded':
      return 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25';
    case 'uncovered':
    default:
      return 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/25';
  }
}

function formatVerdict(verdict: CoverageVerdict | undefined): string {
  return verdict ? String(verdict).replace('_', ' ').toUpperCase() : 'UNKNOWN';
}

function formatEvidenceLevel(level: string): string {
  return level.replace('_', ' ');
}

export function ScenarioDetail({
  scenario,
  servicesById,
  onOpenGraph,
  onOpenServices,
}: {
  readonly scenario: Scenario | null;
  readonly servicesById: ReadonlyMap<string, ApiServiceSummary>;
  readonly onOpenGraph: (scenarioId: string) => void;
  readonly onOpenServices: (serviceId: string) => void;
}): JSX.Element {
  if (!scenario) {
    return (
      <section className="panel p-8">
        <p className="text-sm text-muted-foreground">Select a scenario to inspect its disruption impact and coverage details.</p>
      </section>
    );
  }

  const affectedServices =
    scenario.impact?.serviceImpact.filter((impact) => impact.status !== 'unaffected') ?? [];

  return (
    <div className="space-y-6">
      <section className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Scenario detail</p>
            <h2 className="mt-2 text-3xl font-semibold text-foreground">{scenario.name}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{scenario.description}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <span className={`rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] ${verdictClasses(scenario.coverage?.verdict)}`}>
              {formatVerdict(scenario.coverage?.verdict)}
            </span>
            <button type="button" onClick={() => onOpenGraph(scenario.id)} className="btn-secondary">
              Open in Graph
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-border bg-elevated p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Disruption zone</p>
            <p className="mt-2 text-sm text-foreground">{scenario.disruption.selectionCriteria}</p>
          </div>
          <div className="rounded-2xl border border-border bg-elevated p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Directly affected</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{scenario.impact?.directlyAffected.length ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-border bg-elevated p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Cascade affected</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{scenario.impact?.cascadeAffected.length ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-border bg-elevated p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Affected services</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{affectedServices.length}</p>
          </div>
        </div>
      </section>

      <ImpactChain scenario={scenario} />

      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Coverage details</p>
            <h3 className="mt-2 text-2xl font-semibold text-foreground">Recovery path viability by service</h3>
          </div>
          <div className="rounded-full border border-border bg-elevated px-4 py-2 text-sm text-muted-foreground">
            {scenario.coverage?.summary ?? 'No impacted services to evaluate.'}
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          {(scenario.coverage?.details ?? []).length > 0 ? (
            scenario.coverage?.details.map((detail) => {
              const service = servicesById.get(detail.serviceId);
              const recommendations = (service?.recommendations ?? []).slice(0, 2);
              return (
                <article key={detail.serviceId} className="rounded-3xl border border-border bg-card/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-foreground">{detail.serviceName}</div>
                      <p className="mt-2 text-sm text-muted-foreground">{detail.reason}</p>
                    </div>
                    <span className={`rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] ${verdictClasses(detail.verdict)}`}>
                      {formatVerdict(detail.verdict)}
                    </span>
                  </div>

                  {detail.recoveryPath ? (
                    <p className="mt-4 rounded-2xl border border-border bg-elevated px-4 py-3 text-sm text-foreground">
                      Recovery path: {detail.recoveryPath}
                    </p>
                  ) : null}

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-elevated p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Evidence</p>
                      <p className="mt-2 text-sm text-foreground">
                        {formatEvidenceLevel(detail.evidenceLevel)}
                        {detail.lastTested ? `, last tested ${detail.lastTested.slice(0, 10)}` : ''}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border bg-elevated p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Missing capabilities</p>
                      <p className="mt-2 text-sm text-foreground">
                        {detail.missingCapabilities.length > 0
                          ? detail.missingCapabilities.join('; ')
                          : 'No missing capability identified for this service.'}
                      </p>
                    </div>
                  </div>

                  {(detail.verdict === 'uncovered' || detail.verdict === 'degraded') && recommendations.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-amber-200">Recommendations that reduce this gap</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {recommendations.map((recommendation: ServiceRecommendationProjection) => (
                          <button
                            key={`${detail.serviceId}-${recommendation.id}`}
                            type="button"
                            onClick={() => onOpenServices(detail.serviceId)}
                            className="btn-secondary-tight"
                          >
                            {recommendation.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
              No impacted services were identified for this scenario.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

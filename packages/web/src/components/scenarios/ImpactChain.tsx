import type { Scenario } from '@stronghold-dr/core';

function renderImpactTone(impactType: 'direct' | 'cascade'): string {
  return impactType === 'direct'
    ? 'border-rose-500/25 bg-rose-500/10 text-rose-100'
    : 'border-amber-500/25 bg-amber-500/10 text-amber-100';
}

export function ImpactChain({
  scenario,
}: {
  readonly scenario: Scenario;
}): JSX.Element {
  const directlyAffected = scenario.impact?.directlyAffected ?? [];
  const cascadeAffected = scenario.impact?.cascadeAffected ?? [];

  return (
    <section className="rounded-3xl border border-border bg-card/80 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Impact chain</p>
          <h3 className="mt-2 text-xl font-semibold text-foreground">Direct and cascading disruption impact</h3>
        </div>
        <div className="rounded-full border border-border bg-elevated px-4 py-2 text-sm text-muted-foreground">
          {scenario.impact?.totalAffectedNodes ?? 0} affected nodes
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Directly affected</p>
          {directlyAffected.length > 0 ? (
            directlyAffected.map((node) => (
              <article
                key={node.nodeId}
                className={`rounded-2xl border p-4 ${renderImpactTone('direct')}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{node.nodeName}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-white/70">
                      {node.serviceId ?? 'unassigned'}
                    </div>
                  </div>
                  <div className="rounded-full bg-black/15 px-3 py-1 text-xs uppercase tracking-[0.16em]">
                    depth {node.cascadeDepth}
                  </div>
                </div>
                <p className="mt-3 text-sm text-white/85">{node.reason}</p>
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No directly affected nodes were identified.
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Cascade affected</p>
          {cascadeAffected.length > 0 ? (
            cascadeAffected.map((node) => (
              <article
                key={`${node.nodeId}-${node.cascadeDepth}`}
                className={`rounded-2xl border p-4 ${renderImpactTone('cascade')}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{node.nodeName}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-white/70">
                      {node.serviceId ?? 'unassigned'}
                    </div>
                  </div>
                  <div className="rounded-full bg-black/15 px-3 py-1 text-xs uppercase tracking-[0.16em]">
                    depth {node.cascadeDepth}
                  </div>
                </div>
                <p className="mt-3 text-sm text-white/85">{node.reason}</p>
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No cascading impact was identified for this scenario.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

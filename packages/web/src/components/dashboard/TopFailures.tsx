import type { ApiValidationSummary } from '@stronghold-dr/core';

export function TopFailures({
  failures,
}: {
  readonly failures: ApiValidationSummary['topFailures'];
}): JSX.Element {
  return (
    <section className="panel p-6">
      <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Top failures</p>
      {failures.length === 0 ? (
        <div className="mt-8 text-sm text-muted-foreground">No critical failures detected in the latest completed report.</div>
      ) : (
        <div className="mt-4 space-y-3">
          {failures.slice(0, 5).map((failure) => (
            <article key={`${failure.ruleId}-${failure.nodeId}`} className="rounded-2xl border border-danger/20 bg-danger-soft p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-foreground">{failure.nodeName}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{failure.message}</p>
                </div>
                <span className="rounded-full bg-danger/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-danger-foreground">
                  {failure.severity}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

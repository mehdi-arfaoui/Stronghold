import type { DriftChange } from '@stronghold-dr/core';

export function DriftCard({
  change,
}: {
  readonly change: DriftChange;
}): JSX.Element {
  return (
    <article className="panel-elevated p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-foreground">{change.resourceId}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{change.description}</p>
        </div>
        <span className="rounded-full bg-warning-soft px-3 py-1 text-xs uppercase tracking-[0.16em] text-warning-foreground">
          {change.severity}
        </span>
      </div>
      <p className="mt-3 text-sm text-subtle-foreground">Change: {change.field}</p>
      <p className="mt-2 text-sm text-muted-foreground">{change.drImpact}</p>
    </article>
  );
}

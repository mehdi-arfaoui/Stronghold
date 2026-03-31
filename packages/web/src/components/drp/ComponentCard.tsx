import type { DRPComponent } from '@stronghold-dr/core';

import { RTODisplay } from './RTODisplay';

export function ComponentCard({
  component,
}: {
  readonly component: DRPComponent;
}): JSX.Element {
  return (
    <article className="panel-elevated relative p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{component.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {component.resourceType} | {component.region}
          </p>
        </div>
        <span className="rounded-full bg-accent-soft px-3 py-1 text-xs uppercase tracking-[0.16em] text-accent-soft-foreground">
          {component.recoveryStrategy}
        </span>
      </div>
      <div className="mt-4">
        <RTODisplay component={component} />
      </div>
      {component.effectiveRTO ? (
        <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
          <div>Chain RTO: {component.effectiveRTO.chainRTOMin ?? 'N/A'}-{component.effectiveRTO.chainRTOMax ?? 'N/A'} min</div>
          <div>Bottleneck: {component.effectiveRTO.bottleneck ?? 'None'}</div>
        </div>
      ) : null}
      {component.dependencies.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Dependencies</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {component.dependencies.map((dependency) => (
              <span key={dependency} className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                {dependency}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

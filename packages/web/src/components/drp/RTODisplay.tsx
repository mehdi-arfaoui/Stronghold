import type { DRPComponent } from '@stronghold-dr/core';

import { formatMinutesRange, readString } from '@/lib/utils';

export function RTODisplay({
  component,
}: {
  readonly component: DRPComponent;
}): JSX.Element {
  const estimate = component.rtoEstimate;

  if (!estimate || estimate.rtoMinMinutes == null || estimate.rtoMaxMinutes == null) {
    return (
      <div className="rounded-2xl border border-warning/25 bg-warning-soft p-4">
        <div className="text-sm font-medium text-warning-foreground">Requires testing</div>
        <p className="mt-2 text-sm text-muted-foreground">RTO data is not verified yet.</p>
        <div className="mt-3 space-y-2 text-xs text-subtle-foreground">
          {(estimate?.factors ?? []).map((factor) => (
            <div key={`${factor.name}-${factor.value}`}>
              <span className="text-foreground">{factor.name}:</span> {factor.value}
            </div>
          ))}
          {estimate?.limitations.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-success/25 bg-success-soft p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-success-foreground">
        <span>{formatMinutesRange(estimate.rtoMinMinutes, estimate.rtoMaxMinutes)}</span>
        <span className="rounded-full bg-success/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em]">
          {estimate.confidence}
        </span>
      </div>
      <div className="mt-3 text-sm text-muted-foreground">RPO {component.estimatedRPO}</div>
      {estimate.factors.length > 0 ? (
        <div className="mt-3 space-y-2 text-xs text-subtle-foreground">
          {estimate.factors.map((factor) => (
            <div key={`${factor.name}-${factor.value}`}>
              <span className="text-foreground">{factor.name}:</span> {readString(factor.impact) ?? factor.value}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

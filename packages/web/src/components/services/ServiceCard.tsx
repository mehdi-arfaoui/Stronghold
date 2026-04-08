import type { ApiServiceSummary } from '@stronghold-dr/core';

import {
  formatOwnerName,
  ownerStatusLabel,
  ownerStatusTone,
  resolveOwnerPresentation,
} from '@/components/governance/governance-utils';
import { cn, getGradeColor } from '@/lib/utils';

function findingSummary(service: ApiServiceSummary): string {
  const counts = service.score.findingsCount;
  if (counts.critical > 0) {
    return `${counts.critical} critical`;
  }
  if (counts.high > 0) {
    return `${counts.high} high`;
  }
  if (counts.medium > 0) {
    return `${counts.medium} medium`;
  }
  if (counts.low > 0) {
    return `${counts.low} low`;
  }
  return 'No open findings';
}

export function ServiceCard({
  service,
  selected,
  onClick,
}: {
  readonly service: ApiServiceSummary;
  readonly selected: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  const owner = resolveOwnerPresentation(service.service);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl border bg-card/80 p-5 text-left transition-colors duration-150',
        selected ? 'border-accent bg-accent-soft/40' : 'border-border hover:border-accent/40 hover:bg-card',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-subtle-foreground">{service.score.criticality}</p>
          <h3 className="mt-2 text-lg font-semibold text-foreground">{service.service.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{service.service.id}</p>
        </div>
        <div
          className="rounded-full px-3 py-1 text-sm font-semibold text-white"
          style={{ backgroundColor: getGradeColor(service.score.grade) }}
        >
          {service.score.grade}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-2xl font-semibold text-foreground">{service.score.score}</div>
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Score</div>
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">{findingSummary(service)}</div>
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Findings</div>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{formatOwnerName(owner)}</div>
            <div
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em]',
                ownerStatusTone(owner.status),
              )}
            >
              {ownerStatusLabel(owner.status)}
            </div>
          </div>
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Owner</div>
        </div>
      </div>
    </button>
  );
}

import type { RiskAcceptance } from '@stronghold-dr/core';

import { cn, formatDateTime } from '@/lib/utils';

import {
  acceptanceLabel,
  acceptanceTone,
  describeAcceptanceWindow,
} from './governance-utils';

export function RiskAcceptanceBadge({
  acceptance,
}: {
  readonly acceptance: RiskAcceptance;
}): JSX.Element {
  return (
    <details className="group">
      <summary
        className={cn(
          'list-none cursor-pointer rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em]',
          acceptanceTone(acceptance.status),
        )}
      >
        {acceptanceLabel(acceptance.status)}
      </summary>
      <div className="mt-3 max-w-sm rounded-2xl border border-border bg-card/95 p-4 shadow-lg shadow-black/10">
        <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">
          Risk acceptance
        </p>
        <div className="mt-2 text-sm font-medium text-foreground">
          {acceptance.acceptedBy}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Accepted {formatDateTime(acceptance.acceptedAt)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {describeAcceptanceWindow(acceptance)}
        </p>
        <p className="mt-3 text-sm text-foreground">{acceptance.justification}</p>
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-subtle-foreground">
          Original severity {acceptance.severityAtAcceptance}
        </p>
        {acceptance.reviewNotes ? (
          <p className="mt-2 text-sm text-muted-foreground">{acceptance.reviewNotes}</p>
        ) : null}
      </div>
    </details>
  );
}

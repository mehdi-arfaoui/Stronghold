import type { ApiDriftEvent } from '@stronghold-dr/core';

import { formatDateTime } from '@/lib/utils';

import { DriftCard } from './DriftCard';

export function DriftTimeline({
  events,
}: {
  readonly events: readonly ApiDriftEvent[];
}): JSX.Element {
  return (
    <div className="space-y-8">
      {events.map((event) => (
        <section key={event.id} className="panel-elevated p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Drift event</p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">{formatDateTime(event.createdAt)}</h2>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <div>{event.changeCount} changes</div>
              <div>{event.criticalCount} critical</div>
            </div>
          </div>
          <div className="space-y-4">
            {event.changes.map((change) => (
              <DriftCard key={change.id} change={change} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

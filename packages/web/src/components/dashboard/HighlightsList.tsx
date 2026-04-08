import type { ApiHistoryTrendResponse } from '@stronghold-dr/core';

import { cn } from '@/lib/utils';

const HIGHLIGHT_TONES = {
  critical: 'border-red-500/30 bg-red-500/8 text-red-100',
  warning: 'border-amber-500/30 bg-amber-500/8 text-amber-100',
  info: 'border-sky-500/30 bg-sky-500/8 text-sky-100',
} as const;

export function HighlightsList({
  historyTrend,
  onOpenServices,
}: {
  readonly historyTrend: ApiHistoryTrendResponse | null;
  readonly onOpenServices: () => void;
}): JSX.Element {
  const highlights = historyTrend?.trend.highlights ?? [];

  return (
    <section className="panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Highlights</p>
          <h3 className="mt-2 text-2xl font-semibold text-foreground">What changed that matters</h3>
        </div>
        <div className="rounded-full border border-border bg-card/70 px-4 py-2 text-sm text-muted-foreground">
          {highlights.length} item{highlights.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {highlights.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Run another completed scan to surface posture highlights here.
          </div>
        ) : (
          highlights.slice(0, 6).map((highlight) => (
            <button
              key={`${highlight.type}-${highlight.message}`}
              type="button"
              onClick={onOpenServices}
              className={cn(
                'w-full rounded-2xl border p-4 text-left transition-colors duration-150 hover:border-accent/40',
                HIGHLIGHT_TONES[highlight.severity],
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">
                  {highlight.type.replace(/_/g, ' ')}
                </p>
                <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-white/80">
                  {highlight.severity}
                </span>
              </div>
              <p className="mt-3 text-sm text-foreground">{highlight.message}</p>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

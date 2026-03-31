import { NavLink } from 'react-router-dom';

import { CardSkeleton } from '@/components/common/Skeleton';
import { NAVIGATION_ITEMS } from '@/lib/constants';
import { cn, formatRelativeScore } from '@/lib/utils';

export interface SidebarSummaryProps {
  readonly score: number | null;
  readonly grade: string | null;
  readonly reportPath: string;
}

export function Sidebar({
  summary,
  isLoading,
}: {
  summary: SidebarSummaryProps | null;
  isLoading: boolean;
}): JSX.Element {
  return (
    <aside className="flex min-h-screen w-72 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border px-6 py-6">
        <p className="text-xs uppercase tracking-[0.26em] text-accent">Stronghold</p>
        <h2 className="mt-2 text-2xl font-semibold text-foreground">DR Control</h2>
        <p className="mt-1 text-sm text-muted-foreground">AWS recovery posture in one workspace.</p>
      </div>

      <nav className="flex-1 space-y-2 px-4 py-6">
        {NAVIGATION_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl border-l-4 px-4 py-3 text-sm transition-colors duration-150',
                isActive
                  ? 'border-accent bg-accent-soft text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-card hover:text-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-4">
        {isLoading ? (
          <CardSkeleton />
        ) : summary ? (
          <NavLink
            to={summary.reportPath}
            className="block rounded-2xl border border-accent/20 bg-accent-soft p-4 transition-colors duration-150 hover:bg-accent-soft/80"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-accent-soft-foreground">Latest score</p>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-3xl font-semibold text-foreground">
                  {formatRelativeScore(summary.score)}
                </div>
                <div className="text-sm text-muted-foreground">Recovery posture</div>
              </div>
              <div className="rounded-full bg-card px-3 py-1 text-lg font-semibold text-accent-soft-foreground">
                {summary.grade ?? 'N/A'}
              </div>
            </div>
          </NavLink>
        ) : (
          <div className="rounded-2xl border border-dashed border-border-strong bg-card/70 p-4 text-sm text-subtle-foreground">
            Run a scan to unlock the latest DR score.
          </div>
        )}
      </div>
    </aside>
  );
}

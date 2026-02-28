import { CATEGORY_COLORS, type GraphCategory } from '@/lib/graph-visuals';
import { cn } from '@/lib/utils';

const DISPLAY_TYPES: Array<{ category: GraphCategory; icon: string; label: string }> = [
  { category: 'database', icon: 'DB', label: 'Database' },
  { category: 'compute', icon: 'CP', label: 'Compute' },
  { category: 'serverless', icon: 'SV', label: 'Serverless' },
  { category: 'messaging', icon: 'MQ', label: 'Messaging' },
  { category: 'storage', icon: 'ST', label: 'Storage' },
  { category: 'loadbalancer', icon: 'LB', label: 'LoadBalancer' },
];

interface GraphLegendProps {
  compact?: boolean;
  className?: string;
}

export function GraphLegend({ compact = false, className }: GraphLegendProps) {
  if (compact) {
    return (
      <div className={cn('flex flex-wrap items-center gap-3 text-xs', className)}>
        {DISPLAY_TYPES.map(({ category, icon, label }) => {
          const colors = CATEGORY_COLORS[category];
          return (
            <div key={category} className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-muted-foreground">{icon}</span>
              <span
                className="rounded-sm border px-1.5 py-0.5 font-medium"
                style={{ background: colors.bg, borderColor: colors.border, color: colors.text }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('rounded-md border bg-card p-3 shadow-sm', className)}>
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Legende</p>
      <div className="space-y-1.5">
        {DISPLAY_TYPES.map(({ category, icon, label }) => {
          const colors = CATEGORY_COLORS[category];
          return (
            <div key={category} className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-muted-foreground">{icon}</span>
              <div
                className="h-3 w-3 rounded-sm border"
                style={{ backgroundColor: colors.bg, borderColor: colors.border }}
              />
              <span>{label}</span>
            </div>
          );
        })}
        <div className="mt-2 border-t pt-2">
          <div className="flex items-center gap-2 text-xs">
            <div className="h-0.5 w-6 bg-foreground" />
            <span>Confirmee</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="h-0.5 w-6 border-b-2 border-dashed border-[#fc8181]" />
            <span>Inferee</span>
          </div>
        </div>
      </div>
    </div>
  );
}

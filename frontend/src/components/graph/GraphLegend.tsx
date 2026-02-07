import { NODE_COLOR_MAP } from '@/lib/node-colors';
import type { NodeType } from '@/types/graph.types';

const DISPLAY_TYPES: { type: NodeType; label: string }[] = [
  { type: 'DATABASE', label: 'Base de donnees' },
  { type: 'VM', label: 'Compute' },
  { type: 'LOAD_BALANCER', label: 'Reseau' },
  { type: 'OBJECT_STORAGE', label: 'Stockage' },
  { type: 'SERVERLESS', label: 'Serverless' },
  { type: 'THIRD_PARTY_API', label: 'Externe' },
];

export function GraphLegend() {
  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Legende</p>
      <div className="space-y-1.5">
        {DISPLAY_TYPES.map(({ type, label }) => (
          <div key={type} className="flex items-center gap-2 text-xs">
            <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: NODE_COLOR_MAP[type] }} />
            <span>{label}</span>
          </div>
        ))}
        <div className="mt-2 border-t pt-2">
          <div className="flex items-center gap-2 text-xs">
            <div className="h-0.5 w-6 bg-foreground" />
            <span>Confirme</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="h-0.5 w-6 border-b-2 border-dashed border-severity-medium" />
            <span>Infere</span>
          </div>
        </div>
      </div>
    </div>
  );
}

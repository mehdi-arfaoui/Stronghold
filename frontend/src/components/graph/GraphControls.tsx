import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useGraphStore } from '@/stores/graph.store';
import { cn } from '@/lib/utils';

interface GraphControlsProps {
  onAutoLayout?: () => void;
  compact?: boolean;
  className?: string;
}

export function GraphControls({ onAutoLayout, compact = false, className }: GraphControlsProps) {
  const { layout, filters, setLayout, setFilters } = useGraphStore();

  if (compact) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-xl border bg-background/90 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75',
          className,
        )}
      >
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Chercher un service..."
            className="h-9 border-border/70 bg-background/70 pl-9"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8" onClick={onAutoLayout}>
            Auto
          </Button>
          <Button
            variant={layout === 'hierarchical' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setLayout('hierarchical')}
            className="h-8"
          >
            Hierarchie
          </Button>
          <Button
            variant={layout === 'force' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setLayout('force')}
            className="h-8"
          >
            Force
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2 rounded-lg border bg-card p-3', className)}>
      <div className="relative min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Chercher un service..."
          className="pl-9 h-9"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vues</span>
        <Button variant="outline" size="sm" className="h-8" onClick={onAutoLayout}>
          Auto
        </Button>
        <Button
          variant={layout === 'hierarchical' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setLayout('hierarchical')}
          className="h-8"
        >
          Hierarchique
        </Button>
        <Button
          variant={layout === 'force' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setLayout('force')}
          className="h-8"
        >
          Force
        </Button>
      </div>
    </div>
  );
}

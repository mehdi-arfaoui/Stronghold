import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useGraphStore } from '@/stores/graph.store';
import type { LayoutType } from '@/lib/graph-layout';

interface GraphControlsProps {
  availableTypes: string[];
  availableProviders: string[];
  availableRegions: string[];
}

export function GraphControls({ availableTypes, availableProviders, availableRegions }: GraphControlsProps) {
  const { layout, filters, setLayout, setFilters } = useGraphStore();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Chercher un service..."
          className="pl-9 h-9"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
      </div>

      {availableTypes.length > 0 && (
        <Select
          value={filters.types[0] || 'all'}
          onValueChange={(v) => setFilters({ types: v === 'all' ? [] : [v] })}
        >
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les types</SelectItem>
            {availableTypes.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {availableProviders.length > 0 && (
        <Select
          value={filters.providers[0] || 'all'}
          onValueChange={(v) => setFilters({ providers: v === 'all' ? [] : [v] })}
        >
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            {availableProviders.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {availableRegions.length > 0 && (
        <Select
          value={filters.regions[0] || 'all'}
          onValueChange={(v) => setFilters({ regions: v === 'all' ? [] : [v] })}
        >
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes</SelectItem>
            {availableRegions.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-1">
        {(['hierarchical', 'force', 'radial'] as LayoutType[]).map((l) => (
          <Button
            key={l}
            variant={layout === l ? 'default' : 'outline'}
            size="sm"
            onClick={() => setLayout(l)}
            className="h-9"
          >
            {l === 'hierarchical' ? 'Hierarchique' : l === 'force' ? 'Force' : 'Radial'}
          </Button>
        ))}
      </div>
    </div>
  );
}

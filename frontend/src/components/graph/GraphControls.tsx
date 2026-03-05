import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { useGraphStore } from '@/stores/graph.store';
import { cn } from '@/lib/utils';
import type { CriticalityFilter, DiscoveryDomain } from '@/lib/discovery-graph';
import { DISCOVERY_DOMAIN_LABELS } from '@/lib/discovery-graph';

interface GraphControlsProps {
  onAutoLayout?: () => void;
  compact?: boolean;
  className?: string;
  availableTypes?: string[];
  availableProviders?: string[];
  availableRegions?: string[];
  availableTiers?: number[];
  availableDomains?: DiscoveryDomain[];
  domainGroupingEnabled?: boolean;
  collapsedDomains?: DiscoveryDomain[];
  onToggleDomainGrouping?: (enabled: boolean) => void;
  onToggleDomainCollapsed?: (domain: DiscoveryDomain) => void;
  onCollapseAllDomains?: () => void;
  onExpandAllDomains?: () => void;
}

const CRITICALITY_OPTIONS: Array<{ value: CriticalityFilter; label: string }> = [
  { value: 'all', label: 'Toutes' },
  { value: 'high', label: 'Haute' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'low', label: 'Basse' },
  { value: 'unknown', label: 'Non notee' },
];

function toggleListValue<T extends string | number>(items: T[], value: T): T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function MultiFilterGroup<T extends string | number>({
  title,
  values,
  selected,
  formatLabel,
  onToggle,
}: {
  title: string;
  values: T[];
  selected: T[];
  formatLabel?: (value: T) => string;
  onToggle: (value: T) => void;
}) {
  if (values.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="grid max-h-32 grid-cols-1 gap-1 overflow-y-auto pr-1">
        {values.map((value) => {
          const checked = selected.includes(value);
          return (
            <label key={String(value)} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent">
              <Checkbox checked={checked} onCheckedChange={() => onToggle(value)} />
              <span className="truncate">{formatLabel ? formatLabel(value) : String(value)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function GraphControls({
  onAutoLayout,
  compact = false,
  className,
  availableTypes = [],
  availableProviders = [],
  availableRegions = [],
  availableTiers = [],
  availableDomains = [],
  domainGroupingEnabled = false,
  collapsedDomains = [],
  onToggleDomainGrouping,
  onToggleDomainCollapsed,
  onCollapseAllDomains,
  onExpandAllDomains,
}: GraphControlsProps) {
  const { layout, filters, setLayout, setFilters } = useGraphStore();
  const activeFilterCount =
    filters.types.length +
    filters.providers.length +
    filters.regions.length +
    filters.tiers.length +
    filters.domains.length +
    (filters.criticality === 'all' ? 0 : 1);

  const resetFilters = () => {
    setFilters({
      types: [],
      providers: [],
      regions: [],
      tiers: [],
      domains: [],
      criticality: 'all',
      search: '',
    });
  };

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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant={activeFilterCount > 0 ? 'default' : 'outline'} size="sm" className="h-8">
                Filtres {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[340px] space-y-3 p-3" align="start">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filtres</p>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetFilters}>
                  Reinitialiser
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Criticite</p>
                <div className="flex flex-wrap gap-1">
                  {CRITICALITY_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      size="sm"
                      variant={filters.criticality === option.value ? 'default' : 'outline'}
                      className="h-7 text-[11px]"
                      onClick={() => setFilters({ criticality: option.value })}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              <MultiFilterGroup
                title="Domaines"
                values={availableDomains}
                selected={filters.domains}
                formatLabel={(value) => DISCOVERY_DOMAIN_LABELS[value] || value}
                onToggle={(value) => setFilters({ domains: toggleListValue(filters.domains, value) })}
              />

              <MultiFilterGroup
                title="Tiers"
                values={availableTiers}
                selected={filters.tiers}
                formatLabel={(value) => `Tier ${value}`}
                onToggle={(value) => setFilters({ tiers: toggleListValue(filters.tiers, value) })}
              />

              <MultiFilterGroup
                title="Types"
                values={availableTypes}
                selected={filters.types}
                onToggle={(value) => setFilters({ types: toggleListValue(filters.types, value) })}
              />

              <MultiFilterGroup
                title="Providers"
                values={availableProviders}
                selected={filters.providers}
                onToggle={(value) => setFilters({ providers: toggleListValue(filters.providers, value) })}
              />

              <MultiFilterGroup
                title="Regions"
                values={availableRegions}
                selected={filters.regions}
                onToggle={(value) => setFilters({ regions: toggleListValue(filters.regions, value) })}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant={domainGroupingEnabled ? 'default' : 'outline'} size="sm" className="h-8">
                Clusters
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] space-y-3 p-3" align="start">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Regroupement</p>
                <Button
                  variant={domainGroupingEnabled ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onToggleDomainGrouping?.(!domainGroupingEnabled)}
                >
                  {domainGroupingEnabled ? 'Actif' : 'Inactif'}
                </Button>
              </div>
              {domainGroupingEnabled && (
                <>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCollapseAllDomains}>
                      Tout plier
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onExpandAllDomains}>
                      Tout deplier
                    </Button>
                  </div>
                  <div className="grid gap-1">
                    {availableDomains.map((domain) => {
                      const collapsed = collapsedDomains.includes(domain);
                      return (
                        <button
                          key={domain}
                          type="button"
                          className="flex items-center justify-between rounded border px-2 py-1 text-xs hover:bg-accent"
                          onClick={() => onToggleDomainCollapsed?.(domain)}
                        >
                          <span>{DISCOVERY_DOMAIN_LABELS[domain] || domain}</span>
                          <span className="text-muted-foreground">{collapsed ? 'Plie' : 'Etendu'}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </PopoverContent>
          </Popover>
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
        <Button
          variant={domainGroupingEnabled ? 'default' : 'outline'}
          size="sm"
          className="h-8"
          onClick={() => onToggleDomainGrouping?.(!domainGroupingEnabled)}
        >
          Clusters domaine
        </Button>
        <Button
          variant={activeFilterCount > 0 ? 'default' : 'outline'}
          size="sm"
          className="h-8"
          onClick={resetFilters}
        >
          Reset filtres
        </Button>
      </div>
    </div>
  );
}

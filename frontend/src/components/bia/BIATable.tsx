import { memo, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Check, CheckCircle2, ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDuration } from '@/lib/formatters';
import type { BIAEntry } from '@/types/bia.types';
import {
  DEFAULT_BIA_FILTERS,
  filterAndSortBiaEntries,
  type BIAFilters,
  type BIASortKey,
} from '@/lib/biaTable';

interface BIATableProps {
  entries: BIAEntry[];
  currency?: string;
  onUpdateEntry?: (id: string, field: string, value: number) => void;
  onValidateEntry?: (id: string) => void;
  onUpsertFinancialOverride?: (nodeId: string, payload: { customCostPerHour: number; justification?: string }) => Promise<unknown> | void;
  savingFinancialNodeId?: string | null;
}

type EditableField = 'validatedRTO' | 'validatedRPO' | 'validatedMTPD';
type SuggestionMetric = 'rto' | 'rpo' | 'mtpd';
type RowToRender = {
  entry: BIAEntry;
  index: number;
};

const VIRTUAL_ROW_HEIGHT = 92;
const VIRTUAL_OVERSCAN = 6;
const VIRTUAL_VISIBLE_ROWS = 14;

function formatHourlyCost(amount: number | null | undefined, currency: string): string {
  if (!Number.isFinite(amount as number) || Number(amount) <= 0) return '—';
  return `${formatCurrency(Number(amount), currency)}/h`;
}

function resolveBlastRatio(entry: BIAEntry): number {
  const transitive = Number(entry.blastRadius?.transitiveDependents ?? 0);
  const totalServices = Number(entry.blastRadius?.totalServices ?? 0);
  const denominator = Math.max(1, totalServices - 1);
  if (totalServices > 1) {
    return Math.max(0, Math.min(1, transitive / denominator));
  }
  if (entry.downtimeCostSource === 'fallback_criticality') return 0;
  return 0;
}

function blastLabel(entry: BIAEntry): string {
  const transitive = Number(entry.blastRadius?.transitiveDependents ?? 0);
  const totalServices = Number(entry.blastRadius?.totalServices ?? 0);
  const denominator = Math.max(1, totalServices - 1);
  if (totalServices > 1) {
    return `${transitive}/${denominator}`;
  }
  if (entry.downtimeCostSource === 'fallback_criticality') {
    return 'fallback';
  }
  return '—';
}

function precisionBadgeModel(entry: BIAEntry): {
  label: string;
  className: string;
  tooltip: string;
} {
  switch (entry.financialPrecisionBadge) {
    case 'business_flow_validated':
      return {
        label: 'Flow valide',
        className: 'border-green-300 bg-green-50 text-green-800',
        tooltip: 'Calcule depuis un flux metier valide.',
      };
    case 'estimation_enriched':
      return {
        label: 'Estimation enrichie',
        className: 'border-amber-300 bg-amber-50 text-amber-800',
        tooltip: 'Estimation enrichie par les donnees cloud.',
      };
    case 'override_user':
      return {
        label: 'Override valide',
        className: 'border-green-300 bg-green-50 text-green-800',
        tooltip: 'Valeur saisie manuellement par utilisateur.',
      };
    case 'blast_radius':
      return {
        label: 'Blast radius',
        className: 'border-blue-300 bg-blue-50 text-blue-800',
        tooltip: 'Distribution du cout basee sur le graphe de dependances.',
      };
    case 'fallback_criticality':
      return {
        label: 'Graphe incomplet',
        className: 'border-amber-300 bg-amber-50 text-amber-800',
        tooltip: 'Fallback applique sur la criticite seule.',
      };
    case 'profile_global':
      return {
        label: 'Profil global',
        className: 'border-blue-300 bg-blue-50 text-blue-800',
        tooltip: 'Valeur du profil financier global appliquee a ce service.',
      };
    case 'not_configured':
      return {
        label: 'Non configure',
        className: 'border-slate-300 bg-slate-50 text-slate-700',
        tooltip: 'Impact financier non estime tant que le profil financier n est pas configure.',
      };
    case 'business_flow_not_validated':
      return {
        label: 'Flow non valide',
        className: 'border-sky-300 bg-sky-50 text-sky-800',
        tooltip: 'Flux metier detecte mais non valide.',
      };
    default:
      return {
        label: 'Estimation',
        className: 'border-red-300 bg-red-50 text-red-800',
        tooltip: 'Estimation de base generique.',
      };
  }
}

function BIATableComponent({
  entries,
  currency = 'EUR',
  onUpdateEntry,
  onValidateEntry,
  onUpsertFinancialOverride,
  savingFinancialNodeId,
}: BIATableProps) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [overridePopoverEntry, setOverridePopoverEntry] = useState<BIAEntry | null>(null);
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideJustification, setOverrideJustification] = useState('');
  const [filters, setFilters] = useState<BIAFilters>(DEFAULT_BIA_FILTERS);

  const filteredEntries = useMemo(
    () => filterAndSortBiaEntries(entries ?? [], filters),
    [entries, filters],
  );
  const shouldVirtualize = filteredEntries.length > 50;
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const { rowsToRender, paddingTop, paddingBottom } = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        rowsToRender: filteredEntries.map((entry, index) => ({ entry, index })),
        paddingTop: 0,
        paddingBottom: 0,
      };
    }
    const maxFirstVisibleIndex = Math.max(0, filteredEntries.length - VIRTUAL_VISIBLE_ROWS);
    const firstVisibleIndex = Math.min(
      maxFirstVisibleIndex,
      Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN),
    );
    const lastVisibleExclusive = Math.min(
      filteredEntries.length,
      firstVisibleIndex + VIRTUAL_VISIBLE_ROWS + VIRTUAL_OVERSCAN * 2,
    );
    const rows = filteredEntries
      .slice(firstVisibleIndex, lastVisibleExclusive)
      .map((entry, offset) => ({ entry, index: firstVisibleIndex + offset }));
    return {
      rowsToRender: rows,
      paddingTop: firstVisibleIndex * VIRTUAL_ROW_HEIGHT,
      paddingBottom: Math.max(0, (filteredEntries.length - lastVisibleExclusive) * VIRTUAL_ROW_HEIGHT),
    };
  }, [filteredEntries, shouldVirtualize, scrollTop]);

  const handleTableScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!shouldVirtualize) return;
    setScrollTop(event.currentTarget.scrollTop);
  };

  const startEditing = (id: string, field: EditableField, currentValue: number) => {
    setEditingCell({ id, field });
    setEditValue(String(currentValue));
  };

  const commitEdit = () => {
    if (editingCell && onUpdateEntry) {
      const numVal = parseInt(editValue, 10);
      if (!Number.isNaN(numVal) && numVal >= 0) {
        onUpdateEntry(editingCell.id, editingCell.field, numVal);
      }
    }
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  const selectedTierLabel = filters.tiers.length === 4 ? 'Tous' : filters.tiers.map((tier) => `T${tier}`).join(', ');

  const setSort = (sortBy: BIASortKey) => {
    setFilters((current) => {
      if (current.sortBy === sortBy) {
        return {
          ...current,
          sortOrder: current.sortOrder === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        ...current,
        sortBy,
        sortOrder:
          sortBy === 'tier' ||
          sortBy === 'serviceName' ||
          sortBy === 'serviceType' ||
          sortBy === 'source'
            ? 'asc'
            : 'desc',
      };
    });
  };

  const toggleTier = (tier: number) => {
    setFilters((current) => {
      const exists = current.tiers.includes(tier);
      const nextTiers = exists
        ? current.tiers.filter((value) => value !== tier)
        : [...current.tiers, tier].sort((left, right) => left - right);
      return {
        ...current,
        tiers: nextTiers,
      };
    });
  };

  const resetFilters = () => {
    setFilters(DEFAULT_BIA_FILTERS);
    setScrollTop(0);
  };

  const openOverridePopover = (entry: BIAEntry) => {
    const baselineValue =
      entry.financialOverride?.customCostPerHour ??
      entry.downtimeCostPerHour ??
      entry.financialImpactPerHour ??
      0;
    setOverridePopoverEntry(entry);
    setOverrideValue(String(Math.max(1, Math.round(baselineValue))));
    setOverrideJustification(entry.financialOverride?.justification ?? '');
  };

  const closeOverridePopover = () => {
    setOverridePopoverEntry(null);
    setOverrideValue('');
    setOverrideJustification('');
  };

  const saveOverride = async () => {
    if (!overridePopoverEntry || !onUpsertFinancialOverride) return;
    const parsed = Number(overrideValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    await onUpsertFinancialOverride(overridePopoverEntry.nodeId, {
      customCostPerHour: parsed,
      justification: overrideJustification.trim() || undefined,
    });
    closeOverridePopover();
  };

  const resultCountLabel = `${filteredEntries.length} service${filteredEntries.length > 1 ? 's' : ''} affich${filteredEntries.length > 1 ? 'es' : 'e'} sur ${entries.length} total`;

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <div className="flex flex-wrap justify-between gap-3">
          <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
            Cellule coloree = suggestion IA
          </span>
          <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Estimation financiere a valider
            </span>
          </span>
        </div>

        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Tier</p>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="truncate">Tier: {selectedTierLabel}</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 space-y-3">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Tiers visibles</p>
                    {[1, 2, 3, 4].map((tier) => (
                      <label key={tier} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={filters.tiers.includes(tier)}
                          onCheckedChange={() => toggleTier(tier)}
                        />
                        <span>T{tier}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="min-w-[180px] flex-1">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Blast radius</p>
              <div className="flex gap-2">
                <Select
                  value={filters.blastRadiusOp}
                  onValueChange={(value: '>=' | '<=') =>
                    setFilters((current) => ({ ...current, blastRadiusOp: value }))
                  }
                >
                  <SelectTrigger className="w-[88px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=">=">&gt;=</SelectItem>
                    <SelectItem value="<=">&lt;=</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Ex: 5"
                  value={filters.blastRadiusValue ?? ''}
                  onChange={(event) =>
                    setFilters((current) => {
                      const parsed = Number(event.target.value);
                      return {
                        ...current,
                        blastRadiusValue: event.target.value === '' || Number.isNaN(parsed) ? null : parsed,
                      };
                    })
                  }
                />
              </div>
            </div>

            <div className="min-w-[240px] flex-[1.2]">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Cout/h indisponibilite</p>
              <div className="flex gap-2">
                <Select
                  value={filters.hourlyCostOp}
                  onValueChange={(value: '>=' | '<=') =>
                    setFilters((current) => ({ ...current, hourlyCostOp: value }))
                  }
                >
                  <SelectTrigger className="w-[88px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=">=">&gt;=</SelectItem>
                    <SelectItem value="<=">&lt;=</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Ex: 1000"
                  value={filters.hourlyCostValue ?? ''}
                  onChange={(event) =>
                    setFilters((current) => {
                      const parsed = Number(event.target.value);
                      return {
                        ...current,
                        hourlyCostValue: event.target.value === '' || Number.isNaN(parsed) ? null : parsed,
                      };
                    })
                  }
                />
                <Button
                  type="button"
                  variant={filters.sortBy === 'hourlyCost' && filters.sortOrder === 'asc' ? 'default' : 'outline'}
                  size="icon"
                  className="shrink-0"
                  onClick={() => setFilters((current) => ({ ...current, sortBy: 'hourlyCost', sortOrder: 'asc' }))}
                  aria-label="Trier le cout horaire par ordre croissant"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={filters.sortBy === 'hourlyCost' && filters.sortOrder === 'desc' ? 'default' : 'outline'}
                  size="icon"
                  className="shrink-0"
                  onClick={() => setFilters((current) => ({ ...current, sortBy: 'hourlyCost', sortOrder: 'desc' }))}
                  aria-label="Trier le cout horaire par ordre decroissant"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Button type="button" variant="ghost" size="icon" onClick={resetFilters} aria-label="Reinitialiser les filtres">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{resultCountLabel}</p>
        </div>

        <div
          ref={tableContainerRef}
          className={cn(shouldVirtualize && 'max-h-[70vh] overflow-auto rounded-md border')}
          onScroll={handleTableScroll}
        >
          <Table>
            <TableHeader className={cn(shouldVirtualize && 'sticky top-0 z-10 bg-background')}>
              <TableRow>
                <SortableTableHead label="Service" sortBy="serviceName" filters={filters} onSort={setSort} />
                <SortableTableHead label="Type" sortBy="serviceType" filters={filters} onSort={setSort} />
                <SortableTableHead label="Tier" sortBy="tier" filters={filters} onSort={setSort} align="center" />
                <SortableTableHead label="RTO" sortBy="rto" filters={filters} onSort={setSort} align="center" />
                <SortableTableHead label="RPO" sortBy="rpo" filters={filters} onSort={setSort} align="center" />
                <SortableTableHead label="MTPD" sortBy="mtpd" filters={filters} onSort={setSort} align="center" />
                <SortableTableHead label="Blast" sortBy="blastRadius" filters={filters} onSort={setSort} align="center" />
                <SortableTableHead label="Cout/h indisponibilite" sortBy="hourlyCost" filters={filters} onSort={setSort} align="center" />
                <SortableTableHead label="Source" sortBy="source" filters={filters} onSort={setSort} align="center" />
                <SortableTableHead label="Valide" sortBy="validated" filters={filters} onSort={setSort} align="center" />
              </TableRow>
            </TableHeader>
          <TableBody>
            {shouldVirtualize && paddingTop > 0 ? (
              <TableRow aria-hidden>
                <TableCell colSpan={10} className="p-0" style={{ height: `${paddingTop}px` }} />
              </TableRow>
            ) : null}
            {rowsToRender.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  Aucun service ne correspond aux filtres selectionnes.
                </TableCell>
              </TableRow>
            ) : null}
            {rowsToRender.map(({ entry, index }: RowToRender) => (
              <TableRow
                key={`${entry.id}-${index}`}
                className={cn(!entry.validated && 'bg-severity-medium/5')}
                style={
                  shouldVirtualize
                    ? undefined
                    : { animation: 'fadeIn 0.35s ease forwards', animationDelay: `${index * 80}ms`, opacity: 0 }
                }
              >
                <TableCell className="font-medium">{entry.serviceName}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{entry.serviceTypeLabel ?? entry.serviceType}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant={entry.tier === 1 ? 'destructive' : entry.tier === 2 ? 'default' : 'secondary'}>
                        {entry.tier}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      {entry.criticalityClassification ? (
                        <div className="space-y-1 text-xs">
                          <p className="font-semibold">
                            Tier auto: {entry.criticalityClassification.tier}
                            {entry.criticalityClassification.confidence != null
                              ? ` (confiance ${Math.round(entry.criticalityClassification.confidence * 100)}%)`
                              : ''}
                          </p>
                          {entry.criticalityClassification.signals.length > 0 ? (
                            <div className="space-y-0.5">
                              {entry.criticalityClassification.signals.map((signal, idx) => (
                                <p key={`${entry.id}-tier-signal-${idx}`}>- {signal}</p>
                              ))}
                            </div>
                          ) : (
                            <p>Aucun signal de classification disponible.</p>
                          )}
                        </div>
                      ) : (
                        <p>Tier calcule sans signaux detailles.</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <EditableCell
                  entry={entry}
                  metric="rto"
                  field="validatedRTO"
                  suggestedValue={entry.suggestion?.rto ?? entry.rtoSuggested ?? 0}
                  currentValue={entry.rto}
                  editing={editingCell?.id === entry.id && editingCell?.field === 'validatedRTO'}
                  editValue={editValue}
                  onStartEdit={startEditing}
                  onEditValueChange={setEditValue}
                  onCommit={commitEdit}
                  onCancel={cancelEdit}
                />
                <EditableCell
                  entry={entry}
                  metric="rpo"
                  field="validatedRPO"
                  suggestedValue={entry.suggestion?.rpo ?? entry.rpoSuggested ?? 0}
                  currentValue={entry.rpo}
                  editing={editingCell?.id === entry.id && editingCell?.field === 'validatedRPO'}
                  editValue={editValue}
                  onStartEdit={startEditing}
                  onEditValueChange={setEditValue}
                  onCommit={commitEdit}
                  onCancel={cancelEdit}
                />
                <EditableCell
                  entry={entry}
                  metric="mtpd"
                  field="validatedMTPD"
                  suggestedValue={entry.suggestion?.mtpd ?? entry.mtpdSuggested ?? 0}
                  currentValue={entry.mtpd}
                  editing={editingCell?.id === entry.id && editingCell?.field === 'validatedMTPD'}
                  editValue={editValue}
                  onStartEdit={startEditing}
                  onEditValueChange={setEditValue}
                  onCommit={commitEdit}
                  onCancel={cancelEdit}
                />
                <TableCell className="text-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="mx-auto w-24">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-sky-500 transition-all"
                            style={{ width: `${Math.round(resolveBlastRatio(entry) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">{blastLabel(entry)}</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>{entry.downtimeCostRationale || 'Blast radius non disponible.'}</p>
                      {entry.blastRadius?.impactedServices?.length ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Impacte: {entry.blastRadius.impactedServices.join(', ')}
                        </p>
                      ) : null}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-center">
                  <Popover
                    open={overridePopoverEntry?.nodeId === entry.nodeId}
                    onOpenChange={(open) => {
                      if (open) {
                        openOverridePopover(entry);
                      } else if (overridePopoverEntry?.nodeId === entry.nodeId) {
                        closeOverridePopover();
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <div className="inline-flex flex-col items-end gap-1">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 hover:bg-accent/40"
                          onClick={() => openOverridePopover(entry)}
                        >
                          <span className="font-medium">
                            {formatHourlyCost(entry.downtimeCostPerHour ?? entry.financialImpactPerHour, currency)}
                          </span>
                          {entry.financialScopeLabel && (
                            <span className="text-[10px] text-muted-foreground">
                              ({entry.financialScopeLabel})
                            </span>
                          )}
                          {entry.financialIsOverride ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Valide par l'utilisateur</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>Cliquez pour saisir votre chiffre metier.</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                'rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                                precisionBadgeModel(entry).className,
                              )}
                            >
                              {precisionBadgeModel(entry).label}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{precisionBadgeModel(entry).tooltip}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </PopoverTrigger>

                    <PopoverContent align="end" className="w-80 space-y-3">
                      <div>
                        <p className="text-sm font-semibold">Override cout d indisponibilite</p>
                        <p className="text-xs text-muted-foreground">
                          Remplacez l estimation Stronghold par votre cout business reel.
                        </p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Montant ({currency}/h)</label>
                        <Input
                          type="number"
                          min={1}
                          value={overrideValue}
                          onChange={(event) => setOverrideValue(event.target.value)}
                          placeholder="Ex: 4500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Justification (optionnel)</label>
                        <textarea
                          value={overrideJustification}
                          onChange={(event) => setOverrideJustification(event.target.value)}
                          placeholder="Ex: base sur notre analyse interne Q4 2025"
                          className="min-h-[84px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={closeOverridePopover}>
                          Annuler
                        </Button>
                        <Button
                          size="sm"
                          onClick={saveOverride}
                          disabled={
                            !overridePopoverEntry ||
                            savingFinancialNodeId === overridePopoverEntry.nodeId ||
                            Number(overrideValue) <= 0
                          }
                        >
                          {savingFinancialNodeId === overridePopoverEntry?.nodeId ? 'Sauvegarde...' : 'Sauvegarder'}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-xs text-muted-foreground">
                    {entry.downtimeCostSourceLabel || entry.financialScopeLabel || '—'}
                  </span>
                  {entry.downtimeCostSource === 'fallback_criticality' ? (
                    <p className="mt-1 text-[10px] text-amber-600">graphe incomplet</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-center">
                  {entry.validated ? (
                    <Check className="mx-auto h-4 w-4 text-resilience-high" />
                  ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onValidateEntry?.(entry.id)}>
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {shouldVirtualize && paddingBottom > 0 ? (
              <TableRow aria-hidden>
                <TableCell colSpan={10} className="p-0" style={{ height: `${paddingBottom}px` }} />
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      </div>
    </TooltipProvider>
  );
}

export const BIATable = memo(BIATableComponent);

interface SortableTableHeadProps {
  label: string;
  sortBy: BIASortKey;
  filters: BIAFilters;
  onSort: (sortBy: BIASortKey) => void;
  align?: 'left' | 'center';
}

function SortableTableHead({
  label,
  sortBy,
  filters,
  onSort,
  align = 'left',
}: SortableTableHeadProps) {
  const isActive = filters.sortBy === sortBy;
  const Icon = isActive ? (filters.sortOrder === 'asc' ? ChevronUp : ChevronDown) : ArrowDownUp;

  return (
    <TableHead className={cn(align === 'center' && 'text-center')}>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
          align === 'center' && 'mx-auto justify-center',
        )}
        onClick={() => onSort(sortBy)}
        aria-label={`Trier par ${label.replace('/h', ' horaire')}`}
      >
        <span>{label}</span>
        <Icon className={cn('h-3.5 w-3.5', isActive && 'text-foreground')} />
      </button>
    </TableHead>
  );
}

interface EditableCellProps {
  entry: BIAEntry;
  field: EditableField;
  metric: SuggestionMetric;
  suggestedValue: number;
  currentValue: number | null;
  editing: boolean;
  editValue: string;
  onStartEdit: (id: string, field: EditableField, value: number) => void;
  onEditValueChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function EditableCell({
  entry,
  field,
  metric,
  suggestedValue,
  currentValue,
  editing,
  editValue,
  onStartEdit,
  onEditValueChange,
  onCommit,
  onCancel,
}: EditableCellProps) {
  if (editing) {
    return (
      <TableCell className="text-center">
        <div className="flex flex-col items-center gap-1">
          <Input
            type="range"
            min={0}
            max={Math.max(1440, suggestedValue * 3)}
            value={Number(editValue || suggestedValue)}
            onChange={(event) => onEditValueChange(event.target.value)}
            className="h-6 w-28"
          />
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={editValue}
              onChange={(event) => onEditValueChange(event.target.value)}
              className="h-7 w-20 text-center"
              onKeyDown={(event) => {
                if (event.key === 'Enter') onCommit();
                if (event.key === 'Escape') onCancel();
              }}
              autoFocus
            />
            <span className="text-xs text-muted-foreground">min</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={onCommit}>Valider</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onCancel}>Annuler</Button>
          </div>
        </div>
      </TableCell>
    );
  }

  const suggestedMetricValue = entry.suggestion?.[metric] ?? suggestedValue;
  const hasSuggestion = currentValue == null && suggestedMetricValue > 0;
  const shownValue = currentValue ?? suggestedMetricValue;
  const confidence = entry.suggestion?.confidence ?? 'low';

  return (
    <TableCell className={cn('text-center', hasSuggestion && 'bg-sky-50 dark:bg-sky-950/20')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex cursor-pointer flex-col items-center rounded-md p-1 hover:bg-accent/50"
            onClick={() => onStartEdit(entry.id, field, shownValue)}
          >
            <span className={cn(hasSuggestion && 'font-medium text-sky-700 dark:text-sky-300')}>
              {formatDuration(shownValue)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-96">
          <div className="space-y-1 text-xs">
            <p className="font-semibold">Raisonnement ({confidence})</p>
            {(entry.suggestion?.reasoning ?? []).map((line, idx) => (
              <p key={`${field}-${idx}`}>- {line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TableCell>
  );
}






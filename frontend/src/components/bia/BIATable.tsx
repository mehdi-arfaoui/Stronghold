import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, X } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/formatters';
import type { BIAEntry } from '@/types/bia.types';

interface BIATableProps {
  entries: BIAEntry[];
  currencySymbol?: string;
  onUpdateEntry?: (id: string, field: string, value: number) => void;
  onValidateEntry?: (id: string) => void;
  onUpsertFinancialOverride?: (nodeId: string, payload: { customCostPerHour: number; justification?: string }) => Promise<unknown> | void;
  savingFinancialNodeId?: string | null;
}

type EditableField = 'validatedRTO' | 'validatedRPO' | 'validatedMTPD';
type SuggestionMetric = 'rto' | 'rpo' | 'mtpd';

function formatHourlyCost(amount: number, currencySymbol: string): string {
  if (!Number.isFinite(amount) || amount <= 0) return `${currencySymbol}0/h`;
  if (amount >= 1_000_000) return `${currencySymbol}${(amount / 1_000_000).toFixed(1)}M/h`;
  if (amount >= 1_000) return `${currencySymbol}${Math.round(amount / 1_000)}K/h`;
  return `${currencySymbol}${Math.round(amount)}/h`;
}

export function BIATable({
  entries,
  currencySymbol = '\u20AC',
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

  const sortedEntries = useMemo(
    () => [...(entries ?? [])].sort((a, b) => (b.financialImpactPerHour ?? 0) - (a.financialImpactPerHour ?? 0)),
    [entries],
  );

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

  const openOverridePopover = (entry: BIAEntry) => {
    setOverridePopoverEntry(entry);
    setOverrideValue(String(Math.max(1, Math.round(entry.financialOverride?.customCostPerHour ?? entry.financialImpactPerHour ?? 1))));
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

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <div className="flex justify-between gap-3">
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-center">Tier</TableHead>
              <TableHead className="text-center">RTO</TableHead>
              <TableHead className="text-center">RPO</TableHead>
              <TableHead className="text-center">MTPD</TableHead>
              <TableHead className="text-center">Cout/h indisponibilite</TableHead>
              <TableHead className="text-center">Valide</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedEntries.map((entry, index) => (
              <TableRow
                key={entry.id}
                className={cn(!entry.validated && 'bg-severity-medium/5')}
                style={{ animation: 'fadeIn 0.35s ease forwards', animationDelay: `${index * 80}ms`, opacity: 0 }}
              >
                <TableCell className="font-medium">{entry.serviceName}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{entry.serviceType}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={entry.tier === 1 ? 'destructive' : entry.tier === 2 ? 'default' : 'secondary'}>
                    {entry.tier}
                  </Badge>
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
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 hover:bg-accent/40"
                        onClick={() => openOverridePopover(entry)}
                      >
                        <span className="font-medium">{formatHourlyCost(entry.financialImpactPerHour ?? 0, currencySymbol)}</span>
                        {entry.financialIsOverride ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Validé par l'utilisateur</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p>Estimation Stronghold basee sur des benchmarks publics. Cliquez pour saisir votre chiffre metier.</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </button>
                    </PopoverTrigger>

                    <PopoverContent align="end" className="w-80 space-y-3">
                      <div>
                        <p className="text-sm font-semibold">Override cout d indisponibilite</p>
                        <p className="text-xs text-muted-foreground">
                          Remplacez l estimation Stronghold par votre cout business reel.
                        </p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Montant ({currencySymbol}/h)</label>
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
                          placeholder="Ex: basé sur notre analyse interne Q4 2025"
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
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
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

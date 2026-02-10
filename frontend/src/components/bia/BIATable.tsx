import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/formatters';
import type { BIAEntry } from '@/types/bia.types';

interface BIATableProps {
  entries: BIAEntry[];
  onUpdateEntry?: (id: string, field: string, value: number) => void;
  onValidateEntry?: (id: string) => void;
}

export function BIATable({ entries, onUpdateEntry, onValidateEntry }: BIATableProps) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEditing = (id: string, field: string, currentValue: number) => {
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

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-center">Tier</TableHead>
            <TableHead className="text-center">RTO</TableHead>
            <TableHead className="text-center">RPO</TableHead>
            <TableHead className="text-center">MTPD</TableHead>
            <TableHead className="text-center">Valide</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(entries ?? []).map((entry, index) => (
            <TableRow
              key={entry.id}
              className={cn(!entry.validated && 'bg-severity-medium/5')}
              style={{ animation: 'fadeIn 0.35s ease forwards', animationDelay: `${index * 100}ms`, opacity: 0 }}
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
                field="rto"
                suggestedValue={entry.suggestion?.rto ?? entry.rtoSuggested ?? 0}
                currentValue={entry.rto}
                editing={editingCell?.id === entry.id && editingCell?.field === 'rto'}
                editValue={editValue}
                onStartEdit={startEditing}
                onEditValueChange={setEditValue}
                onCommit={commitEdit}
                onCancel={cancelEdit}
                onAccept={() => onUpdateEntry?.(entry.id, 'validatedRTO', entry.suggestion?.rto ?? entry.rtoSuggested ?? 0)}
              />
              <EditableCell
                entry={entry}
                field="rpo"
                suggestedValue={entry.suggestion?.rpo ?? entry.rpoSuggested ?? 0}
                currentValue={entry.rpo}
                editing={editingCell?.id === entry.id && editingCell?.field === 'rpo'}
                editValue={editValue}
                onStartEdit={startEditing}
                onEditValueChange={setEditValue}
                onCommit={commitEdit}
                onCancel={cancelEdit}
                onAccept={() => onUpdateEntry?.(entry.id, 'validatedRPO', entry.suggestion?.rpo ?? entry.rpoSuggested ?? 0)}
              />
              <EditableCell
                entry={entry}
                field="mtpd"
                suggestedValue={entry.suggestion?.mtpd ?? entry.mtpdSuggested ?? 0}
                currentValue={entry.mtpd}
                editing={editingCell?.id === entry.id && editingCell?.field === 'mtpd'}
                editValue={editValue}
                onStartEdit={startEditing}
                onEditValueChange={setEditValue}
                onCommit={commitEdit}
                onCancel={cancelEdit}
                onAccept={() => onUpdateEntry?.(entry.id, 'validatedMTPD', entry.suggestion?.mtpd ?? entry.mtpdSuggested ?? 0)}
              />
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
    </TooltipProvider>
  );
}

interface EditableCellProps {
  entry: BIAEntry;
  field: 'rto' | 'rpo' | 'mtpd';
  suggestedValue: number;
  currentValue: number | null;
  editing: boolean;
  editValue: string;
  onStartEdit: (id: string, field: string, value: number) => void;
  onEditValueChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onAccept: () => void;
}

function EditableCell({
  entry,
  field,
  suggestedValue,
  currentValue,
  editing,
  editValue,
  onStartEdit,
  onEditValueChange,
  onCommit,
  onCancel,
  onAccept,
}: EditableCellProps) {
  const confidence = entry.suggestion?.confidence ?? 'low';
  const confidenceBadge = confidence === 'high' ? '🟢' : confidence === 'medium' ? '🟡' : '🔴';

  if (editing) {
    return (
      <TableCell className="text-center">
        <div className="flex flex-col items-center gap-1">
          <Input
            type="range"
            min={0}
            max={Math.max(1440, suggestedValue * 3)}
            value={Number(editValue || suggestedValue)}
            onChange={(e) => onEditValueChange(e.target.value)}
            className="h-6 w-28"
          />
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              className="h-7 w-20 text-center"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommit();
                if (e.key === 'Escape') onCancel();
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

  const hasSuggestion = currentValue == null && (entry.suggestion?.[field] ?? suggestedValue) > 0;
  const shownValue = currentValue ?? (entry.suggestion?.[field] ?? suggestedValue);

  return (
    <TableCell className={cn('text-center', hasSuggestion && 'bg-violet-50 dark:bg-violet-950/20')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex cursor-pointer flex-col items-center hover:bg-accent/50 rounded-md p-1" onClick={() => onStartEdit(entry.id, field, shownValue)}>
            <span className={cn(hasSuggestion && 'text-violet-700 dark:text-violet-300 font-medium')}>
              {formatDuration(shownValue)}
            </span>
            {hasSuggestion && (
              <>
                <span className="text-[10px] text-violet-700 dark:text-violet-300">💡 Suggestion IA {confidenceBadge}</span>
                <div className="mt-1 flex gap-1">
                  <Button size="sm" className="h-5 px-1.5 text-[10px]" onClick={(e) => { e.stopPropagation(); onAccept(); }}>
                    Accepter
                  </Button>
                  <Button size="sm" variant="outline" className="h-5 px-1.5 text-[10px]" onClick={(e) => { e.stopPropagation(); onStartEdit(entry.id, field, shownValue); }}>
                    Modifier
                  </Button>
                </div>
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-96">
          <div className="space-y-1 text-xs">
            <p className="font-semibold">Raisonnement ({confidence})</p>
            {(entry.suggestion?.reasoning ?? []).map((line, idx) => (
              <p key={`${field}-${idx}`}>• {line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TableCell>
  );
}

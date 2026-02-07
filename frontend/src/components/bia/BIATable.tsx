import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
      if (!isNaN(numVal) && numVal >= 0) {
        onUpdateEntry(editingCell.id, editingCell.field, numVal);
      }
    }
    setEditingCell(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
  };

  return (
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
        {entries.map((entry) => (
          <TableRow
            key={entry.id}
            className={cn(!entry.validated && 'bg-severity-medium/5')}
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
              suggestedValue={entry.rtoSuggested}
              currentValue={entry.rto}
              editing={editingCell?.id === entry.id && editingCell?.field === 'rto'}
              editValue={editValue}
              onStartEdit={startEditing}
              onEditValueChange={setEditValue}
              onCommit={commitEdit}
              onCancel={cancelEdit}
            />
            <EditableCell
              entry={entry}
              field="rpo"
              suggestedValue={entry.rpoSuggested}
              currentValue={entry.rpo}
              editing={editingCell?.id === entry.id && editingCell?.field === 'rpo'}
              editValue={editValue}
              onStartEdit={startEditing}
              onEditValueChange={setEditValue}
              onCommit={commitEdit}
              onCancel={cancelEdit}
            />
            <EditableCell
              entry={entry}
              field="mtpd"
              suggestedValue={entry.mtpdSuggested}
              currentValue={entry.mtpd}
              editing={editingCell?.id === entry.id && editingCell?.field === 'mtpd'}
              editValue={editValue}
              onStartEdit={startEditing}
              onEditValueChange={setEditValue}
              onCommit={commitEdit}
              onCancel={cancelEdit}
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
  );
}

interface EditableCellProps {
  entry: BIAEntry;
  field: string;
  suggestedValue: number;
  currentValue: number;
  editing: boolean;
  editValue: string;
  onStartEdit: (id: string, field: string, value: number) => void;
  onEditValueChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
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
}: EditableCellProps) {
  if (editing) {
    return (
      <TableCell className="text-center">
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
      </TableCell>
    );
  }

  const isSuggested = currentValue === suggestedValue && !entry.validated;

  return (
    <TableCell
      className="cursor-pointer text-center hover:bg-accent"
      onClick={() => onStartEdit(entry.id, field, currentValue)}
    >
      <span className={cn(isSuggested && 'text-muted-foreground italic')}>
        {formatDuration(currentValue)}
      </span>
      {isSuggested && <span className="ml-1 text-xs text-muted-foreground">(sugg.)</span>}
    </TableCell>
  );
}

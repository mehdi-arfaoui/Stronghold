import { useState } from 'react';
import { toast } from 'sonner';
import {
  Download,
  FileSpreadsheet,
  FileText,
  FileJson,
  File,
  Clipboard,
  Check,
  Loader2,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { biaApi } from '@/api/bia.api';

type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'json';

interface ExportColumn {
  key: string;
  label: string;
  enabled: boolean;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'csv', label: 'CSV', icon: <FileText className="h-5 w-5" />, description: 'Comma-separated values' },
  { value: 'xlsx', label: 'Excel', icon: <FileSpreadsheet className="h-5 w-5" />, description: 'Mise en forme auto' },
  { value: 'pdf', label: 'PDF', icon: <File className="h-5 w-5" />, description: 'Rapport formate' },
  { value: 'json', label: 'JSON', icon: <FileJson className="h-5 w-5" />, description: 'Integration technique' },
];

const DEFAULT_COLUMNS: ExportColumn[] = [
  { key: 'serviceName', label: 'Service', enabled: true },
  { key: 'serviceType', label: 'Type', enabled: true },
  { key: 'tier', label: 'Tier', enabled: true },
  { key: 'rto', label: 'RTO (min)', enabled: true },
  { key: 'rpo', label: 'RPO (min)', enabled: true },
  { key: 'mtpd', label: 'MTPD (min)', enabled: true },
  { key: 'financialImpactPerHour', label: 'Impact financier/h', enabled: true },
  { key: 'validated', label: 'Valide', enabled: true },
  { key: 'dependencies', label: 'Dependances', enabled: true },
];

interface ExportPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalRows?: number;
  activeFilters?: string[];
}

export function ExportPanel({ open, onOpenChange, totalRows = 0, activeFilters = [] }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [columns, setColumns] = useState<ExportColumn[]>(DEFAULT_COLUMNS);
  const [exportAll, setExportAll] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [copied, setCopied] = useState(false);

  const enabledColumns = columns.filter((c) => c.enabled);

  const toggleColumn = (key: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.key === key ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const toggleAllColumns = (enabled: boolean) => {
    setColumns((prev) => prev.map((c) => ({ ...c, enabled })));
  };

  const handleExport = async () => {
    if (enabledColumns.length === 0) {
      toast.error('Selectionnez au moins une colonne');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      // Simulate progress for UX
      const progressInterval = setInterval(() => {
        setExportProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await biaApi.exportCSV();

      clearInterval(progressInterval);
      setExportProgress(100);

      // Create download
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data as BlobPart]);
      const mimeTypes: Record<ExportFormat, string> = {
        csv: 'text/csv',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pdf: 'application/pdf',
        json: 'application/json',
      };

      const downloadBlob = new Blob([blob], { type: mimeTypes[format] });
      const url = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bia-export.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Export ${format.toUpperCase()} telecharge`);
      onOpenChange(false);
    } catch (err) {
      toast.error("Erreur lors de l'export. Veuillez reessayer.");
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleCopyClipboard = async () => {
    try {
      const response = await biaApi.exportCSV();
      const text = typeof response.data === 'string' ? response.data : await (response.data as Blob).text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Donnees copiees dans le presse-papier');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Impossible de copier dans le presse-papier');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] flex flex-col" aria-label="Panneau d'export">
        <SheetHeader>
          <SheetTitle>Exporter les donnees</SheetTitle>
          <SheetDescription>
            Choisissez le format et les colonnes a exporter
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          {/* Format Selection */}
          <div>
            <Label className="mb-3 block text-sm font-medium">Format</Label>
            <div className="grid grid-cols-2 gap-2">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFormat(opt.value)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-all duration-200',
                    format === opt.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary/50 hover:bg-accent'
                  )}
                  aria-pressed={format === opt.value}
                >
                  <div className={cn(
                    'transition-colors',
                    format === opt.value ? 'text-primary' : 'text-muted-foreground'
                  )}>
                    {opt.icon}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Column Selection */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Label className="text-sm font-medium">Colonnes ({enabledColumns.length}/{columns.length})</Label>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => toggleAllColumns(true)}
                >
                  Tout
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => toggleAllColumns(false)}
                >
                  Aucun
                </Button>
              </div>
            </div>
            <div className="space-y-1.5 rounded-lg border p-3">
              {columns.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-3 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent transition-colors"
                >
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <Checkbox
                    checked={col.enabled}
                    onCheckedChange={() => toggleColumn(col.key)}
                    aria-label={`Inclure ${col.label}`}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Filters */}
          {activeFilters.length > 0 && (
            <div>
              <Label className="mb-2 block text-sm font-medium">Filtres actifs</Label>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {activeFilters.map((f) => (
                  <span key={f} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                    {f}
                  </span>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={!exportAll}
                  onCheckedChange={(checked) => setExportAll(!checked)}
                />
                Exporter uniquement les donnees filtrees
              </label>
            </div>
          )}

          {/* Progress */}
          {isExporting && (
            <div>
              <Progress value={exportProgress} className="h-2" />
              <p className="mt-1 text-xs text-muted-foreground text-center">
                Export en cours... {Math.round(exportProgress)}%
              </p>
            </div>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 pt-4 border-t">
          <Button
            onClick={handleExport}
            disabled={isExporting || enabledColumns.length === 0}
            className="w-full"
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Exporter en {format.toUpperCase()}
          </Button>
          <Button
            variant="outline"
            onClick={handleCopyClipboard}
            className="w-full"
          >
            {copied ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <Clipboard className="mr-2 h-4 w-4" />
            )}
            {copied ? 'Copie !' : 'Copier dans le presse-papier'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

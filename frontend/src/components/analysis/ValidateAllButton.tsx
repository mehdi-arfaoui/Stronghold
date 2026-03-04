import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { biaApi } from '@/api/bia.api';

export interface ValidationResult {
  id: string;
  status: 'validated' | 'warning' | 'error';
  message?: string;
}

interface ValidateAllButtonProps {
  entries: Array<{ id: string; serviceName: string; validationStatus?: string }>;
  onValidationUpdate?: (results: Map<string, ValidationResult>) => void;
  className?: string;
}

/** SVG circular progress ring that fills proportionally */
function ProgressRing({ progress, size = 20, strokeWidth = 2.5 }: { progress: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="opacity-20"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-primary transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  );
}

export function ValidateAllButton({ entries, onValidationUpdate, className }: ValidateAllButtonProps) {
  const queryClient = useQueryClient();
  const [isValidating, setIsValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Map<string, ValidationResult>>(new Map());

  const pendingEntries = entries.filter(
    (e) => !e.validationStatus || e.validationStatus === 'pending' || e.validationStatus === 'draft'
  );

  const runValidation = useCallback(async () => {
    if (pendingEntries.length === 0) {
      toast.info('Aucun élément en attente de validation');
      return;
    }

    setIsValidating(true);
    setProgress(0);
    setResults(new Map());

    const newResults = new Map<string, ValidationResult>();
    const total = pendingEntries.length;

    try {
      // Call the backend validate-all endpoint (bulk update)
      const response = await biaApi.validateAll();
      const backendData = response.data as { validated?: number };
      const validatedCount = typeof backendData?.validated === 'number' ? backendData.validated : total;

      // Animate cascade with 120ms delay between each for visual feedback
      for (let i = 0; i < pendingEntries.length; i++) {
        const entry = pendingEntries[i];
        await new Promise((resolve) => setTimeout(resolve, 120));

        const result: ValidationResult = { id: entry.id, status: 'validated' };
        newResults.set(entry.id, result);
        setResults(new Map(newResults));
        setProgress(((i + 1) / total) * 100);
        onValidationUpdate?.(new Map(newResults));
      }

      // Summary toast
      const validated = [...newResults.values()].filter((r) => r.status === 'validated').length;
      const warnings = [...newResults.values()].filter((r) => r.status === 'warning').length;
      const errors = [...newResults.values()].filter((r) => r.status === 'error').length;

      if (warnings > 0 || errors > 0) {
        const parts: string[] = [];
        if (warnings > 0) parts.push(`${warnings} attention requise`);
        if (errors > 0) parts.push(`${errors} erreur(s)`);

        const firstProblemId = [...newResults.entries()].find(
          ([, r]) => r.status === 'warning' || r.status === 'error'
        )?.[0];

        toast.warning(`${validated}/${total} elements valides — ${parts.join(', ')}`, {
          duration: 8000,
          action: firstProblemId
            ? {
                label: 'Voir les problèmes',
                onClick: () => {
                  const el = document.querySelector(`[data-entry-id="${firstProblemId}"]`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                },
              }
            : undefined,
        });
      } else {
        toast.success(`${validatedCount} élément(s) validé(s) avec succès`);
      }

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['bia-entries'] });
      queryClient.invalidateQueries({ queryKey: ['bia-summary'] });
    } catch {
      toast.error('Erreur lors de la validation. Veuillez réessayer.');
    } finally {
      setTimeout(() => {
        setIsValidating(false);
        setProgress(0);
      }, 600);
    }
  }, [pendingEntries, onValidationUpdate, queryClient]);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={runValidation}
        disabled={isValidating || pendingEntries.length === 0}
        aria-label="Valider tous les éléments"
        className={cn(
          'transition-all duration-300',
          progress >= 100 && isValidating && 'border-resilience-high text-resilience-high'
        )}
      >
        {isValidating ? (
          <ProgressRing progress={progress} />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        <span className="ml-2">
          {isValidating
            ? `Validation... ${results.size}/${pendingEntries.length}`
            : pendingEntries.length === 0
              ? 'Tout est validé'
              : `Valider tout (${pendingEntries.length})`}
        </span>
      </Button>
    </div>
  );
}

/** Helper component for row-level validation status indicator */
export function ValidationStatusIndicator({ result }: { result?: ValidationResult }) {
  if (!result) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs transition-all duration-300',
        result.status === 'validated' && 'text-resilience-high',
        result.status === 'warning' && 'text-severity-medium',
        result.status === 'error' && 'text-severity-critical'
      )}
      style={{
        animation: 'validation-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {result.status === 'validated' && <CheckCircle2 className="h-4 w-4" />}
      {result.status === 'warning' && <AlertTriangle className="h-4 w-4" />}
      {result.status === 'error' && <XCircle className="h-4 w-4" />}
      {result.message && (
        <span className="max-w-[200px] truncate">{result.message}</span>
      )}
    </div>
  );
}

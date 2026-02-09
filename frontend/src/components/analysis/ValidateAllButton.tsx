import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, AlertTriangle, XCircle, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { biaApi } from '@/api/bia.api';

export interface ValidationResult {
  id: string;
  status: 'validated' | 'warning' | 'error';
  message?: string;
}

interface ValidateAllButtonProps {
  entries: Array<{ id: string; serviceName: string }>;
  onValidationUpdate?: (results: Map<string, ValidationResult>) => void;
  className?: string;
}

export function ValidateAllButton({ entries, onValidationUpdate, className }: ValidateAllButtonProps) {
  const queryClient = useQueryClient();
  const [isValidating, setIsValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Map<string, ValidationResult>>(new Map());

  const runValidation = useCallback(async () => {
    if (entries.length === 0) {
      toast.info('Aucun element a valider');
      return;
    }

    setIsValidating(true);
    setProgress(0);
    setResults(new Map());

    const newResults = new Map<string, ValidationResult>();
    const total = entries.length;

    try {
      // Call the backend validate-all endpoint
      const response = await biaApi.validateAll();
      const backendResults = response.data;

      // Animate cascade with 150ms delay between each
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Find matching backend result or create a successful one
        const backendResult = Array.isArray(backendResults)
          ? backendResults.find((r: { id: string }) => r.id === entry.id)
          : null;

        const result: ValidationResult = backendResult
          ? {
              id: entry.id,
              status: backendResult.status || 'validated',
              message: backendResult.message,
            }
          : {
              id: entry.id,
              status: 'validated',
            };

        newResults.set(entry.id, result);
        setResults(new Map(newResults));
        setProgress(((i + 1) / total) * 100);
        onValidationUpdate?.(new Map(newResults));
      }

      // Summary toast
      const validated = [...newResults.values()].filter((r) => r.status === 'validated').length;
      const warnings = [...newResults.values()].filter((r) => r.status === 'warning').length;
      const errors = [...newResults.values()].filter((r) => r.status === 'error').length;

      const firstProblemId = [...newResults.entries()].find(
        ([, r]) => r.status === 'warning' || r.status === 'error'
      )?.[0];

      if (warnings > 0 || errors > 0) {
        toast.warning(
          `${validated}/${total} elements valides — ${warnings > 0 ? `${warnings} attention requise` : ''} ${errors > 0 ? `${errors} erreur(s)` : ''}`,
          {
            duration: 8000,
            action: firstProblemId
              ? {
                  label: 'Voir les problemes',
                  onClick: () => {
                    const el = document.querySelector(`[data-entry-id="${firstProblemId}"]`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  },
                }
              : undefined,
          }
        );
      } else {
        toast.success(`${validated}/${total} elements valides avec succes`);
      }

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['bia-entries'] });
      queryClient.invalidateQueries({ queryKey: ['bia-summary'] });
    } catch (err) {
      toast.error('Erreur lors de la validation. Veuillez reessayer.');
    } finally {
      setIsValidating(false);
    }
  }, [entries, onValidationUpdate, queryClient]);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={runValidation}
        disabled={isValidating}
        aria-label="Valider tous les elements"
      >
        {isValidating ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="mr-2 h-4 w-4" />
        )}
        {isValidating ? 'Validation en cours...' : 'Valider tout'}
      </Button>

      {isValidating && (
        <div className="flex-1 max-w-xs">
          <Progress value={progress} className="h-2" />
          <p className="mt-1 text-xs text-muted-foreground">
            {Math.round(progress)}% — {results.size}/{entries.length}
          </p>
        </div>
      )}
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

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { RISK_MATRIX_LABELS } from '@/lib/constants';
import type { Risk } from '@/types/risks.types';

interface RiskMatrixProps {
  risks: Risk[];
  onCellClick?: (probability: number, impact: number) => void;
}

function getCellColor(prob: number, impact: number): string {
  const score = prob * impact;
  if (score >= 16) return 'bg-severity-critical/80 text-white';
  if (score >= 10) return 'bg-severity-high/80 text-white';
  if (score >= 5) return 'bg-severity-medium/80 text-white';
  return 'bg-severity-low/20 text-severity-low';
}

export function RiskMatrix({ risks, onCellClick }: RiskMatrixProps) {
  const matrix = useMemo(() => {
    const grid: Record<string, Risk[]> = {};
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        grid[`${p}-${i}`] = [];
      }
    }
    risks.forEach((r) => {
      const key = `${r.probability}-${r.impact}`;
      if (grid[key]) grid[key].push(r);
    });
    return grid;
  }, [risks]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Matrice de risques</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <div className="relative">
            {/* Y axis label */}
            <div className="absolute -left-2 top-1/2 -translate-x-full -translate-y-1/2 -rotate-90 text-xs font-medium text-muted-foreground whitespace-nowrap">
              Probabilite
            </div>

            <div className="ml-8">
              {/* Grid */}
              <div className="grid grid-cols-5 gap-1">
                {[5, 4, 3, 2, 1].map((prob) =>
                  [1, 2, 3, 4, 5].map((impact) => {
                    const key = `${prob}-${impact}`;
                    const cellRisks = matrix[key] || [];
                    return (
                      <Tooltip key={key}>
                        <TooltipTrigger asChild>
                          <button
                            className={cn(
                              'flex h-12 items-center justify-center rounded text-sm font-bold transition-transform hover:scale-105',
                              getCellColor(prob, impact),
                              cellRisks.length > 0 && 'cursor-pointer'
                            )}
                            onClick={() => onCellClick?.(prob, impact)}
                          >
                            {cellRisks.length > 0 ? cellRisks.length : ''}
                          </button>
                        </TooltipTrigger>
                        {cellRisks.length > 0 && (
                          <TooltipContent className="max-w-[300px]">
                            <p className="font-semibold">{cellRisks.length} risque(s)</p>
                            {cellRisks.slice(0, 3).map((r) => (
                              <p key={r.id} className="text-xs">{r.title}</p>
                            ))}
                            {cellRisks.length > 3 && (
                              <p className="text-xs text-muted-foreground">+{cellRisks.length - 3} de plus</p>
                            )}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })
                )}
              </div>

              {/* X axis labels */}
              <div className="mt-1 grid grid-cols-5 gap-1">
                {RISK_MATRIX_LABELS.impact.map((label) => (
                  <p key={label} className="text-center text-[10px] text-muted-foreground">{label}</p>
                ))}
              </div>
              <p className="mt-1 text-center text-xs font-medium text-muted-foreground">Impact</p>
            </div>

            {/* Y axis labels */}
            <div className="absolute left-0 top-0 flex h-full flex-col justify-between py-1">
              {[...RISK_MATRIX_LABELS.probability].reverse().map((label) => (
                <p key={label} className="text-[10px] leading-[48px] text-muted-foreground">{label.charAt(0)}</p>
              ))}
            </div>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

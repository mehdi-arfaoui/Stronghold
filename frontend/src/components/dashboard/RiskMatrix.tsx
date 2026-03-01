import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { normalizeLanguage } from '@/i18n/locales';
import { cn } from '@/lib/utils';
import { RISK_MATRIX_LABELS } from '@/lib/constants';
import { truncateRiskTitle, type RiskCellFilter } from '@/lib/riskAnalysis';
import type { Risk } from '@/types/risks.types';

interface RiskMatrixProps {
  risks: Risk[];
  onCellClick?: (probability: number, impact: number) => void;
  activeCell?: RiskCellFilter | null;
}

const COPY = {
  fr: { title: 'Matrice de risques', probability: 'Probabilité', impact: 'Impact', risks: 'risque(s)', andMore: '... et {{count}} autre(s)' },
  en: { title: 'Risk matrix', probability: 'Probability', impact: 'Impact', risks: 'risk(s)', andMore: '... and {{count}} more' },
  es: { title: 'Matriz de riesgos', probability: 'Probabilidad', impact: 'Impacto', risks: 'riesgo(s)', andMore: '... y {{count}} más' },
  it: { title: 'Matrice dei rischi', probability: 'Probabilità', impact: 'Impatto', risks: 'rischio/i', andMore: '... e altri {{count}}' },
  zh: { title: '风险矩阵', probability: '概率', impact: '影响', risks: '个风险', andMore: '... 以及另外 {{count}} 个' },
} as const;

function getCellColor(probability: number, impact: number): string {
  const score = probability * impact;
  if (score >= 16) return 'bg-severity-critical/80 text-white';
  if (score >= 10) return 'bg-severity-high/80 text-white';
  if (score >= 5) return 'bg-severity-medium/80 text-white';
  return 'bg-severity-low/20 text-severity-low';
}

export function RiskMatrix({ risks, onCellClick, activeCell = null }: RiskMatrixProps) {
  const { i18n } = useTranslation();
  const copy = COPY[normalizeLanguage(i18n.resolvedLanguage)];
  const matrix = useMemo(() => {
    const grid: Record<string, Risk[]> = {};
    for (let probability = 1; probability <= 5; probability += 1) {
      for (let impact = 1; impact <= 5; impact += 1) {
        grid[`${probability}-${impact}`] = [];
      }
    }
    risks.forEach((risk) => {
      const key = `${risk.probability}-${risk.impact}`;
      if (grid[key]) {
        grid[key].push(risk);
      }
    });
    return grid;
  }, [risks]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{copy.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <div className="relative">
            <div className="absolute -left-2 top-1/2 -translate-x-full -translate-y-1/2 -rotate-90 whitespace-nowrap text-xs font-medium text-muted-foreground">
              {copy.probability}
            </div>

            <div className="ml-8">
              <div className="grid grid-cols-5 gap-1">
                {[5, 4, 3, 2, 1].map((probability) =>
                  [1, 2, 3, 4, 5].map((impact) => {
                    const key = `${probability}-${impact}`;
                    const cellRisks = matrix[key] || [];

                    return (
                      <Tooltip key={key}>
                        <TooltipTrigger asChild>
                          <button
                            className={cn(
                              'flex h-12 items-center justify-center rounded border text-sm font-bold transition-transform hover:scale-105',
                              getCellColor(probability, impact),
                              cellRisks.length > 0 && 'cursor-pointer',
                              activeCell?.probability === probability &&
                                activeCell?.impact === impact &&
                                'ring-2 ring-primary ring-offset-2',
                            )}
                            onClick={() => onCellClick?.(probability, impact)}
                          >
                            {cellRisks.length > 0 ? cellRisks.length : ''}
                          </button>
                        </TooltipTrigger>
                        {cellRisks.length > 0 && (
                          <TooltipContent className="max-w-[320px] space-y-1">
                            <p className="font-semibold">
                              {cellRisks.length} {copy.risks} ({copy.impact}: {impact}, {copy.probability}: {probability})
                            </p>
                            {cellRisks.slice(0, 5).map((risk) => (
                              <p key={risk.id} className="text-xs">
                                • {truncateRiskTitle(risk.title)}
                              </p>
                            ))}
                            {cellRisks.length > 5 && (
                              <p className="text-xs text-muted-foreground">
                                {copy.andMore.replace('{{count}}', String(cellRisks.length - 5))}
                              </p>
                            )}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  }),
                )}
              </div>

              <div className="mt-1 grid grid-cols-5 gap-1">
                {RISK_MATRIX_LABELS.impact.map((label) => (
                  <p key={label} className="text-center text-[10px] text-muted-foreground">
                    {label}
                  </p>
                ))}
              </div>
              <p className="mt-1 text-center text-xs font-medium text-muted-foreground">{copy.impact}</p>
            </div>

            <div className="absolute left-0 top-0 flex h-full flex-col justify-between py-1">
              {[...RISK_MATRIX_LABELS.probability].reverse().map((label) => (
                <p key={label} className="text-[10px] leading-[48px] text-muted-foreground">
                  {label.charAt(0)}
                </p>
              ))}
            </div>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

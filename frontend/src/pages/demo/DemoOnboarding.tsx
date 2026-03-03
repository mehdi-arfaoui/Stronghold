import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2,
  Code2,
  DatabaseZap,
  Factory,
  HeartPulse,
  Landmark,
  Loader2,
  Rocket,
  ShoppingCart,
  Truck,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { seedDemo, type DemoOnboardingResponse } from './demo.api';
import {
  DEFAULT_DEMO_PROFILE,
  DEMO_COMPANY_SIZE_DEFINITIONS,
  DEMO_PROFILE_MATRIX,
  DEMO_SECTOR_DEFINITIONS,
  type DemoCompanySizeKey,
  type DemoFinancialFieldKey,
  type DemoSectorKey,
} from './demo-profiles';

type DemoStep = 1 | 2 | 3;
type DemoFieldSource = 'suggested' | 'user_input';
type DemoFinancialValues = Record<DemoFinancialFieldKey, string>;
type DemoFieldSources = Record<DemoFinancialFieldKey, DemoFieldSource>;

export interface DemoOnboardingProps {
  step: DemoStep;
  onStepChange: (step: DemoStep) => void;
  onCompletedChange: (completed: boolean) => void;
}

const DEMO_FINANCIAL_FIELDS: DemoFinancialFieldKey[] = [
  'annualRevenue',
  'employeeCount',
  'annualITBudget',
  'drBudgetPercent',
  'hourlyDowntimeCost',
];

const DEMO_SECTOR_ICON_BY_KEY: Record<DemoSectorKey, LucideIcon> = {
  ecommerce: ShoppingCart,
  finance: Landmark,
  healthcare: HeartPulse,
  manufacturing: Factory,
  it_saas: Code2,
  transport: Truck,
  energy: Zap,
  public: Building2,
};

const DEMO_FINANCIAL_LABELS: Record<DemoFinancialFieldKey, string> = {
  annualRevenue: "Chiffre d'affaires annuel (EUR)",
  employeeCount: "Nombre d'employes",
  annualITBudget: 'Budget IT annuel (EUR)',
  drBudgetPercent: '% budget DR',
  hourlyDowntimeCost: "Cout estime d'indisponibilite (EUR/h)",
};

function toPositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatMoneyCompact(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(safeValue);
}

function parseApiError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { error?: string; message?: string } } }).response?.data;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
  }
  return fallback;
}

function getDefaultDemoFinancialValues(
  sector: DemoSectorKey,
  companySize: DemoCompanySizeKey,
): DemoFinancialValues {
  const matrix = DEMO_PROFILE_MATRIX[sector][companySize];
  return {
    annualRevenue: String(matrix.annualRevenue),
    employeeCount: String(matrix.employeeCount),
    annualITBudget: String(matrix.annualITBudget),
    drBudgetPercent: String(matrix.drBudgetPercent),
    hourlyDowntimeCost: String(matrix.hourlyDowntimeCost),
  };
}

function applyDemoFinancialSuggestions(input: {
  sector: DemoSectorKey;
  companySize: DemoCompanySizeKey;
  values: DemoFinancialValues;
  sources: DemoFieldSources;
}): {
  values: DemoFinancialValues;
  sources: DemoFieldSources;
} {
  const defaults = getDefaultDemoFinancialValues(input.sector, input.companySize);
  const nextValues: DemoFinancialValues = { ...input.values };
  const nextSources: DemoFieldSources = { ...input.sources };

  for (const field of DEMO_FINANCIAL_FIELDS) {
    if (input.sources[field] === 'user_input') continue;
    nextValues[field] = defaults[field];
    nextSources[field] = 'suggested';
  }

  return {
    values: nextValues,
    sources: nextSources,
  };
}

function buildSuggestedFieldSources(): DemoFieldSources {
  return {
    annualRevenue: 'suggested',
    employeeCount: 'suggested',
    annualITBudget: 'suggested',
    drBudgetPercent: 'suggested',
    hourlyDowntimeCost: 'suggested',
  };
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

export default function DemoOnboarding({
  step,
  onStepChange,
  onCompletedChange,
}: DemoOnboardingProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [demoSector, setDemoSector] = useState<DemoSectorKey>(DEFAULT_DEMO_PROFILE.sector);
  const [demoCompanySize, setDemoCompanySize] = useState<DemoCompanySizeKey>(
    DEFAULT_DEMO_PROFILE.companySize,
  );
  const [demoFinancialValues, setDemoFinancialValues] = useState<DemoFinancialValues>(() =>
    getDefaultDemoFinancialValues(DEFAULT_DEMO_PROFILE.sector, DEFAULT_DEMO_PROFILE.companySize),
  );
  const [demoFieldSources, setDemoFieldSources] = useState<DemoFieldSources>(() =>
    buildSuggestedFieldSources(),
  );
  const [demoSummary, setDemoSummary] = useState<DemoOnboardingResponse | null>(null);

  const seedDemoMutation = useMutation({
    mutationFn: () => {
      const financialOverrides = Object.fromEntries(
        DEMO_FINANCIAL_FIELDS.flatMap((field) => {
          if (demoFieldSources[field] !== 'user_input') return [];
          const value = toPositiveNumber(demoFinancialValues[field]);
          if (value == null) return [];
          return [[field, value]];
        }),
      ) as Partial<Record<DemoFinancialFieldKey, number>>;

      return seedDemo({
        sector: demoSector,
        companySize: demoCompanySize,
        ...(Object.keys(financialOverrides).length > 0 ? { financialOverrides } : {}),
      });
    },
    onMutate: () => {
      setDemoSummary(null);
      onCompletedChange(false);
      onStepChange(2);
    },
    onSuccess: async (res) => {
      setDemoSummary(res.data);
      onCompletedChange(true);
      onStepChange(3);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['graph'] }),
        queryClient.invalidateQueries({ queryKey: ['financial-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['simulations'] }),
        queryClient.invalidateQueries({ queryKey: ['incidents'] }),
      ]);
      toast.success('Demo onboarding completed');
      navigate('/discovery');
    },
    onError: (error) => {
      toast.error(parseApiError(error, 'Unable to load demo onboarding'));
      onCompletedChange(false);
      onStepChange(2);
    },
  });

  const selectedSectorDefinition =
    DEMO_SECTOR_DEFINITIONS.find((item) => item.key === demoSector) ??
    DEMO_SECTOR_DEFINITIONS[0];
  const selectedSizeDefinition =
    DEMO_COMPANY_SIZE_DEFINITIONS.find((item) => item.key === demoCompanySize) ??
    DEMO_COMPANY_SIZE_DEFINITIONS[0];

  const parsedAnnualRevenue = toPositiveNumber(demoFinancialValues.annualRevenue) ?? 0;
  const parsedDowntimeCost = toPositiveNumber(demoFinancialValues.hourlyDowntimeCost) ?? 0;

  const demoLaunchSummary = `Profil: ${selectedSizeDefinition?.label ?? ''} ${
    selectedSectorDefinition?.label ?? ''
  } - CA ${formatMoneyCompact(parsedAnnualRevenue)} - Cout indisponibilite ${formatMoneyCompact(parsedDowntimeCost)}/h`;

  const handleDemoProfileDimensionChange = (next: {
    sector?: DemoSectorKey;
    companySize?: DemoCompanySizeKey;
  }) => {
    const nextSector = next.sector ?? demoSector;
    const nextCompanySize = next.companySize ?? demoCompanySize;
    const applied = applyDemoFinancialSuggestions({
      sector: nextSector,
      companySize: nextCompanySize,
      values: demoFinancialValues,
      sources: demoFieldSources,
    });
    setDemoSector(nextSector);
    setDemoCompanySize(nextCompanySize);
    setDemoFinancialValues(applied.values);
    setDemoFieldSources(applied.sources);
  };

  const handleDemoFinancialFieldChange = (field: DemoFinancialFieldKey, nextValue: string) => {
    setDemoFinancialValues((previous) => ({
      ...previous,
      [field]: nextValue,
    }));
    setDemoFieldSources((previous) => ({
      ...previous,
      [field]: 'user_input',
    }));
  };

  const renderDemoProfileConfig = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <DatabaseZap className="h-5 w-5 text-primary" />
            Profil entreprise pour la demo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Secteur d activite</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {DEMO_SECTOR_DEFINITIONS.map((sector) => {
                const Icon = DEMO_SECTOR_ICON_BY_KEY[sector.key];
                const isActive = demoSector === sector.key;
                return (
                  <button
                    key={sector.key}
                    type="button"
                    className={cn(
                      'rounded-lg border p-3 text-left transition-all',
                      isActive ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/40',
                    )}
                    onClick={() => handleDemoProfileDimensionChange({ sector: sector.key })}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Secteur
                      </span>
                    </div>
                    <p className="text-sm font-medium leading-tight">{sector.label}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Taille de l entreprise</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {DEMO_COMPANY_SIZE_DEFINITIONS.map((size) => {
                const isActive = demoCompanySize === size.key;
                return (
                  <button
                    key={size.key}
                    type="button"
                    className={cn(
                      'rounded-lg border p-3 text-left transition-all',
                      isActive ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/40',
                    )}
                    onClick={() => handleDemoProfileDimensionChange({ companySize: size.key })}
                  >
                    <p className="text-sm font-medium leading-tight">{size.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{size.employeeRangeLabel} employes</p>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profil financier (modifiable)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {DEMO_FINANCIAL_FIELDS.map((field) => (
            <div key={field} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label>{DEMO_FINANCIAL_LABELS[field]}</Label>
                {demoFieldSources[field] === 'suggested' ? (
                  <Badge variant="outline">Suggestion</Badge>
                ) : (
                  <Badge variant="secondary">Valeur personnalisee</Badge>
                )}
              </div>
              <Input
                type="number"
                min={0}
                value={demoFinancialValues[field]}
                onChange={(event) => handleDemoFinancialFieldChange(field, event.target.value)}
                className={demoFieldSources[field] === 'suggested' ? 'text-muted-foreground' : undefined}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-6">
          <p className="text-sm font-medium">{demoLaunchSummary}</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            onCompletedChange(false);
            onStepChange(1);
          }}
          disabled={seedDemoMutation.isPending}
        >
          Retour
        </Button>
        <Button onClick={() => seedDemoMutation.mutate()} disabled={seedDemoMutation.isPending}>
          {seedDemoMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Rocket className="mr-2 h-4 w-4" />
          )}
          {seedDemoMutation.isPending ? 'Execution...' : 'Lancer la demo'}
        </Button>
      </div>
    </div>
  );

  const renderDemoSummary = () => {
    if (!demoSummary) return null;

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Demo onboarding completed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {demoSummary.demoProfile ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  {demoSummary.demoProfile.companySizeLabel} - {demoSummary.demoProfile.sectorLabel}
                </p>
                <p className="text-muted-foreground">
                  CA {formatMoneyCompact(demoSummary.demoProfile.annualRevenue)} - indisponibilite{' '}
                  {formatMoneyCompact(demoSummary.demoProfile.hourlyDowntimeCost)}/h
                </p>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryTile label="Nodes" value={String(demoSummary.nodes)} />
              <SummaryTile label="Edges" value={String(demoSummary.totalEdges)} />
              <SummaryTile label="BIA" value={String(demoSummary.biaProcesses)} />
              <SummaryTile label="Risks" value={String(demoSummary.risksDetected)} />
              <SummaryTile label="Incidents" value={String(demoSummary.incidentsSeeded)} />
              <SummaryTile label="Simulations" value={String(demoSummary.simulationsSeeded)} />
              <SummaryTile label="Runbooks" value={String(demoSummary.runbooksSeeded)} />
              <SummaryTile label="PRA exercises" value={String(demoSummary.praExercisesSeeded)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {demoSummary.pipeline.map((pipelineStep) => (
              <div key={pipelineStep.step} className="flex items-center justify-between rounded border px-3 py-2">
                <span className="font-mono text-xs">{pipelineStep.step}</span>
                <span
                  className={cn(
                    'text-xs',
                    pipelineStep.status === 'completed' ? 'text-resilience-high' : 'text-severity-critical',
                  )}
                >
                  {pipelineStep.status} - {pipelineStep.durationMs} ms
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Total duration: {demoSummary.durationMs} ms / Budget: {demoSummary.performanceBudgetMs} ms (
              {demoSummary.withinPerformanceBudget ? 'OK' : 'EXCEEDED'})
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate('/discovery')}>Open Discovery</Button>
          <Button variant="outline" onClick={() => navigate('/finance')}>
            Open Finance
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onCompletedChange(false);
              onStepChange(1);
            }}
          >
            Restart onboarding
          </Button>
        </div>
      </div>
    );
  };

  if (step === 2) {
    return renderDemoProfileConfig();
  }

  if (step === 3) {
    return renderDemoSummary();
  }

  return null;
}

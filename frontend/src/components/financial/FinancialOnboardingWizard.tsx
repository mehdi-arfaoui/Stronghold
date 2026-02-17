import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CircleDollarSign, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { financialApi, type OrganizationFinancialProfile } from '@/api/financial.api';
import { invalidateFinancialProfileDependentQueries } from '@/lib/financialQueryInvalidation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type WizardStep = 1 | 2 | 3;
type DowntimeMode = 'estimate_market' | 'known' | 'later';

const SIZE_OPTIONS = [
  { value: 'startup', label: 'Startup' },
  { value: 'smb', label: 'PME' },
  { value: 'midMarket', label: 'ETI' },
  { value: 'enterprise', label: 'Grande entreprise' },
  { value: 'largeEnterprise', label: 'Tres grande entreprise' },
] as const;

const VERTICAL_OPTIONS = [
  { value: '', label: 'Non precise' },
  { value: 'banking_finance', label: 'Banque / Finance' },
  { value: 'healthcare', label: 'Sante' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'retail_ecommerce', label: 'Retail / eCommerce' },
  { value: 'technology_saas', label: 'Technologie / SaaS' },
  { value: 'media_telecom', label: 'Telecom / Media' },
  { value: 'government_public', label: 'Gouvernement / Public' },
  { value: 'other', label: 'Autre' },
] as const;

const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP', 'CHF'] as const;

type BenchmarksResponse = {
  downtime: {
    enterprise: {
      label: string;
      perHourUSD: { p25: number; median: number; p75: number; p95: number };
      source: string;
    };
    midMarket: {
      label: string;
      perHourUSD: { p25: number; median: number; p75: number; p95: number };
      source: string;
    };
    smb: {
      label: string;
      perHourUSD: { p25: number; median: number; p75: number; p95: number };
      source: string;
    };
    byVertical: Record<string, { perHourUSD: number; source: string; notes?: string | null }>;
  };
};

type RatesResponse = {
  base: string;
  rates: Record<string, number>;
  source: string;
  cachedAt: string;
};

interface FinancialOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProfile?: OrganizationFinancialProfile;
  onCompleted?: () => void;
}

function formatMoneyCompact(value: number, currency: string): string {
  const suffix = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : 'CHF';
  if (!Number.isFinite(value)) return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(0);
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value / 1_000_000)}M${suffix}`;
  }
  if (absValue >= 1_000) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value / 1_000)}K${suffix}`;
  }
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function mapSizeToBenchmarkKey(sizeCategory: string): 'enterprise' | 'midMarket' | 'smb' {
  if (sizeCategory === 'enterprise' || sizeCategory === 'largeEnterprise') return 'enterprise';
  if (sizeCategory === 'midMarket') return 'midMarket';
  return 'smb';
}

function resolveRatesMap(input?: RatesResponse): Record<string, number> {
  if (input?.rates) return input.rates;
  return { USD: 1, EUR: 0.92, GBP: 0.79, CHF: 0.88 };
}

function extractSourceNames(sourceText: string): string[] {
  if (!sourceText) return [];
  const known = [
    'ITIC 2024',
    'EMA Research 2024',
    'Gartner 2024',
    'CloudSecureTech 2025',
    'New Relic 2025',
    'Uptime Institute 2025',
    'IBM 2024',
    'Siemens 2024',
  ];

  const hits = known.filter((item) => sourceText.toLowerCase().includes(item.toLowerCase()));
  if (hits.length > 0) return hits;
  return [sourceText];
}

export function FinancialOnboardingWizard({
  open,
  onOpenChange,
  initialProfile,
  onCompleted,
}: FinancialOnboardingWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(1);
  const [sizeCategory, setSizeCategory] = useState('midMarket');
  const [verticalSector, setVerticalSector] = useState('');
  const [employeeCount, setEmployeeCount] = useState('');
  const [annualRevenueDisplay, setAnnualRevenueDisplay] = useState('');
  const [persistRevenue, setPersistRevenue] = useState(false);
  const [downtimeMode, setDowntimeMode] = useState<DowntimeMode>('estimate_market');
  const [knownDowntimeDisplay, setKnownDowntimeDisplay] = useState('');
  const [currency, setCurrency] = useState<string>('EUR');

  const benchmarksQuery = useQuery({
    queryKey: ['financial-benchmarks'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => (await financialApi.getBenchmarks()).data as BenchmarksResponse,
  });

  const usdRatesQuery = useQuery({
    queryKey: ['currency-rates-usd'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => (await api.get<RatesResponse>('/currency/rates', { params: { base: 'USD' } })).data,
  });

  const ratesMap = useMemo(() => resolveRatesMap(usdRatesQuery.data), [usdRatesQuery.data]);
  const toDisplayCurrency = (usdAmount: number) => usdAmount * (ratesMap[currency] ?? 1);
  const toUSD = (displayAmount: number) => {
    const rate = ratesMap[currency] ?? 1;
    if (!Number.isFinite(rate) || rate <= 0) return displayAmount;
    return displayAmount / rate;
  };

  useEffect(() => {
    if (!open) return;
    const effectiveCurrency = initialProfile?.customCurrency || 'EUR';
    const effectiveDowntimeUSD = initialProfile?.customDowntimeCostPerHour ?? null;

    setStep(1);
    setSizeCategory(initialProfile?.sizeCategory || 'midMarket');
    setVerticalSector(initialProfile?.verticalSector || '');
    setEmployeeCount(initialProfile?.employeeCount != null ? String(initialProfile.employeeCount) : '');
    setAnnualRevenueDisplay(
      initialProfile?.annualRevenueUSD != null ? String(Math.round(initialProfile.annualRevenueUSD)) : '',
    );
    setPersistRevenue(initialProfile?.annualRevenueUSD != null);
    setCurrency(effectiveCurrency);

    if (effectiveDowntimeUSD && effectiveDowntimeUSD > 0) {
      setDowntimeMode('known');
      const displayAmount = Math.round(effectiveDowntimeUSD * (ratesMap[effectiveCurrency] ?? 1));
      setKnownDowntimeDisplay(String(displayAmount));
    } else {
      setDowntimeMode('estimate_market');
      setKnownDowntimeDisplay('');
    }
  }, [open, initialProfile, ratesMap]);

  const benchmarkPreview = useMemo(() => {
    const downtime = benchmarksQuery.data?.downtime;
    if (!downtime) {
      return {
        minUSD: 100_000,
        maxUSD: 1_000_000,
        recommendedUSD: 300_000,
        sourceNames: ['Stronghold estimate'],
      };
    }

    const sizeKey = mapSizeToBenchmarkKey(sizeCategory);
    const sizeData = downtime[sizeKey].perHourUSD;
    const sizeSourceNames = extractSourceNames(downtime[sizeKey].source);

    const verticalData = verticalSector ? downtime.byVertical[verticalSector] : undefined;
    const verticalSourceNames = verticalData ? extractSourceNames(verticalData.source) : [];

    const minUSD = sizeData.median;
    const maxUSD = Math.max(sizeData.p95, verticalData?.perHourUSD ?? 0);
    const recommendedUSD = verticalData
      ? Math.round((sizeData.median + verticalData.perHourUSD) / 2)
      : sizeData.median;

    const sourceNames = Array.from(new Set([...sizeSourceNames, ...verticalSourceNames]));

    return {
      minUSD,
      maxUSD,
      recommendedUSD,
      sourceNames: sourceNames.length > 0 ? sourceNames : ['Stronghold estimate'],
    };
  }, [benchmarksQuery.data, sizeCategory, verticalSector]);

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const knownDisplayAmount = Number(knownDowntimeDisplay || 0);
      const knownDowntimeUSD = knownDisplayAmount > 0 ? toUSD(knownDisplayAmount) : null;
      const estimatedDowntimeUSD = benchmarkPreview.recommendedUSD;
      const annualRevenueInput = Number(annualRevenueDisplay || 0);

      const payload = {
        sizeCategory,
        verticalSector: !verticalSector || verticalSector === 'other' ? null : verticalSector,
        employeeCount: employeeCount ? Number(employeeCount) : null,
        annualRevenueUSD:
          persistRevenue && annualRevenueInput > 0 ? Math.round(toUSD(annualRevenueInput)) : null,
        customDowntimeCostPerHour:
          downtimeMode === 'known' && knownDowntimeUSD && knownDowntimeUSD > 0
            ? knownDowntimeUSD
            : estimatedDowntimeUSD,
        customCurrency: currency,
      };

      return financialApi.updateOrgProfile(payload);
    },
    onSuccess: async () => {
      await invalidateFinancialProfileDependentQueries(queryClient);
      toast.success('Profil financier configure');
      onOpenChange(false);
      onCompleted?.();
    },
    onError: () => {
      toast.error('Impossible de sauvegarder le profil financier');
    },
  });

  const canGoNextStep1 = Boolean(sizeCategory);
  const canGoNextStep2 = downtimeMode !== 'known' || Number(knownDowntimeDisplay) > 0;
  const canSave = !updateProfileMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assistant de configuration financiere</DialogTitle>
          <DialogDescription>
            Etape {step} / 3 - Configurez votre profil organisation pour fiabiliser les estimations de risque et de ROI.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Votre organisation
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Taille</label>
                <select
                  value={sizeCategory}
                  onChange={(event) => setSizeCategory(event.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {SIZE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Secteur</label>
                <select
                  value={verticalSector}
                  onChange={(event) => setVerticalSector(event.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {VERTICAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Nombre d employes (optionnel)</label>
                <Input
                  type="number"
                  min={0}
                  value={employeeCount}
                  onChange={(event) => setEmployeeCount(event.target.value)}
                  placeholder="Ex: 450"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">
                  CA annuel ({currency}) (optionnel)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={annualRevenueDisplay}
                  onChange={(event) => setAnnualRevenueDisplay(event.target.value)}
                  placeholder="Ex: 80000000"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={persistRevenue}
                onChange={(event) => setPersistRevenue(event.target.checked)}
              />
              Utiliser le CA pour les estimations (si decoche, le CA n est pas sauvegarde).
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-primary" />
                Couts de downtime
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Pour votre profil, le cout moyen de downtime est estime entre{' '}
                <span className="font-medium">
                  {formatMoneyCompact(toDisplayCurrency(benchmarkPreview.minUSD), currency)}
                </span>{' '}
                et{' '}
                <span className="font-medium">
                  {formatMoneyCompact(toDisplayCurrency(benchmarkPreview.maxUSD), currency)}
                </span>
                /h (sources : {benchmarkPreview.sourceNames.join(', ')}).
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="radio"
                  checked={downtimeMode === 'estimate_market'}
                  onChange={() => setDowntimeMode('estimate_market')}
                />
                <span>J'utilise l'estimation du marché</span>
              </label>
              <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="radio"
                  checked={downtimeMode === 'known'}
                  onChange={() => setDowntimeMode('known')}
                />
                <span>Je connais mon coût</span>
              </label>
              <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="radio"
                  checked={downtimeMode === 'later'}
                  onChange={() => setDowntimeMode('later')}
                />
                <span>Je définirai plus tard</span>
              </label>
            </div>

            {downtimeMode === 'known' && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Cout horaire connu ({currency}/h)</label>
                <Input
                  type="number"
                  min={0}
                  value={knownDowntimeDisplay}
                  onChange={(event) => setKnownDowntimeDisplay(event.target.value)}
                  placeholder="Ex: 350000"
                />
              </div>
            )}

            {downtimeMode !== 'known' && (
              <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                Valeur appliquee automatiquement: {formatMoneyCompact(toDisplayCurrency(benchmarkPreview.recommendedUSD), currency)}/h
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                Devise
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les conversions sont basees sur les taux de change en vigueur.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Devise de restitution</label>
              <select
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {CURRENCY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => (step > 1 ? setStep((step - 1) as WizardStep) : onOpenChange(false))}
          >
            {step > 1 ? 'Retour' : 'Fermer'}
          </Button>

          {step < 3 ? (
            <Button
              onClick={() => setStep((step + 1) as WizardStep)}
              disabled={(step === 1 && !canGoNextStep1) || (step === 2 && !canGoNextStep2)}
            >
              Continuer
            </Button>
          ) : (
            <Button onClick={() => updateProfileMutation.mutate()} disabled={!canSave}>
              {updateProfileMutation.isPending ? 'Sauvegarde...' : 'Terminer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

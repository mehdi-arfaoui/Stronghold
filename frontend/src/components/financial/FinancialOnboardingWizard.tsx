import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, CircleDollarSign, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { financialApi, type OrganizationFinancialProfile } from '@/api/financial.api';
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
type DowntimeMode = 'known' | 'estimate' | 'unsure';

const SIZE_OPTIONS = [
  { value: 'startup', label: 'Startup' },
  { value: 'smb', label: 'PME' },
  { value: 'midMarket', label: 'ETI' },
  { value: 'enterprise', label: 'Grande entreprise' },
  { value: 'largeEnterprise', label: 'Tres grande entreprise' },
] as const;

const VERTICAL_OPTIONS = [
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
    byVertical: Record<string, { perHourUSD: number; source: string; notes?: string }>;
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

function formatMoney(value: number, currency: string): string {
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

export function FinancialOnboardingWizard({
  open,
  onOpenChange,
  initialProfile,
  onCompleted,
}: FinancialOnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [sizeCategory, setSizeCategory] = useState('midMarket');
  const [verticalSector, setVerticalSector] = useState('technology_saas');
  const [employeeCount, setEmployeeCount] = useState('');
  const [annualRevenueDisplay, setAnnualRevenueDisplay] = useState('');
  const [persistRevenue, setPersistRevenue] = useState(true);
  const [downtimeMode, setDowntimeMode] = useState<DowntimeMode>('estimate');
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
    setVerticalSector(initialProfile?.verticalSector || 'technology_saas');
    setEmployeeCount(initialProfile?.employeeCount != null ? String(initialProfile.employeeCount) : '');
    setAnnualRevenueDisplay(initialProfile?.annualRevenueUSD != null ? String(Math.round(initialProfile.annualRevenueUSD)) : '');
    setPersistRevenue(initialProfile?.annualRevenueUSD != null);
    setCurrency(effectiveCurrency);

    if (effectiveDowntimeUSD && effectiveDowntimeUSD > 0) {
      setDowntimeMode('known');
      const displayAmount = Math.round(effectiveDowntimeUSD * (ratesMap[effectiveCurrency] ?? 1));
      setKnownDowntimeDisplay(String(displayAmount));
    } else {
      setDowntimeMode('estimate');
      setKnownDowntimeDisplay('');
    }
  }, [open, initialProfile, ratesMap]);

  const benchmarkPreview = useMemo(() => {
    const downtime = benchmarksQuery.data?.downtime;
    if (!downtime) {
      return {
        minUSD: 50_000,
        maxUSD: 300_000,
        recommendedUSD: 120_000,
        source: 'Stronghold estimate',
        verticalSource: null as string | null,
      };
    }

    const sizeKey = mapSizeToBenchmarkKey(sizeCategory);
    const sizeData = downtime[sizeKey].perHourUSD;
    const sizeSource = downtime[sizeKey].source;

    const verticalData = verticalSector ? downtime.byVertical[verticalSector] : undefined;
    const minUSD = sizeData.p25;
    const maxUSD = verticalData ? Math.max(sizeData.p95, verticalData.perHourUSD) : sizeData.p95;
    const recommendedUSD = Math.round((minUSD + maxUSD) / 2);

    return {
      minUSD,
      maxUSD,
      recommendedUSD,
      source: sizeSource,
      verticalSource: verticalData?.source ?? null,
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
        verticalSector: verticalSector === 'other' ? null : verticalSector,
        employeeCount: employeeCount ? Number(employeeCount) : null,
        annualRevenueUSD:
          persistRevenue && annualRevenueInput > 0 ? Math.round(toUSD(annualRevenueInput)) : null,
        customDowntimeCostPerHour:
          downtimeMode === 'known'
            ? knownDowntimeUSD
            : estimatedDowntimeUSD,
        customCurrency: currency,
      };

      return financialApi.updateOrgProfile(payload);
    },
    onSuccess: () => {
      toast.success('Profil financier configure');
      onOpenChange(false);
      onCompleted?.();
    },
    onError: () => {
      toast.error('Impossible de sauvegarder le profil financier');
    },
  });

  const canGoNextStep1 = Boolean(sizeCategory && verticalSector);
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
                Cout de downtime
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Pour ce profil, benchmark estime entre{' '}
                <span className="font-medium">
                  {formatMoney(toDisplayCurrency(benchmarkPreview.minUSD), currency)}
                </span>{' '}
                et{' '}
                <span className="font-medium">
                  {formatMoney(toDisplayCurrency(benchmarkPreview.maxUSD), currency)}
                </span>{' '}
                par heure.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Source taille: {benchmarkPreview.source}
                {benchmarkPreview.verticalSource ? ` - Source secteur: ${benchmarkPreview.verticalSource}` : ''}
              </p>
            </div>

            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setDowntimeMode('known')}
                className={`rounded-md border px-3 py-2 text-left text-sm ${downtimeMode === 'known' ? 'border-primary bg-primary/5' : ''}`}
              >
                Oui, je connais mon cout de downtime horaire
              </button>
              <button
                type="button"
                onClick={() => setDowntimeMode('estimate')}
                className={`rounded-md border px-3 py-2 text-left text-sm ${downtimeMode === 'estimate' ? 'border-primary bg-primary/5' : ''}`}
              >
                Non, utiliser l estimation benchmark
              </button>
              <button
                type="button"
                onClick={() => setDowntimeMode('unsure')}
                className={`rounded-md border px-3 py-2 text-left text-sm ${downtimeMode === 'unsure' ? 'border-primary bg-primary/5' : ''}`}
              >
                Je ne suis pas sur, utiliser l estimation avec avertissement
              </button>
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
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                <div className="flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Estimation basee sur donnees publiques. Ajustez ensuite avec vos chiffres metier.
                </div>
                <p className="mt-1">
                  Valeur appliquee: {formatMoney(toDisplayCurrency(benchmarkPreview.recommendedUSD), currency)} /h
                </p>
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
          <Button variant="ghost" onClick={() => (step > 1 ? setStep((step - 1) as WizardStep) : onOpenChange(false))}>
            {step > 1 ? 'Retour' : 'Annuler'}
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

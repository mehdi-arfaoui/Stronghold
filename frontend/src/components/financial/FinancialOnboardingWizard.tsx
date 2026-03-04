import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CircleDollarSign, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { financialApi, type OrganizationFinancialProfile } from '@/api/financial.api';
import { discoveryApi } from '@/api/discovery.api';
import { biaApi } from '@/api/bia.api';
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

const SIZE_OPTIONS = [
  { value: 'startup', label: 'Startup' },
  { value: 'smb', label: 'PME' },
  { value: 'midMarket', label: 'ETI' },
  { value: 'enterprise', label: 'Grande entreprise' },
  { value: 'largeEnterprise', label: 'Très grande entreprise' },
] as const;

const VERTICAL_OPTIONS = [
  { value: '', label: 'Non précisé' },
  { value: 'banking_finance', label: 'Banque / Finance' },
  { value: 'healthcare', label: 'Santé' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'retail_ecommerce', label: 'Retail / eCommerce' },
  { value: 'technology_saas', label: 'Technologie / SaaS' },
  { value: 'media_telecom', label: 'Télécom / Media' },
  { value: 'government_public', label: 'Gouvernement / Public' },
  { value: 'other', label: 'Autre' },
] as const;

const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP', 'CHF'] as const;

const CRITICALITY_TIER_OPTIONS = [
  { value: '', label: 'Global' },
  { value: 'critical', label: 'Critique' },
  { value: 'high', label: 'Élevée' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'low', label: 'Faible' },
] as const;

const DOWNTIME_BENCHMARK_HINTS = [
  'E-commerce: 10 000 - 50 000 EUR/h',
  'Finance/Banque: 50 000 - 500 000 EUR/h',
  'SaaS B2B: 5 000 - 30 000 EUR/h',
  'Santé: 10 000 - 100 000 EUR/h',
  'Manufacturing: 20 000 - 200 000 EUR/h',
  'Media/Streaming: 10 000 - 100 000 EUR/h',
  'PME généraliste: 1 000 - 10 000 EUR/h',
];

interface FinancialOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProfile?: OrganizationFinancialProfile;
  onCompleted?: () => void;
}

type ServiceOverrideDraft = {
  customDowntimeCostPerHour: string;
  customCriticalityTier: '' | 'critical' | 'high' | 'medium' | 'low';
};

const EMPTY_OVERRIDE_DRAFT: ServiceOverrideDraft = {
  customDowntimeCostPerHour: '',
  customCriticalityTier: '',
};

function toNumberOrNull(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function splitConstraints(raw: string): string[] {
  return raw
    .split(/\r?\n|,/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildOverrideDrafts(
  overrides: OrganizationFinancialProfile['serviceOverrides'] | undefined,
): Record<string, ServiceOverrideDraft> {
  const result: Record<string, ServiceOverrideDraft> = {};
  for (const entry of overrides || []) {
    if (!entry?.nodeId) continue;
    result[entry.nodeId] = {
      customDowntimeCostPerHour:
        entry.customDowntimeCostPerHour && entry.customDowntimeCostPerHour > 0
          ? String(entry.customDowntimeCostPerHour)
          : '',
      customCriticalityTier: (entry.customCriticalityTier || '') as ServiceOverrideDraft['customCriticalityTier'],
    };
  }
  return result;
}

function toServiceOverrides(
  drafts: Record<string, ServiceOverrideDraft>,
): NonNullable<OrganizationFinancialProfile['serviceOverrides']> {
  const overrides: NonNullable<OrganizationFinancialProfile['serviceOverrides']> = [];
  for (const [nodeId, draft] of Object.entries(drafts)) {
    const customDowntimeCostPerHour = toNumberOrNull(draft.customDowntimeCostPerHour);
    const customCriticalityTier =
      draft.customCriticalityTier === 'critical' ||
      draft.customCriticalityTier === 'high' ||
      draft.customCriticalityTier === 'medium' ||
      draft.customCriticalityTier === 'low'
        ? draft.customCriticalityTier
        : undefined;
    if (customDowntimeCostPerHour == null && !customCriticalityTier) continue;
    overrides.push({
      nodeId,
      ...(customDowntimeCostPerHour != null ? { customDowntimeCostPerHour } : {}),
      ...(customCriticalityTier ? { customCriticalityTier } : {}),
    });
  }
  return overrides;
}

function describeServiceNode(node: {
  provider?: string;
  type?: string;
  region?: string;
  availabilityZone?: string;
}) {
  const parts = [
    node.provider ? String(node.provider).toUpperCase() : '',
    node.type ? String(node.type).replaceAll('_', ' ') : '',
    node.region || node.availabilityZone || '',
  ].filter(Boolean);
  return parts.join(' - ') || 'Service détecté';
}

function formatDowntimeCost(amount: number | null | undefined, currency: string): string {
  if (!Number.isFinite(amount as number) || Number(amount) <= 0) return '—';
  return `${new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(Number(amount))} ${currency}/h`;
}

export function FinancialOnboardingWizard({
  open,
  onOpenChange,
  initialProfile,
  onCompleted,
}: FinancialOnboardingWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(1);
  const [currency, setCurrency] = useState<string>('EUR');
  const [annualRevenue, setAnnualRevenue] = useState('');
  const [hourlyDowntimeCost, setHourlyDowntimeCost] = useState('');
  const [sizeCategory, setSizeCategory] = useState('midMarket');
  const [verticalSector, setVerticalSector] = useState('');
  const [industrySector, setIndustrySector] = useState('');
  const [employeeCount, setEmployeeCount] = useState('');
  const [annualITBudget, setAnnualITBudget] = useState('');
  const [drBudgetPercent, setDrBudgetPercent] = useState('');
  const [numberOfCustomers, setNumberOfCustomers] = useState('');
  const [criticalStart, setCriticalStart] = useState('');
  const [criticalEnd, setCriticalEnd] = useState('');
  const [criticalTimezone, setCriticalTimezone] = useState('');
  const [regulatoryConstraintsText, setRegulatoryConstraintsText] = useState('');
  const [serviceOverrideDrafts, setServiceOverrideDrafts] = useState<Record<string, ServiceOverrideDraft>>({});

  const graphQuery = useQuery({
    queryKey: ['financial-onboarding-services'],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => (await discoveryApi.getGraph()).data,
  });

  const biaEntriesQuery = useQuery({
    queryKey: ['financial-onboarding-bia-entries'],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => (await biaApi.getEntries()).data.entries,
  });

  const biaEntryByNodeId = useMemo(
    () =>
      new Map(
        (biaEntriesQuery.data || []).map((entry) => [
          entry.nodeId,
          {
            blastRadius: entry.blastRadius,
            downtimeCostPerHour: entry.downtimeCostPerHour ?? entry.financialImpactPerHour ?? null,
            downtimeCostSourceLabel: entry.downtimeCostSourceLabel ?? entry.financialScopeLabel ?? '—',
          },
        ]),
      ),
    [biaEntriesQuery.data],
  );

  const detectedServiceNodes = useMemo(() => {
    const excludedTypes = new Set(['REGION', 'AVAILABILITY_ZONE', 'VPC', 'SUBNET', 'FIREWALL']);
    return (graphQuery.data?.nodes || [])
      .filter((node) => !excludedTypes.has(String(node.type || '').toUpperCase()))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'fr-FR'));
  }, [graphQuery.data?.nodes]);

  const activeOverrideCount = useMemo(
    () => toServiceOverrides(serviceOverrideDrafts).length,
    [serviceOverrideDrafts],
  );

  const unknownOverrideCount = useMemo(() => {
    const knownNodeIds = new Set(detectedServiceNodes.map((node) => node.id));
    return toServiceOverrides(serviceOverrideDrafts).filter((override) => !knownNodeIds.has(override.nodeId)).length;
  }, [detectedServiceNodes, serviceOverrideDrafts]);

  const upsertOverrideDraft = (nodeId: string, patch: Partial<ServiceOverrideDraft>) => {
    setServiceOverrideDrafts((current) => ({
      ...current,
      [nodeId]: {
        customDowntimeCostPerHour: current[nodeId]?.customDowntimeCostPerHour || '',
        customCriticalityTier: current[nodeId]?.customCriticalityTier || '',
        ...patch,
      },
    }));
  };

  const clearOverrideDraft = (nodeId: string) => {
    setServiceOverrideDrafts((current) => {
      if (!current[nodeId]) return current;
      const next = { ...current };
      delete next[nodeId];
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setCurrency(initialProfile?.customCurrency || 'EUR');
    setAnnualRevenue(
      initialProfile?.annualRevenue != null && initialProfile.annualRevenue > 0
        ? String(initialProfile.annualRevenue)
        : '',
    );
    setHourlyDowntimeCost(
      initialProfile?.hourlyDowntimeCost != null && initialProfile.hourlyDowntimeCost > 0
        ? String(initialProfile.hourlyDowntimeCost)
        : '',
    );
    setSizeCategory(initialProfile?.sizeCategory || 'midMarket');
    setVerticalSector(initialProfile?.verticalSector || '');
    setIndustrySector(initialProfile?.industrySector || '');
    setEmployeeCount(
      initialProfile?.employeeCount != null && initialProfile.employeeCount > 0
        ? String(initialProfile.employeeCount)
        : '',
    );
    setAnnualITBudget(
      initialProfile?.annualITBudget != null && initialProfile.annualITBudget > 0
        ? String(initialProfile.annualITBudget)
        : '',
    );
    setDrBudgetPercent(
      initialProfile?.drBudgetPercent != null && initialProfile.drBudgetPercent > 0
        ? String(initialProfile.drBudgetPercent)
        : '',
    );
    setNumberOfCustomers(
      initialProfile?.numberOfCustomers != null && initialProfile.numberOfCustomers > 0
        ? String(initialProfile.numberOfCustomers)
        : '',
    );
    setCriticalStart(initialProfile?.criticalBusinessHours?.start || '');
    setCriticalEnd(initialProfile?.criticalBusinessHours?.end || '');
    setCriticalTimezone(initialProfile?.criticalBusinessHours?.timezone || '');
    setRegulatoryConstraintsText((initialProfile?.regulatoryConstraints || []).join('\n'));
    setServiceOverrideDrafts(buildOverrideDrafts(initialProfile?.serviceOverrides));
  }, [open, initialProfile]);

  const essentialsReady = useMemo(() => {
    return toNumberOrNull(annualRevenue) != null && toNumberOrNull(hourlyDowntimeCost) != null;
  }, [annualRevenue, hourlyDowntimeCost]);

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const annualRevenueValue = toNumberOrNull(annualRevenue);
      const downtimeValue = toNumberOrNull(hourlyDowntimeCost);
      if (annualRevenueValue == null || downtimeValue == null) {
        throw new Error('annualRevenue and hourlyDowntimeCost are required');
      }
      const overrides = toServiceOverrides(serviceOverrideDrafts);

      const regulatoryConstraints = splitConstraints(regulatoryConstraintsText);
      const criticalBusinessHours =
        criticalStart.trim() && criticalEnd.trim() && criticalTimezone.trim()
          ? {
              start: criticalStart.trim(),
              end: criticalEnd.trim(),
              timezone: criticalTimezone.trim(),
            }
          : null;

      const fieldSources: Record<string, string> = {
        annualRevenue: 'user_input',
        annualRevenueUSD: 'user_input',
        hourlyDowntimeCost: 'user_input',
        customDowntimeCostPerHour: 'user_input',
      };
      if (employeeCount.trim()) fieldSources.employeeCount = 'user_input';
      if (annualITBudget.trim()) fieldSources.annualITBudget = 'user_input';
      if (drBudgetPercent.trim()) fieldSources.drBudgetPercent = 'user_input';
      if (industrySector.trim()) fieldSources.industrySector = 'user_input';
      if (verticalSector.trim()) fieldSources.verticalSector = 'user_input';

      await financialApi.updateOrgProfile({
        sizeCategory,
        verticalSector: verticalSector || null,
        industrySector: industrySector || null,
        employeeCount: toNumberOrNull(employeeCount),
        annualRevenue: annualRevenueValue,
        annualITBudget: toNumberOrNull(annualITBudget),
        drBudgetPercent: toNumberOrNull(drBudgetPercent),
        hourlyDowntimeCost: downtimeValue,
        customDowntimeCostPerHour: downtimeValue,
        customCurrency: currency,
        numberOfCustomers: toNumberOrNull(numberOfCustomers),
        criticalBusinessHours,
        regulatoryConstraints,
        serviceOverrides: overrides,
        fieldSources,
      });
    },
    onSuccess: async () => {
      await invalidateFinancialProfileDependentQueries(queryClient);
      toast.success('Profil financier configuré');
      onOpenChange(false);
      onCompleted?.();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Impossible de sauvegarder le profil financier';
      toast.error(message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-5xl md:w-[80vw] md:min-w-[700px]">
        <DialogHeader>
          <DialogTitle>Assistant de configuration financière</DialogTitle>
          <DialogDescription>
            Étape {step} / 3 - Le profil financier est optionnel, mais nécessaire pour les calculs business.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-primary" />
                Données essentielles (obligatoires)
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">CA annuel ({currency})</label>
                <Input
                  type="number"
                  min={0}
                  value={annualRevenue}
                  onChange={(event) => setAnnualRevenue(event.target.value)}
                  placeholder="Ex: 5000000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Coût de downtime global par heure ({currency})</label>
                <Input
                  type="number"
                  min={0}
                  value={hourlyDowntimeCost}
                  onChange={(event) => setHourlyDowntimeCost(event.target.value)}
                  placeholder="Ex: 10000"
                />
                <p className="text-xs text-muted-foreground">
                  Si toute votre infrastructure était indisponible simultanement, combien cela coûterait-il par heure ?
                  Ce montant sera distribué automatiquement sur chaque service selon son impact (blast radius), puis ajustable ? l?Étape 3.
                </p>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium">Benchmarks indicatifs (jamais pré-remplis) :</p>
              <ul className="mt-2 space-y-1">
                {DOWNTIME_BENCHMARK_HINTS.map((hint) => (
                  <li key={hint}>- {hint}</li>
                ))}
              </ul>
              <p className="mt-2">Sources: ITIC 2024, Gartner.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Données complémentaires (optionnelles)
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
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
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
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Secteur financier</label>
                <Input
                  value={industrySector}
                  onChange={(event) => setIndustrySector(event.target.value)}
                  placeholder="Ex: technology_saas"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Nombre d’employés</label>
                <Input
                  type="number"
                  min={0}
                  value={employeeCount}
                  onChange={(event) => setEmployeeCount(event.target.value)}
                  placeholder="Ex: 450"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Nombre de clients</label>
                <Input
                  type="number"
                  min={0}
                  value={numberOfCustomers}
                  onChange={(event) => setNumberOfCustomers(event.target.value)}
                  placeholder="Ex: 12000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Budget IT annuel ({currency})</label>
                <Input
                  type="number"
                  min={0}
                  value={annualITBudget}
                  onChange={(event) => setAnnualITBudget(event.target.value)}
                  placeholder="Ex: 300000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">% budget IT alloué au DR</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={drBudgetPercent}
                  onChange={(event) => setDrBudgetPercent(event.target.value)}
                  placeholder="Ex: 4"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Heures critiques début</label>
                <Input
                  value={criticalStart}
                  onChange={(event) => setCriticalStart(event.target.value)}
                  placeholder="09:00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Heures critiques fin</label>
                <Input
                  value={criticalEnd}
                  onChange={(event) => setCriticalEnd(event.target.value)}
                  placeholder="18:00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Timezone</label>
                <Input
                  value={criticalTimezone}
                  onChange={(event) => setCriticalTimezone(event.target.value)}
                  placeholder="Europe/Paris"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Contraintes réglementaires (ligne ou virgule)</label>
              <textarea
                value={regulatoryConstraintsText}
                onChange={(event) => setRegulatoryConstraintsText(event.target.value)}
                className="min-h-[84px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="NIS2, DORA, ISO 27001"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                Overrides par service (optionnel, avancé)
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ajustez la criticité et/ou le co?t downtime/h pour chaque service détecté.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Overrides actifs : {activeOverrideCount}
                {unknownOverrideCount > 0 ? ` (dont ${unknownOverrideCount} hors inventaire courant)` : ''}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Devise</label>
              <select
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {CURRENCY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            {graphQuery.isLoading ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                Chargement des services détectés...
              </div>
            ) : graphQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Impossible de charger la liste des services détectés. Vous pouvez enregistrer le profil sans overrides.
              </div>
            ) : detectedServiceNodes.length === 0 ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                Aucun service détecté pour l?instant.
              </div>
            ) : (
              <div className="rounded-md border">
                <div className="max-h-[300px] overflow-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <colgroup>
                      <col style={{ width: '28%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '17%' }} />
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '10%' }} />
                    </colgroup>
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Service</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Blast radius</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Coût/h calculé</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          Downtime/h override ({currency}/h)
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Criticité override</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detectedServiceNodes.map((node) => {
                        const draft = serviceOverrideDrafts[node.id] || EMPTY_OVERRIDE_DRAFT;
                        const biaEntry = biaEntryByNodeId.get(node.id);
                        const transitive = Number(biaEntry?.blastRadius?.transitiveDependents ?? 0);
                        const totalServices = Number(biaEntry?.blastRadius?.totalServices ?? 0);
                        const blastDenominator = Math.max(1, totalServices - 1);
                        const blastPercent =
                          totalServices > 1 ? Math.round((transitive / blastDenominator) * 100) : null;
                        const hasOverride =
                          toNumberOrNull(draft.customDowntimeCostPerHour) != null || !!draft.customCriticalityTier;

                        return (
                          <tr key={node.id} className="border-b align-top last:border-0">
                            <td className="px-3 py-2">
                              <p className="font-medium">{node.name || node.id}</p>
                              <p className="text-xs text-muted-foreground">{describeServiceNode(node)}</p>
                              <p className="text-[11px] text-muted-foreground">ID: {node.id}</p>
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-medium">
                                {blastPercent != null ? `${blastPercent}% (${transitive}/${blastDenominator})` : '—'}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {biaEntry?.downtimeCostSourceLabel || 'BIA non généré'}
                              </p>
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-medium">
                                {formatDowntimeCost(biaEntry?.downtimeCostPerHour, currency)}
                              </p>
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min={0}
                                value={draft.customDowntimeCostPerHour}
                                onChange={(event) =>
                                  upsertOverrideDraft(node.id, {
                                    customDowntimeCostPerHour: event.target.value,
                                  })
                                }
                                placeholder="10 000"
                                className="h-9"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={draft.customCriticalityTier}
                                onChange={(event) =>
                                  upsertOverrideDraft(node.id, {
                                    customCriticalityTier:
                                      event.target.value as ServiceOverrideDraft['customCriticalityTier'],
                                  })
                                }
                                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                              >
                                {CRITICALITY_TIER_OPTIONS.map((option) => (
                                  <option key={option.value || 'default'} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => clearOverrideDraft(node.id)}
                                disabled={!hasOverride}
                              >
                                Réinitialiser
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
            <Button onClick={() => setStep((step + 1) as WizardStep)} disabled={step === 1 && !essentialsReady}>
              Continuer
            </Button>
          ) : (
            <Button onClick={() => updateProfileMutation.mutate()} disabled={updateProfileMutation.isPending}>
              {updateProfileMutation.isPending ? 'Sauvegarde...' : 'Enregistrer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

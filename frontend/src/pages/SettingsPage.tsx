import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Building2, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IntegrationsHub } from '@/components/integrations/IntegrationsHub';
import { FinancialOnboardingWizard } from '@/components/financial/FinancialOnboardingWizard';
import { CloudProvidersSettings } from '@/components/settings/CloudProvidersSettings';
import { useUIStore } from '@/stores/ui.store';
import { discoveryApi } from '@/api/discovery.api';
import { financialApi, type OrganizationFinancialProfile } from '@/api/financial.api';
import {
  buildCloudProviderScanPayload,
  loadCloudProviderConfigs,
} from '@/lib/cloudProviderConfigs';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { invalidateFinancialProfileDependentQueries } from '@/lib/financialQueryInvalidation';

const SIZE_OPTIONS = [
  { value: 'startup', label: 'Startup' },
  { value: 'smb', label: 'PME' },
  { value: 'midMarket', label: 'ETI' },
  { value: 'enterprise', label: 'Grande entreprise' },
  { value: 'largeEnterprise', label: 'Très grande entreprise' },
];

const VERTICAL_OPTIONS = [
  { value: '', label: 'Non précisé' },
  { value: 'banking_finance', label: 'Banque / Finance' },
  { value: 'healthcare', label: 'Santé' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'retail_ecommerce', label: 'Retail / eCommerce' },
  { value: 'technology_saas', label: 'Technologie / SaaS' },
  { value: 'media_telecom', label: 'Télécom / Media' },
  { value: 'government_public', label: 'Gouvernement / Public' },
];

const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP', 'CHF'] as const;

const CRITICALITY_TIER_OPTIONS = [
  { value: '', label: 'Global' },
  { value: 'critical', label: 'Critique' },
  { value: 'high', label: 'Élevée' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'low', label: 'Faible' },
] as const;

type SettingsTab = 'general' | 'finance' | 'cloud' | 'integrations';

const LANGUAGES = [
  { code: 'fr', label: 'Français', flag: 'FR' },
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'es', label: 'Español', flag: 'ES' },
  { code: 'it', label: 'Italiano', flag: 'IT' },
  { code: 'zh', label: '中文', flag: 'ZH' },
] as const;

type ServiceOverrideDraft = {
  customDowntimeCostPerHour: string;
  customCriticalityTier: '' | 'critical' | 'high' | 'medium' | 'low';
};

const EMPTY_OVERRIDE_DRAFT: ServiceOverrideDraft = {
  customDowntimeCostPerHour: '',
  customCriticalityTier: '',
};

function resolveSettingsTab(value: string | null): SettingsTab {
  if (value === 'finance' || value === 'cloud' || value === 'integrations') return value;
  return 'general';
}

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

type ScheduleFrequency = 'disabled' | 'hourly' | 'daily' | 'weekly';

function intervalToFrequency(intervalMinutes: number | undefined, enabled: boolean): ScheduleFrequency {
  if (!enabled) return 'disabled';
  const interval = Number(intervalMinutes || 0);
  if (interval <= 60) return 'hourly';
  if (interval <= 24 * 60) return 'daily';
  return 'weekly';
}

function frequencyToInterval(frequency: ScheduleFrequency): number {
  if (frequency === 'hourly') return 60;
  if (frequency === 'weekly') return 7 * 24 * 60;
  return 24 * 60;
}

function formatScheduleDistance(dateValue: string | null | undefined): string {
  if (!dateValue) return 'Non planifié';
  const target = new Date(dateValue);
  if (Number.isNaN(target.getTime())) return 'Non planifié';
  const diffMs = target.getTime() - Date.now();
  const future = diffMs >= 0;
  const totalMinutes = Math.round(Math.abs(diffMs) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}min` : `${minutes}min`;
  return future ? `dans ${label}` : `il y a ${label}`;
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

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantScope = getCredentialScopeKey();
  const { theme, toggleTheme } = useUIStore();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveSettingsTab(searchParams.get('tab')));

  const profileQuery = useQuery({
    queryKey: ['financial-org-profile', tenantScope],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
  });

  const [sizeCategory, setSizeCategory] = useState('midMarket');
  const [verticalSector, setVerticalSector] = useState('technology_saas');
  const [employeeCount, setEmployeeCount] = useState('');
  const [annualRevenue, setAnnualRevenue] = useState('');
  const [annualITBudget, setAnnualITBudget] = useState('');
  const [drBudgetPercent, setDrBudgetPercent] = useState('');
  const [hourlyDowntimeCost, setHourlyDowntimeCost] = useState('');
  const [industrySector, setIndustrySector] = useState('');
  const [numberOfCustomers, setNumberOfCustomers] = useState('');
  const [criticalStart, setCriticalStart] = useState('');
  const [criticalEnd, setCriticalEnd] = useState('');
  const [criticalTimezone, setCriticalTimezone] = useState('');
  const [regulatoryConstraintsText, setRegulatoryConstraintsText] = useState('');
  const [serviceOverrideDrafts, setServiceOverrideDrafts] = useState<Record<string, ServiceOverrideDraft>>({});
  const [customCurrency, setCustomCurrency] = useState('EUR');
  const [scheduleFrequency, setScheduleFrequency] = useState<ScheduleFrequency>('daily');

  const graphQuery = useQuery({
    queryKey: ['settings-financial-overrides-services', tenantScope],
    enabled: activeTab === 'finance',
    staleTime: 60_000,
    queryFn: async () => (await discoveryApi.getGraph()).data,
  });

  const schedulesQuery = useQuery({
    queryKey: ['discovery-schedules', tenantScope],
    enabled: activeTab === 'cloud',
    staleTime: 30_000,
    queryFn: async () => (await discoveryApi.getSchedules()).data.schedules,
  });

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

  const activeSchedule = useMemo(
    () => schedulesQuery.data?.[0] || null,
    [schedulesQuery.data],
  );

  const scheduledScanProviders = useMemo(
    () => buildCloudProviderScanPayload(loadCloudProviderConfigs(tenantScope)),
    [tenantScope, schedulesQuery.dataUpdatedAt],
  );

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
    const profile = profileQuery.data;
    if (!profile) return;
    setSizeCategory(profile.sizeCategory || 'midMarket');
    setVerticalSector(profile.verticalSector || 'technology_saas');
    setEmployeeCount(profile.employeeCount ? String(profile.employeeCount) : '');
    setAnnualRevenue(profile.annualRevenue ? String(profile.annualRevenue) : '');
    setAnnualITBudget(profile.annualITBudget ? String(profile.annualITBudget) : '');
    setDrBudgetPercent(profile.drBudgetPercent ? String(profile.drBudgetPercent) : '');
    setHourlyDowntimeCost(profile.hourlyDowntimeCost ? String(profile.hourlyDowntimeCost) : '');
    setIndustrySector(profile.industrySector || '');
    setNumberOfCustomers(profile.numberOfCustomers ? String(profile.numberOfCustomers) : '');
    setCriticalStart(profile.criticalBusinessHours?.start || '');
    setCriticalEnd(profile.criticalBusinessHours?.end || '');
    setCriticalTimezone(profile.criticalBusinessHours?.timezone || '');
    setRegulatoryConstraintsText((profile.regulatoryConstraints || []).join('\n'));
    setServiceOverrideDrafts(buildOverrideDrafts(profile.serviceOverrides));
    setCustomCurrency(profile.customCurrency || 'EUR');
  }, [profileQuery.data]);

  useEffect(() => {
    const tabFromQuery = resolveSettingsTab(searchParams.get('tab'));
    setActiveTab((current) => (current === tabFromQuery ? current : tabFromQuery));
  }, [searchParams]);

  useEffect(() => {
    if (!activeSchedule) {
      setScheduleFrequency('disabled');
      return;
    }
    setScheduleFrequency(
      intervalToFrequency(activeSchedule.intervalMinutes, Boolean(activeSchedule.enabled)),
    );
  }, [activeSchedule]);

  const handleTabChange = (nextTab: string) => {
    const resolved = resolveSettingsTab(nextTab);
    setActiveTab(resolved);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', resolved);
    setSearchParams(nextParams, { replace: true });
  };

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const serviceOverrides = toServiceOverrides(serviceOverrideDrafts);

      const criticalBusinessHours =
        criticalStart.trim() && criticalEnd.trim() && criticalTimezone.trim()
          ? {
              start: criticalStart.trim(),
              end: criticalEnd.trim(),
              timezone: criticalTimezone.trim(),
            }
          : null;

      await financialApi.updateOrgProfile({
        sizeCategory,
        verticalSector,
        industrySector: industrySector || null,
        employeeCount: toNumberOrNull(employeeCount),
        annualRevenue: toNumberOrNull(annualRevenue),
        annualITBudget: toNumberOrNull(annualITBudget),
        drBudgetPercent: toNumberOrNull(drBudgetPercent),
        hourlyDowntimeCost: toNumberOrNull(hourlyDowntimeCost),
        customDowntimeCostPerHour: toNumberOrNull(hourlyDowntimeCost),
        numberOfCustomers: toNumberOrNull(numberOfCustomers),
        criticalBusinessHours,
        regulatoryConstraints: splitConstraints(regulatoryConstraintsText),
        serviceOverrides,
        customCurrency,
        fieldSources: {
          employeeCount: employeeCount ? 'user_input' : undefined,
          annualRevenue: annualRevenue ? 'user_input' : undefined,
          annualRevenueUSD: annualRevenue ? 'user_input' : undefined,
          annualITBudget: annualITBudget ? 'user_input' : undefined,
          drBudgetPercent: drBudgetPercent ? 'user_input' : undefined,
          hourlyDowntimeCost: hourlyDowntimeCost ? 'user_input' : undefined,
          customDowntimeCostPerHour: hourlyDowntimeCost ? 'user_input' : undefined,
          industrySector: industrySector ? 'user_input' : undefined,
          verticalSector: verticalSector ? 'user_input' : undefined,
        },
      });
    },
    onSuccess: async () => {
      toast.success('Profil financier mis à jour');
      await invalidateFinancialProfileDependentQueries(queryClient);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Échec de la mise à jour du profil financier';
      toast.error(message);
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async (frequency: ScheduleFrequency) => {
      const enabled = frequency !== 'disabled';
      if (enabled && scheduledScanProviders.length === 0) {
        throw new Error('Configurez au moins un fournisseur cloud avant d’activer le scan planifié.');
      }
      await discoveryApi.updateSchedule({
        enabled,
        intervalMinutes: frequencyToInterval(frequency),
        providers: scheduledScanProviders,
        options: { inferDependencies: true },
      });
    },
    onSuccess: async () => {
      toast.success('Planification du scan mise à jour');
      await queryClient.invalidateQueries({ queryKey: ['discovery-schedules', tenantScope] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Mise à jour du scan planifié impossible');
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async () => {
      if (activeSchedule?.enabled) {
        await discoveryApi.runScheduledScanNow();
        return;
      }
      if (scheduledScanProviders.length === 0) {
        throw new Error('Configurez au moins un fournisseur cloud avant de lancer un scan.');
      }
      await discoveryApi.launchScan({
        providers: scheduledScanProviders,
        options: { inferDependencies: true },
      });
    },
    onSuccess: () => {
      toast.success('Scan lancé');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Lancement du scan impossible');
    },
  });

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="general">{t('settings.tabs.general')}</TabsTrigger>
          <TabsTrigger value="finance">{t('settings.tabs.finance')}</TabsTrigger>
          <TabsTrigger value="cloud">{t('settings.tabs.cloud')}</TabsTrigger>
          <TabsTrigger value="integrations">{t('settings.tabs.integrations')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="mx-auto max-w-2xl space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  {t('settings.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>{t('settings.language')}</Label>
                  <Select value={i18n.resolvedLanguage ?? 'fr'} onValueChange={(lang) => void i18n.changeLanguage(lang)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((language) => (
                        <SelectItem key={language.code} value={language.code}>
                          {language.flag} {language.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t('settings.darkMode')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.darkModeDescription')}</p>
                  </div>
                  <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} />
                </div>

                <Separator />

                <div>
                  <Label>{t('settings.apiUrl')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}
                  </p>
                </div>

                <Separator />

                <div>
                  <Label>{t('common.version')}</Label>
                  <p className="text-sm text-muted-foreground">Stronghold v2.0.0</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="finance">
          <div className="mx-auto max-w-3xl space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Profil organisation & finance
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
                    Assistant de configuration
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {profileQuery.data?.reviewBanner && (
                  <div className="md:col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {profileQuery.data.reviewBanner}
                  </div>
                )}
                {!profileQuery.data?.reviewBanner && profileQuery.data?.inferenceBanner && (
                  <div className="md:col-span-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    {profileQuery.data.inferenceBanner}
                  </div>
                )}
                {profileQuery.data?.mode === 'business_profile' && (
                  <div className="md:col-span-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    Profil financier configuré.
                  </div>
                )}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Mode : {profileQuery.data?.mode || 'infra_only'}</span>
                  <span>Source profil : {profileQuery.data?.profileSource || 'inferred'}</span>
                  <span>
                    Confiance : {profileQuery.data?.profileConfidence != null
                      ? `${Math.round(profileQuery.data.profileConfidence * 100)}%`
                      : 'N/A'}
                  </span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sizeCategory">Taille</Label>
                  <select
                    id="sizeCategory"
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

                <div className="space-y-2">
                  <Label htmlFor="verticalSector">Secteur</Label>
                  <select
                    id="verticalSector"
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

                <div className="space-y-2">
                  <Label htmlFor="industrySector">Secteur financier</Label>
                  <select
                    id="industrySector"
                    value={industrySector}
                    onChange={(event) => setIndustrySector(event.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {VERTICAL_OPTIONS.map((option) => (
                      <option key={`industry-${option.value || 'none'}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="employeeCount">Nombre d&apos;employés</Label>
                  <Input
                    id="employeeCount"
                    type="number"
                    min={0}
                    value={employeeCount}
                    onChange={(event) => setEmployeeCount(event.target.value)}
                    placeholder="Ex: 450"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="annualRevenue">CA annuel ({customCurrency})</Label>
                  <Input
                    id="annualRevenue"
                    type="number"
                    min={0}
                    value={annualRevenue}
                    onChange={(event) => setAnnualRevenue(event.target.value)}
                    placeholder="Ex: 30000000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="annualITBudget">Budget IT annuel ({customCurrency})</Label>
                  <Input
                    id="annualITBudget"
                    type="number"
                    min={0}
                    value={annualITBudget}
                    onChange={(event) => setAnnualITBudget(event.target.value)}
                    placeholder="Ex: 1500000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="drBudgetPercent">% budget IT alloué au DR</Label>
                  <Input
                    id="drBudgetPercent"
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={drBudgetPercent}
                    onChange={(event) => setDrBudgetPercent(event.target.value)}
                    placeholder="Ex: 4"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hourlyDowntimeCost">Coût downtime horaire ({customCurrency}/h)</Label>
                  <Input
                    id="hourlyDowntimeCost"
                    type="number"
                    min={0}
                    value={hourlyDowntimeCost}
                    onChange={(event) => setHourlyDowntimeCost(event.target.value)}
                    placeholder="Ex: 25000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="numberOfCustomers">Nombre de clients</Label>
                  <Input
                    id="numberOfCustomers"
                    type="number"
                    min={0}
                    value={numberOfCustomers}
                    onChange={(event) => setNumberOfCustomers(event.target.value)}
                    placeholder="Ex: 12000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Devise</Label>
                  <select
                    id="currency"
                    value={customCurrency}
                    onChange={(event) => setCustomCurrency(event.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="criticalStart">Heures critiques début</Label>
                  <Input
                    id="criticalStart"
                    value={criticalStart}
                    onChange={(event) => setCriticalStart(event.target.value)}
                    placeholder="09:00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="criticalEnd">Heures critiques fin</Label>
                  <Input
                    id="criticalEnd"
                    value={criticalEnd}
                    onChange={(event) => setCriticalEnd(event.target.value)}
                    placeholder="18:00"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="criticalTimezone">Fuseau horaire des heures critiques</Label>
                  <Input
                    id="criticalTimezone"
                    value={criticalTimezone}
                    onChange={(event) => setCriticalTimezone(event.target.value)}
                    placeholder="Europe/Paris"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="regulatoryConstraints">Contraintes réglementaires (ligne ou virgule)</Label>
                  <textarea
                    id="regulatoryConstraints"
                    value={regulatoryConstraintsText}
                    onChange={(event) => setRegulatoryConstraintsText(event.target.value)}
                    className="min-h-[84px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="NIS2, DORA, ISO 27001"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Overrides par service</Label>
                    <span className="text-xs text-muted-foreground">
                      Overrides actifs : {activeOverrideCount}
                      {unknownOverrideCount > 0 ? ` (dont ${unknownOverrideCount} hors inventaire courant)` : ''}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ajustez la criticité et/ou le coût downtime/h pour chaque service détecté.
                  </p>
                  {graphQuery.isLoading ? (
                    <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Chargement des services détectés...
                    </div>
                  ) : graphQuery.isError ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      Impossible de charger la liste des services détectés. Vous pouvez enregistrer sans overrides.
                    </div>
                  ) : detectedServiceNodes.length === 0 ? (
                    <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Aucun service détecté pour l’instant.
                    </div>
                  ) : (
                    <div className="rounded-md border">
                      <div className="max-h-[320px] overflow-auto">
                        <table className="w-full min-w-[720px] text-sm">
                          <colgroup>
                            <col style={{ width: '35%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '15%' }} />
                          </colgroup>
                          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                            <tr className="border-b">
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Service</th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                                Downtime/h override ({customCurrency}/h)
                              </th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                                Criticité override
                              </th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detectedServiceNodes.map((node) => {
                              const draft = serviceOverrideDrafts[node.id] || EMPTY_OVERRIDE_DRAFT;
                              const hasOverride =
                                toNumberOrNull(draft.customDowntimeCostPerHour) != null ||
                                !!draft.customCriticalityTier;

                              return (
                                <tr key={node.id} className="border-b align-top last:border-0">
                                  <td className="px-3 py-2">
                                    <p className="font-medium">{node.name || node.id}</p>
                                    <p className="text-xs text-muted-foreground">{describeServiceNode(node)}</p>
                                    <p className="text-[11px] text-muted-foreground">ID: {node.id}</p>
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

                <div className="md:col-span-2">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Les valeurs business ne sont jamais auto-estimées. Saisissez uniquement vos données valides.
                  </p>
                  <div className="mb-3">
                    <Button variant="secondary" onClick={() => setWizardOpen(true)}>
                      Ouvrir l'assistant onboarding financier
                    </Button>
                  </div>
                  <Button
                    onClick={() => updateProfileMutation.mutate()}
                    disabled={updateProfileMutation.isPending}
                  >
                    {updateProfileMutation.isPending ? 'Enregistrement...' : 'Enregistrer le profil financier'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cloud">
          <div className="mx-auto max-w-3xl space-y-6">
            <CloudProvidersSettings tenantScope={tenantScope} />

            <Card>
              <CardHeader>
                <CardTitle>Scan planifié</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="scan-frequency">Fréquence</Label>
                  <select
                    id="scan-frequency"
                    value={scheduleFrequency}
                    onChange={(event) => setScheduleFrequency(event.target.value as ScheduleFrequency)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="hourly">Toutes les heures</option>
                    <option value="daily">Toutes les 24 heures</option>
                    <option value="weekly">Toutes les semaines</option>
                    <option value="disabled">Désactivé</option>
                  </select>
                </div>

                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    Dernier scan : {activeSchedule?.lastScanAt ? formatScheduleDistance(activeSchedule.lastScanAt) : 'jamais'}
                  </p>
                  <p>
                    Prochain scan : {activeSchedule?.enabled && activeSchedule?.nextScanAt
                      ? formatScheduleDistance(activeSchedule.nextScanAt)
                      : 'désactivé'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => updateScheduleMutation.mutate(scheduleFrequency)}
                    disabled={updateScheduleMutation.isPending || schedulesQuery.isLoading}
                  >
                    {updateScheduleMutation.isPending ? 'Enregistrement...' : 'Enregistrer la planification'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => runNowMutation.mutate()}
                    disabled={runNowMutation.isPending}
                  >
                    {runNowMutation.isPending ? 'Lancement...' : 'Lancer un scan maintenant'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationsHub />
        </TabsContent>
      </Tabs>

      <FinancialOnboardingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialProfile={profileQuery.data}
        onCompleted={() => {
          void invalidateFinancialProfileDependentQueries(queryClient);
        }}
      />
    </div>
  );
}



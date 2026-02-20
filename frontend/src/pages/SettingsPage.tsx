import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { IntegrationsHub } from '@/components/integrations/IntegrationsHub';
import { FinancialOnboardingWizard } from '@/components/financial/FinancialOnboardingWizard';
import { useUIStore } from '@/stores/ui.store';
import { financialApi } from '@/api/financial.api';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { invalidateFinancialProfileDependentQueries } from '@/lib/financialQueryInvalidation';

const SIZE_OPTIONS = [
  { value: 'startup', label: 'Startup' },
  { value: 'smb', label: 'PME' },
  { value: 'midMarket', label: 'ETI' },
  { value: 'enterprise', label: 'Grande entreprise' },
  { value: 'largeEnterprise', label: 'Tres grande entreprise' },
];

const VERTICAL_OPTIONS = [
  { value: '', label: 'Non precise' },
  { value: 'banking_finance', label: 'Banque / Finance' },
  { value: 'healthcare', label: 'Sante' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'retail_ecommerce', label: 'Retail / eCommerce' },
  { value: 'technology_saas', label: 'Technologie / SaaS' },
  { value: 'media_telecom', label: 'Telecom / Media' },
  { value: 'government_public', label: 'Gouvernement / Public' },
];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();
  const { theme, toggleTheme } = useUIStore();
  const [wizardOpen, setWizardOpen] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['financial-org-profile', tenantScope],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
  });

  const [sizeCategory, setSizeCategory] = useState('midMarket');
  const [verticalSector, setVerticalSector] = useState('technology_saas');
  const [employeeCount, setEmployeeCount] = useState('');
  const [annualRevenueUSD, setAnnualRevenueUSD] = useState('');
  const [annualRevenue, setAnnualRevenue] = useState('');
  const [annualITBudget, setAnnualITBudget] = useState('');
  const [drBudgetPercent, setDrBudgetPercent] = useState('');
  const [hourlyDowntimeCost, setHourlyDowntimeCost] = useState('');
  const [industrySector, setIndustrySector] = useState('');
  const [customDowntimeCostPerHour, setCustomDowntimeCostPerHour] = useState('');
  const [customCurrency, setCustomCurrency] = useState('EUR');

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;
    setSizeCategory(profile.sizeCategory || 'midMarket');
    setVerticalSector(profile.verticalSector || 'technology_saas');
    setEmployeeCount(profile.employeeCount ? String(profile.employeeCount) : '');
    setAnnualRevenueUSD(profile.annualRevenueUSD ? String(profile.annualRevenueUSD) : '');
    setAnnualRevenue(profile.annualRevenue ? String(profile.annualRevenue) : '');
    setAnnualITBudget(profile.annualITBudget ? String(profile.annualITBudget) : '');
    setDrBudgetPercent(profile.drBudgetPercent ? String(profile.drBudgetPercent) : '');
    setHourlyDowntimeCost(profile.hourlyDowntimeCost ? String(profile.hourlyDowntimeCost) : '');
    setIndustrySector(profile.industrySector || '');
    setCustomDowntimeCostPerHour(
      profile.customDowntimeCostPerHour ? String(profile.customDowntimeCostPerHour) : '',
    );
    setCustomCurrency(profile.customCurrency || 'EUR');
  }, [profileQuery.data]);

  const updateProfileMutation = useMutation({
    mutationFn: () =>
      financialApi.updateOrgProfile({
        sizeCategory,
        verticalSector,
        industrySector: industrySector || null,
        employeeCount: employeeCount ? Number(employeeCount) : null,
        annualRevenueUSD: annualRevenueUSD ? Number(annualRevenueUSD) : null,
        annualRevenue: annualRevenue ? Number(annualRevenue) : null,
        annualITBudget: annualITBudget ? Number(annualITBudget) : null,
        drBudgetPercent: drBudgetPercent ? Number(drBudgetPercent) : null,
        hourlyDowntimeCost: hourlyDowntimeCost ? Number(hourlyDowntimeCost) : null,
        customDowntimeCostPerHour: customDowntimeCostPerHour
          ? Number(customDowntimeCostPerHour)
          : null,
        profileSource: 'user_input',
        customCurrency,
      }),
    onSuccess: async () => {
      toast.success('Profil financier mis a jour');
      await invalidateFinancialProfileDependentQueries(queryClient);
    },
    onError: () => {
      toast.error('Echec de la mise a jour du profil financier');
    },
  });

  return (
    <div className="space-y-6">
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="mx-auto max-w-2xl space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Parametres
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Mode sombre</Label>
                    <p className="text-sm text-muted-foreground">Activer le theme sombre</p>
                  </div>
                  <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} />
                </div>

                <Separator />

                <div>
                  <Label>URL de l&apos;API</Label>
                  <p className="text-sm text-muted-foreground">
                    {import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}
                  </p>
                </div>

                <Separator />

                <div>
                  <Label>Version</Label>
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
                {profileQuery.data?.inferenceBanner && (
                  <div className="md:col-span-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    {profileQuery.data.inferenceBanner}
                  </div>
                )}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Source profil: {profileQuery.data?.profileSource || 'inferred'}</span>
                  <span>
                    Confiance: {profileQuery.data?.profileConfidence != null
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
                  <Label htmlFor="employeeCount">Nombre d&apos;employes</Label>
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
                  <Label htmlFor="annualRevenueUSD">CA annuel (USD)</Label>
                  <Input
                    id="annualRevenueUSD"
                    type="number"
                    min={0}
                    value={annualRevenueUSD}
                    onChange={(event) => setAnnualRevenueUSD(event.target.value)}
                    placeholder="Ex: 125000000"
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
                  <Label htmlFor="drBudgetPercent">% budget IT alloue au DR</Label>
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
                  <Label htmlFor="hourlyDowntimeCost">Cout downtime horaire ({customCurrency}/h)</Label>
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
                  <Label htmlFor="customDowntimeCostPerHour">Cout downtime horaire (optionnel)</Label>
                  <Input
                    id="customDowntimeCostPerHour"
                    type="number"
                    min={0}
                    value={customDowntimeCostPerHour}
                    onChange={(event) => setCustomDowntimeCostPerHour(event.target.value)}
                    placeholder="Ex: 250000"
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
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="CHF">CHF</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Estimation basee sur donnees marche publiques. Ajustez ces valeurs avec la finance pour refleter votre contexte.
                  </p>
                  {profileQuery.data?.fieldSources && (
                    <div className="mb-3 rounded-md border bg-muted/20 p-3 text-xs">
                      <p className="mb-1 font-medium">Traceabilite des valeurs</p>
                      {Object.entries(profileQuery.data.fieldSources).map(([field, trace]) => (
                        <p key={field}>
                          {field}: {trace.source} ({Math.round(trace.confidence * 100)}%) - {trace.note}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="mb-3">
                    <Button variant="secondary" onClick={() => setWizardOpen(true)}>
                      Ouvrir l assistant onboarding financier
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



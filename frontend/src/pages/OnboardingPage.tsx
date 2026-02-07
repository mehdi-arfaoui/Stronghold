import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Shield, Cloud, Box, Github, Network, Check, Loader2, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { StepIndicator } from '@/components/layout/StepIndicator';
import { discoveryApi } from '@/api/discovery.api';
import { useDiscoveryStore } from '@/stores/discovery.store';
import { cn } from '@/lib/utils';

interface ProviderInfo {
  id: string;
  label: string;
  icon: LucideIcon;
  fields: { name: string; label: string; type: string; required: boolean }[];
  regions?: string[];
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'aws', label: 'AWS', icon: Cloud,
    fields: [
      { name: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true },
      { name: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
      { name: 'sessionToken', label: 'Session Token (opt.)', type: 'password', required: false },
    ],
    regions: ['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'us-east-1', 'us-west-2', 'ap-southeast-1'],
  },
  {
    id: 'azure', label: 'Azure', icon: Cloud,
    fields: [
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
      { name: 'clientId', label: 'Client ID', type: 'text', required: true },
      { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
    ],
  },
  {
    id: 'gcp', label: 'GCP', icon: Cloud,
    fields: [
      { name: 'projectId', label: 'Project ID', type: 'text', required: true },
      { name: 'serviceAccountKey', label: 'Service Account JSON', type: 'text', required: true },
    ],
  },
  {
    id: 'kubernetes', label: 'Kubernetes', icon: Box,
    fields: [
      { name: 'kubeconfig', label: 'Kubeconfig (contenu)', type: 'text', required: true },
      { name: 'context', label: 'Context (opt.)', type: 'text', required: false },
    ],
  },
  {
    id: 'github', label: 'GitHub', icon: Github,
    fields: [
      { name: 'token', label: 'Personal Access Token', type: 'password', required: true },
      { name: 'org', label: 'Organisation', type: 'text', required: false },
    ],
  },
  {
    id: 'network', label: 'Reseau', icon: Network,
    fields: [
      { name: 'cidrRanges', label: 'Plages CIDR (une par ligne)', type: 'text', required: true },
    ],
  },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { configuredProviders, addConfiguredProvider } = useDiscoveryStore();
  const [activeProvider, setActiveProvider] = useState<ProviderInfo | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const testMutation = useMutation({
    mutationFn: ({ provider, creds }: { provider: string; creds: Record<string, string> }) =>
      discoveryApi.testCredentials(provider, creds),
    onSuccess: (res) => setTestResult({ success: res.data.success, message: res.data.message }),
    onError: () => setTestResult({ success: false, message: 'Erreur de connexion' }),
  });

  const launchScanMutation = useMutation({
    mutationFn: () => discoveryApi.launchScan({
      providers: configuredProviders.map((p) => ({
        provider: p,
        credentials: {},
        regions: [],
      })),
    }),
    onSuccess: () => {
      toast.success('Scan lance');
      navigate('/discovery');
    },
    onError: () => toast.error('Erreur lors du lancement'),
  });

  const seedDemoMutation = useMutation({
    mutationFn: () => discoveryApi.seedDemo(),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Environnement de demo charge !');
      navigate('/discovery');
    },
    onError: () => toast.error('Erreur lors du chargement de la demo'),
  });

  const handleSaveProvider = () => {
    if (activeProvider) {
      addConfiguredProvider(activeProvider.id);
      toast.success(`${activeProvider.label} configure`);
      setActiveProvider(null);
      setCredentials({});
      setSelectedRegions(new Set());
      setTestResult(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      {/* Header */}
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <Shield className="h-12 w-12 text-primary" />
        </div>
        <h1 className="text-3xl font-bold">Bienvenue sur Stronghold</h1>
        <p className="mt-2 text-muted-foreground">
          Connectez vos environnements cloud et on-premise. Stronghold va scanner automatiquement votre infrastructure.
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator
        steps={[
          { label: 'Connexion', completed: configuredProviders.length > 0, active: true },
          { label: 'Scan', completed: false, active: false },
          { label: 'Validation', completed: false, active: false },
          { label: 'Analyse', completed: false, active: false },
          { label: 'Resultat', completed: false, active: false },
        ]}
      />

      {/* Provider cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const isConfigured = configuredProviders.includes(provider.id);
          return (
            <Card
              key={provider.id}
              className={cn(
                'cursor-pointer transition-all hover:shadow-md',
                isConfigured && 'border-primary'
              )}
              onClick={() => { setActiveProvider(provider); setTestResult(null); }}
            >
              <CardContent className="flex flex-col items-center p-6 text-center">
                <provider.icon className="mb-3 h-10 w-10 text-primary" />
                <h3 className="font-semibold">{provider.label}</h3>
                {isConfigured ? (
                  <div className="mt-2 flex items-center gap-1 text-sm text-resilience-high">
                    <Check className="h-4 w-4" /> Configure
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                    <Plus className="h-4 w-4" /> Ajouter
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Provider config dialog */}
      {activeProvider && (
        <Dialog open onOpenChange={() => setActiveProvider(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Configurer {activeProvider.label}</DialogTitle>
              <DialogDescription>Entrez les informations de connexion</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {activeProvider.fields.map((field) => (
                <div key={field.name}>
                  <Label>{field.label}</Label>
                  <Input
                    type={field.type}
                    value={credentials[field.name] || ''}
                    onChange={(e) => setCredentials((c) => ({ ...c, [field.name]: e.target.value }))}
                    required={field.required}
                  />
                </div>
              ))}

              {activeProvider.regions && (
                <div>
                  <Label className="mb-2 block">Regions</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {activeProvider.regions.map((region) => (
                      <label key={region} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedRegions.has(region)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedRegions);
                            if (checked) next.add(region); else next.delete(region);
                            setSelectedRegions(next);
                          }}
                        />
                        {region}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => testMutation.mutate({ provider: activeProvider.id, creds: credentials })}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Tester la connexion
              </Button>

              {testResult && (
                <p className={cn('text-sm', testResult.success ? 'text-resilience-high' : 'text-severity-critical')}>
                  {testResult.success ? '✓' : '✗'} {testResult.message}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setActiveProvider(null)}>Annuler</Button>
              <Button onClick={handleSaveProvider}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Summary */}
      {configuredProviders.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-2 font-semibold">Sources configurees</h3>
            {configuredProviders.map((p) => (
              <p key={p} className="text-sm text-muted-foreground">
                <Check className="mr-1 inline h-4 w-4 text-resilience-high" />
                {PROVIDERS.find((pr) => pr.id === p)?.label || p}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Launch button */}
      <Button
        className="w-full"
        size="lg"
        disabled={configuredProviders.length === 0 || launchScanMutation.isPending}
        onClick={() => launchScanMutation.mutate()}
      >
        {launchScanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Lancer le scan →
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Vous pourrez aussi importer des fichiers CSV/JSON ou des templates Terraform plus tard.
      </p>

      {/* Demo data section */}
      <div className="mt-8 text-center">
        <p className="text-sm text-muted-foreground mb-2">
          Pas encore de credentials cloud ?
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={seedDemoMutation.isPending}
          onClick={() => seedDemoMutation.mutate()}
        >
          {seedDemoMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Charger un environnement de demonstration
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          Simule une entreprise e-commerce avec ~45 services AWS + Kubernetes + on-premise
        </p>
      </div>
    </div>
  );
}

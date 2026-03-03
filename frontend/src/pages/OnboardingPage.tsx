import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight,
  Box,
  Check,
  Cloud,
  DatabaseZap,
  Github,
  Loader2,
  Network,
  ServerCog,
  Shield,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StepIndicator } from '@/components/layout/StepIndicator';
import { discoveryApi } from '@/api/discovery.api';
import { cn } from '@/lib/utils';
import {
  buildCloudProviderScanPayload,
  loadCloudProviderConfigs,
  saveCloudProviderConfigs,
  validateCloudProviderConfig,
  type CloudProviderConfigMap,
  type CloudProviderId,
} from '@/lib/cloudProviderConfigs';

type OnboardingMode = 'demo' | 'scan';
type DemoStep = 1 | 2 | 3;

type StoredProviderConfig = {
  credentials: Record<string, string>;
  regions: string[];
};

type DemoOnboardingProps = {
  step: DemoStep;
  onStepChange: (step: DemoStep) => void;
  onCompletedChange: (completed: boolean) => void;
};

type DemoOnboardingModule = {
  default: ComponentType<DemoOnboardingProps>;
};

interface ProviderInfo {
  id: string;
  label: string;
  icon: LucideIcon;
  fields: { name: string; label: string; type: string; required: boolean }[];
  regions?: string[];
}

const demoModules = import.meta.glob('./demo/*.tsx');
const loadDemoOnboarding = __DEMO_ENABLED__
  ? (demoModules['./demo/DemoOnboarding.tsx'] as undefined | (() => Promise<DemoOnboardingModule>))
  : undefined;
const DemoOnboarding = loadDemoOnboarding ? lazy(loadDemoOnboarding) : null;

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'aws',
    label: 'AWS',
    icon: Cloud,
    fields: [
      { name: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true },
      { name: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
      { name: 'sessionToken', label: 'Session Token (optional)', type: 'password', required: false },
    ],
    regions: ['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'us-east-1', 'us-west-2'],
  },
  {
    id: 'azure',
    label: 'Azure',
    icon: Cloud,
    fields: [
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
      { name: 'clientId', label: 'Client ID', type: 'text', required: true },
      { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { name: 'subscriptionId', label: 'Subscription ID', type: 'text', required: true },
    ],
  },
  {
    id: 'gcp',
    label: 'GCP',
    icon: Cloud,
    fields: [{ name: 'serviceAccountJson', label: 'Service Account JSON', type: 'text', required: true }],
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    icon: Box,
    fields: [
      { name: 'kubeconfig', label: 'Kubeconfig content', type: 'text', required: true },
      { name: 'name', label: 'Cluster name', type: 'text', required: false },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    icon: Network,
    fields: [{ name: 'cidrRanges', label: 'CIDR ranges (one per line)', type: 'text', required: true }],
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: Github,
    fields: [{ name: 'token', label: 'Personal Access Token', type: 'password', required: true }],
  },
];

const CLOUD_PROVIDER_IDS: CloudProviderId[] = ['aws', 'azure', 'gcp'];

function isCloudProvider(providerId: string): providerId is CloudProviderId {
  return CLOUD_PROVIDER_IDS.includes(providerId as CloudProviderId);
}

function parseApiError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { error?: string; message?: string } } }).response?.data;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
  }
  return fallback;
}

function sanitizeCredentials(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value.length > 0),
  );
}

function hasRequiredFields(provider: ProviderInfo, creds: Record<string, string>): boolean {
  return provider.fields.every((field) => {
    if (!field.required) return true;
    return Boolean(creds[field.name]?.trim());
  });
}

function parseCidrRanges(rawValue: string | undefined): string[] {
  if (!rawValue) return [];
  return rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function OnboardingPage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<OnboardingMode>(__DEMO_ENABLED__ ? 'demo' : 'scan');
  const [step, setStep] = useState<DemoStep>(1);
  const [demoCompleted, setDemoCompleted] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderInfo | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [providerConfigs, setProviderConfigs] = useState<Record<string, StoredProviderConfig>>({});

  useEffect(() => {
    const storedCloudConfigs = loadCloudProviderConfigs();
    if (Object.keys(storedCloudConfigs).length === 0) return;
    setProviderConfigs((previous) => {
      const next = { ...previous };
      for (const providerId of CLOUD_PROVIDER_IDS) {
        const config = storedCloudConfigs[providerId];
        if (!config) continue;
        next[providerId] = {
          credentials: config.credentials,
          regions: config.regions || [],
        };
      }
      return next;
    });
  }, []);

  const cloudProviderConfigs = useMemo<CloudProviderConfigMap>(() => {
    const next: CloudProviderConfigMap = {};
    for (const providerId of CLOUD_PROVIDER_IDS) {
      const config = providerConfigs[providerId];
      if (!config) continue;
      next[providerId] = {
        credentials: config.credentials,
        regions: config.regions,
      };
    }
    return next;
  }, [providerConfigs]);

  const configuredProviders = useMemo(
    () =>
      PROVIDERS.filter((provider) => {
        const config = providerConfigs[provider.id];
        if (!config) return false;
        if (isCloudProvider(provider.id)) {
          return validateCloudProviderConfig(provider.id, config.credentials).valid;
        }
        return hasRequiredFields(provider, sanitizeCredentials(config.credentials));
      }).map((provider) => provider.id),
    [providerConfigs],
  );

  const testMutation = useMutation({
    mutationFn: ({ provider, creds }: { provider: string; creds: Record<string, string> }) =>
      discoveryApi.testCredentials(provider, creds),
    onSuccess: (res) => setTestResult({ success: res.data.success, message: res.data.message }),
    onError: (error) =>
      setTestResult({ success: false, message: parseApiError(error, 'Connection test failed') }),
  });

  const launchScanMutation = useMutation({
    mutationFn: async () => {
      const cloudProviders = buildCloudProviderScanPayload(cloudProviderConfigs);

      const kubernetes = configuredProviders
        .filter((providerId) => providerId === 'kubernetes')
        .map((providerId) => {
          const config = providerConfigs[providerId];
          const kubeconfig = config?.credentials.kubeconfig || '';
          const name = config?.credentials.name || 'cluster-default';
          return { name, kubeconfig };
        })
        .filter((entry) => entry.kubeconfig.length > 0);

      const networkConfig = providerConfigs.network;
      const ipRanges = parseCidrRanges(networkConfig?.credentials.cidrRanges);

      if (configuredProviders.includes('github')) {
        toast.info('GitHub connector is ignored in discovery scan mode.');
      }

      if (cloudProviders.length === 0 && kubernetes.length === 0 && ipRanges.length === 0) {
        throw new Error('No valid discovery source configured');
      }

      return discoveryApi.launchScan({
        providers: cloudProviders,
        ...(kubernetes.length > 0 ? { kubernetes } : {}),
        ...(ipRanges.length > 0 ? { onPremise: { ipRanges } } : {}),
        options: { inferDependencies: true },
      });
    },
    onSuccess: () => {
      toast.success('Scan launched');
      navigate('/discovery');
    },
    onError: (error) => {
      toast.error(parseApiError(error, 'Unable to launch scan'));
    },
  });

  const configuredProviderLabels = configuredProviders.map(
    (providerId) => PROVIDERS.find((provider) => provider.id === providerId)?.label || providerId,
  );

  const cloudScanProviders = buildCloudProviderScanPayload(cloudProviderConfigs);
  const kubernetesConfig = providerConfigs.kubernetes;
  const hasKubernetesSource = Boolean(kubernetesConfig?.credentials.kubeconfig?.trim());
  const hasOnPremSource = parseCidrRanges(providerConfigs.network?.credentials.cidrRanges).length > 0;
  const canLaunchScan =
    (cloudScanProviders.length > 0 || hasKubernetesSource || hasOnPremSource) &&
    !launchScanMutation.isPending;

  const flowSteps = useMemo(() => {
    if (mode === 'demo' && __DEMO_ENABLED__) {
      return [
        { label: 'Mode', completed: step > 1, active: step === 1 },
        { label: 'Profil', completed: step > 2, active: step === 2 },
        { label: 'Result', completed: demoCompleted, active: step === 3 },
      ];
    }

    return [
      { label: 'Mode', completed: step > 1, active: step === 1 },
      { label: 'Connectors', completed: false, active: step === 2 },
      { label: 'Scan', completed: false, active: false },
    ];
  }, [demoCompleted, mode, step]);

  const handleSaveProvider = () => {
    if (!activeProvider) return;

    const sanitized = sanitizeCredentials(credentials);
    if (!hasRequiredFields(activeProvider, sanitized)) {
      toast.error('Please fill all required fields for this provider');
      return;
    }

    if (isCloudProvider(activeProvider.id)) {
      const validation = validateCloudProviderConfig(activeProvider.id, sanitized);
      if (!validation.valid) {
        toast.error(validation.reason);
        return;
      }
    }

    const nextConfig: StoredProviderConfig = {
      credentials: sanitized,
      regions: Array.from(selectedRegions),
    };
    setProviderConfigs((previous) => ({
      ...previous,
      [activeProvider.id]: nextConfig,
    }));

    if (isCloudProvider(activeProvider.id)) {
      saveCloudProviderConfigs({
        ...cloudProviderConfigs,
        [activeProvider.id]: {
          credentials: nextConfig.credentials,
          regions: nextConfig.regions,
        },
      });
    }

    toast.success(`${activeProvider.label} configured`);
    setActiveProvider(null);
    setCredentials({});
    setSelectedRegions(new Set());
    setTestResult(null);
  };

  const renderProviderDialog = () => {
    if (!activeProvider) return null;

    return (
      <Dialog open onOpenChange={() => setActiveProvider(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure {activeProvider.label}</DialogTitle>
            <DialogDescription>Enter connector details for secure discovery.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {activeProvider.fields.map((field) => (
              <div key={field.name}>
                <Label>{field.label}</Label>
                <Input
                  type={field.type}
                  value={credentials[field.name] || ''}
                  onChange={(event) =>
                    setCredentials((previous) => ({ ...previous, [field.name]: event.target.value }))
                  }
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
                          if (checked) next.add(region);
                          else next.delete(region);
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
              Test connection
            </Button>

            {testResult && (
              <p className={cn('text-sm', testResult.success ? 'text-resilience-high' : 'text-severity-critical')}>
                {testResult.success ? 'OK' : 'KO'} - {testResult.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveProvider(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveProvider}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  const renderModeStep = () => (
    <div className="grid gap-4 lg:grid-cols-2">
      {__DEMO_ENABLED__ && DemoOnboarding ? (
        <Card
          className={cn('cursor-pointer border-2 transition-all', mode === 'demo' ? 'border-primary' : 'border-transparent')}
          onClick={() => {
            setMode('demo');
            setDemoCompleted(false);
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <DatabaseZap className="h-5 w-5 text-primary" />
              Demo onboarding (recommended)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Loads a complete environment with a selectable company profile.</p>
            <p>Automatically triggers graph analysis, BIA, risks, simulations, incidents, runbook, and PRA exercise.</p>
            <p>Only available in development/demo contexts.</p>
          </CardContent>
        </Card>
      ) : null}

      <Card
        className={cn('cursor-pointer border-2 transition-all', mode === 'scan' ? 'border-primary' : 'border-transparent')}
        onClick={() => setMode('scan')}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ServerCog className="h-5 w-5 text-primary" />
            Connect and scan your infra
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Configure cloud and network connectors.</p>
          <p>Launch a tenant-scoped discovery scan.</p>
          <p>Use this path for real infrastructure data.</p>
        </CardContent>
      </Card>

      <div className="flex justify-end lg:col-span-2">
        {mode === 'demo' && __DEMO_ENABLED__ && DemoOnboarding ? (
          <Button
            onClick={() => {
              setDemoCompleted(false);
              setStep(2);
            }}
          >
            <ArrowRight className="mr-2 h-4 w-4" />
            Configure demo profile
          </Button>
        ) : (
          <Button onClick={() => setStep(2)}>
            Configure connectors
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );

  const renderScanStep = () => (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const isConfigured = configuredProviders.includes(provider.id);
          return (
            <Card
              key={provider.id}
              className={cn('cursor-pointer transition-all hover:shadow-md', isConfigured && 'border-primary')}
              onClick={() => {
                const existingConfig = providerConfigs[provider.id];
                setCredentials(existingConfig?.credentials || {});
                setSelectedRegions(new Set(existingConfig?.regions || []));
                setActiveProvider(provider);
                setTestResult(null);
              }}
            >
              <CardContent className="flex flex-col items-center p-6 text-center">
                <provider.icon className="mb-3 h-10 w-10 text-primary" />
                <h3 className="font-semibold">{provider.label}</h3>
                {isConfigured ? (
                  <div className="mt-2 flex items-center gap-1 text-sm text-resilience-high">
                    <Check className="h-4 w-4" /> Configure
                  </div>
                ) : (
                  <Badge variant="outline" className="mt-2 text-muted-foreground">
                    Non configure
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {configuredProviders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connecteurs configures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {configuredProviderLabels.map((label) => (
              <p key={label}>
                <Check className="mr-1 inline h-4 w-4 text-resilience-high" />
                {label}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        Vous pourrez ajouter d'autres sources plus tard depuis les Parametres.
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setStep(1)}>
          Back
        </Button>
        <Button onClick={() => launchScanMutation.mutate()} disabled={!canLaunchScan}>
          {launchScanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Lancer le scan
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8">
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <Shield className="h-12 w-12 text-primary" />
        </div>
        <h1 className="text-3xl font-bold">Welcome to Stronghold</h1>
        <p className="mt-2 text-muted-foreground">
          Configure your tenant with a guided onboarding flow, then move directly to resilience analysis.
        </p>
      </div>

      <StepIndicator steps={flowSteps} />

      {step === 1 ? renderModeStep() : null}

      {mode === 'demo' && step >= 2 && __DEMO_ENABLED__ && DemoOnboarding ? (
        <Suspense fallback={<div className="text-center text-sm text-muted-foreground">Chargement...</div>}>
          <DemoOnboarding
            step={step}
            onStepChange={setStep}
            onCompletedChange={setDemoCompleted}
          />
        </Suspense>
      ) : null}

      {mode === 'scan' && step === 2 ? renderScanStep() : null}

      {renderProviderDialog()}
    </div>
  );
}

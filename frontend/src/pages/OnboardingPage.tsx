import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Shield,
  Cloud,
  Box,
  Github,
  Network,
  Check,
  Loader2,
  Plus,
  Rocket,
  ArrowRight,
  DatabaseZap,
  ServerCog,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { StepIndicator } from '@/components/layout/StepIndicator';
import { discoveryApi, type DemoOnboardingResponse } from '@/api/discovery.api';
import { useDiscoveryStore } from '@/stores/discovery.store';
import { cn } from '@/lib/utils';

type OnboardingMode = 'demo' | 'scan';

type StoredProviderConfig = {
  credentials: Record<string, string>;
  regions: string[];
};

interface ProviderInfo {
  id: string;
  label: string;
  icon: LucideIcon;
  fields: { name: string; label: string; type: string; required: boolean }[];
  regions?: string[];
}

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
    ],
  },
  {
    id: 'gcp',
    label: 'GCP',
    icon: Cloud,
    fields: [
      { name: 'serviceAccountJson', label: 'Service Account JSON', type: 'text', required: true },
    ],
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

function parseApiError(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    (error as { response?: { data?: { error?: string } } }).response?.data?.error
  ) {
    return (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;
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
  const queryClient = useQueryClient();
  const { configuredProviders, addConfiguredProvider } = useDiscoveryStore();

  const [mode, setMode] = useState<OnboardingMode>('demo');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [activeProvider, setActiveProvider] = useState<ProviderInfo | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [providerConfigs, setProviderConfigs] = useState<Record<string, StoredProviderConfig>>({});
  const [demoSummary, setDemoSummary] = useState<DemoOnboardingResponse | null>(null);

  const testMutation = useMutation({
    mutationFn: ({ provider, creds }: { provider: string; creds: Record<string, string> }) =>
      discoveryApi.testCredentials(provider, creds),
    onSuccess: (res) => setTestResult({ success: res.data.success, message: res.data.message }),
    onError: () => setTestResult({ success: false, message: 'Connection test failed' }),
  });

  const launchScanMutation = useMutation({
    mutationFn: async () => {
      const cloudProviders = configuredProviders
        .filter((providerId) => providerId === 'aws' || providerId === 'azure' || providerId === 'gcp')
        .map((providerId) => {
          const config = providerConfigs[providerId];
          return {
            type: providerId,
            credentials: config?.credentials || {},
            regions: config?.regions || [],
          };
        });

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

  const seedDemoMutation = useMutation({
    mutationFn: () => discoveryApi.seedDemo(),
    onMutate: () => {
      setStep(2);
      setDemoSummary(null);
    },
    onSuccess: async (res) => {
      setDemoSummary(res.data);
      setStep(3);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['graph'] }),
        queryClient.invalidateQueries({ queryKey: ['financial-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['simulations'] }),
        queryClient.invalidateQueries({ queryKey: ['incidents'] }),
      ]);
      toast.success('Demo onboarding completed');
    },
    onError: (error) => {
      toast.error(parseApiError(error, 'Unable to load demo onboarding'));
      setStep(1);
    },
  });

  const flowSteps = useMemo(() => {
    if (mode === 'demo') {
      return [
        { label: 'Mode', completed: step > 1, active: step === 1 },
        { label: 'Execution', completed: step > 2, active: step === 2 },
        { label: 'Result', completed: Boolean(demoSummary), active: step === 3 },
      ];
    }

    return [
      { label: 'Mode', completed: step > 1, active: step === 1 },
      { label: 'Connectors', completed: false, active: step === 2 },
      { label: 'Scan', completed: false, active: false },
    ];
  }, [demoSummary, mode, step]);

  const configuredProviderLabels = configuredProviders.map(
    (providerId) => PROVIDERS.find((provider) => provider.id === providerId)?.label || providerId,
  );

  const canLaunchScan = configuredProviders.length > 0 && !launchScanMutation.isPending;

  const handleSaveProvider = () => {
    if (!activeProvider) return;

    const sanitized = sanitizeCredentials(credentials);
    if (!hasRequiredFields(activeProvider, sanitized)) {
      toast.error('Please fill all required fields for this provider');
      return;
    }

    addConfiguredProvider(activeProvider.id);
    setProviderConfigs((previous) => ({
      ...previous,
      [activeProvider.id]: {
        credentials: sanitized,
        regions: Array.from(selectedRegions),
      },
    }));

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
      <Card
        className={cn('cursor-pointer border-2 transition-all', mode === 'demo' ? 'border-primary' : 'border-transparent')}
        onClick={() => setMode('demo')}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <DatabaseZap className="h-5 w-5 text-primary" />
            Demo onboarding (recommended)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Loads a complete e-commerce environment in one action.</p>
          <p>Automatically triggers graph analysis, BIA, risks, simulations, incidents, runbook, and PRA exercise.</p>
          <p>Only available in development/demo contexts.</p>
        </CardContent>
      </Card>

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

      <div className="lg:col-span-2 flex justify-end">
        {mode === 'demo' ? (
          <Button onClick={() => seedDemoMutation.mutate()} disabled={seedDemoMutation.isPending}>
            {seedDemoMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
            Start demo onboarding
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

  const renderDemoExecution = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Rocket className="h-5 w-5 text-primary" />
          Running demo onboarding
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>The workflow runs in sequence: seed, analyses, then generated artifacts.</p>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="font-medium text-foreground">Expected generated assets</p>
          <ul className="mt-2 space-y-1">
            <li>Infrastructure graph + dependencies</li>
            <li>Graph analysis, BIA entries, and detected risks</li>
            <li>Business flows and financial profile</li>
            <li>Incidents linked to seeded services/nodes</li>
            <li>Simulations, active runbook, and completed PRA exercise</li>
          </ul>
        </div>
        <Button
          onClick={() => seedDemoMutation.mutate()}
          disabled={seedDemoMutation.isPending}
          className="w-full"
        >
          {seedDemoMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
          {seedDemoMutation.isPending ? 'Executing...' : 'Run demo onboarding now'}
        </Button>
      </CardContent>
    </Card>
  );

  const renderDemoSummary = () => {
    if (!demoSummary) return null;

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Demo onboarding completed</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryTile label="Nodes" value={String(demoSummary.nodes)} />
            <SummaryTile label="Edges" value={String(demoSummary.totalEdges)} />
            <SummaryTile label="BIA" value={String(demoSummary.biaProcesses)} />
            <SummaryTile label="Risks" value={String(demoSummary.risksDetected)} />
            <SummaryTile label="Incidents" value={String(demoSummary.incidentsSeeded)} />
            <SummaryTile label="Simulations" value={String(demoSummary.simulationsSeeded)} />
            <SummaryTile label="Runbooks" value={String(demoSummary.runbooksSeeded)} />
            <SummaryTile label="PRA exercises" value={String(demoSummary.praExercisesSeeded)} />
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
                <span className={cn('text-xs', pipelineStep.status === 'completed' ? 'text-resilience-high' : 'text-severity-critical')}>
                  {pipelineStep.status} - {pipelineStep.durationMs} ms
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Total duration: {demoSummary.durationMs} ms / Budget: {demoSummary.performanceBudgetMs} ms ({demoSummary.withinPerformanceBudget ? 'OK' : 'EXCEEDED'})
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate('/discovery')}>Open Discovery</Button>
          <Button variant="outline" onClick={() => navigate('/finance')}>Open Finance</Button>
          <Button variant="ghost" onClick={() => setStep(1)}>Restart onboarding</Button>
        </div>
      </div>
    );
  };

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
                    <Check className="h-4 w-4" /> Configured
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                    <Plus className="h-4 w-4" /> Add
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {configuredProviders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configured connectors</CardTitle>
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

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setStep(1)}>
          Back
        </Button>
        <Button onClick={() => launchScanMutation.mutate()} disabled={!canLaunchScan}>
          {launchScanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Launch scan
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
      {mode === 'demo' && step === 2 ? renderDemoExecution() : null}
      {mode === 'demo' && step === 3 ? renderDemoSummary() : null}
      {mode === 'scan' && step === 2 ? renderScanStep() : null}

      {renderProviderDialog()}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

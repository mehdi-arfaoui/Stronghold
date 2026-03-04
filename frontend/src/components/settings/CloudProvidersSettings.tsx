import { useEffect, useMemo, useState } from 'react';
import { Cloud, Loader2, Plus, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { discoveryApi } from '@/api/discovery.api';
import {
  CLOUD_PROVIDER_DEFINITIONS,
  loadCloudProviderConfigs,
  removeCloudProviderConfig,
  saveCloudProviderConfigs,
  validateCloudProviderConfig,
  type CloudProviderConfigMap,
  type CloudProviderDefinition,
  type CloudProviderId,
} from '@/lib/cloudProviderConfigs';

function sanitizeCredentials(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, String(value ?? '').trim()])
      .filter(([, value]) => value.length > 0),
  );
}

type Props = {
  tenantScope: string;
};

export function CloudProvidersSettings({ tenantScope }: Props) {
  const [providerConfigs, setProviderConfigs] = useState<CloudProviderConfigMap>({});
  const [activeProvider, setActiveProvider] = useState<CloudProviderDefinition | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [testingProvider, setTestingProvider] = useState<CloudProviderId | null>(null);

  useEffect(() => {
    setProviderConfigs(loadCloudProviderConfigs(tenantScope));
  }, [tenantScope]);

  const configuredCount = useMemo(
    () =>
      CLOUD_PROVIDER_DEFINITIONS.filter((provider) => {
        const config = providerConfigs[provider.id];
        if (!config) return false;
        return validateCloudProviderConfig(provider.id, config.credentials).valid;
      }).length,
    [providerConfigs],
  );

  const testConnectionMutation = useMutation({
    mutationFn: async (payload: { provider: CloudProviderId; credentials: Record<string, string> }) => {
      return discoveryApi.testCredentials(payload.provider, payload.credentials);
    },
    onSuccess: (res) => {
      toast.success(res.data.message || 'Connexion validée');
    },
    onError: (error: unknown) => {
      const message =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        (error as { response?: { data?: { message?: string; error?: string } } }).response?.data
          ? (error as { response?: { data?: { message?: string; error?: string } } }).response?.data?.message ||
            (error as { response?: { data?: { message?: string; error?: string } } }).response?.data?.error ||
            'Test de connexion en échec'
          : 'Test de connexion en échec';
      toast.error(message);
    },
    onSettled: () => setTestingProvider(null),
  });

  const openProviderDialog = (provider: CloudProviderDefinition) => {
    const existing = providerConfigs[provider.id];
    setCredentials(existing?.credentials || {});
    setSelectedRegions(new Set(existing?.regions || []));
    setActiveProvider(provider);
  };

  const saveProviderConfig = () => {
    if (!activeProvider) return;
    const sanitized = sanitizeCredentials(credentials);
    const validation = validateCloudProviderConfig(activeProvider.id, sanitized);
    if (!validation.valid) {
      toast.error(validation.reason);
      return;
    }

    const next: CloudProviderConfigMap = {
      ...providerConfigs,
      [activeProvider.id]: {
        credentials: sanitized,
        regions: Array.from(selectedRegions),
      },
    };
    setProviderConfigs(next);
    saveCloudProviderConfigs(next, tenantScope);
    toast.success(`${activeProvider.label} configuré`);
    setActiveProvider(null);
    setCredentials({});
    setSelectedRegions(new Set());
  };

  const removeProvider = (provider: CloudProviderId) => {
    const next = removeCloudProviderConfig(provider, tenantScope);
    setProviderConfigs(next);
    toast.success(`${provider.toUpperCase()} supprimé`);
  };

  const testProvider = (provider: CloudProviderId, sourceCredentials?: Record<string, string>) => {
    const rawCredentials = sourceCredentials || providerConfigs[provider]?.credentials || {};
    const sanitized = sanitizeCredentials(rawCredentials);
    const validation = validateCloudProviderConfig(provider, sanitized);
    if (!validation.valid) {
      toast.error(validation.reason);
      return;
    }
    setTestingProvider(provider);
    testConnectionMutation.mutate({ provider, credentials: sanitized });
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {configuredCount}/{CLOUD_PROVIDER_DEFINITIONS.length} fournisseur(s) configuré(s). Chaque fournisseur est géré
          indépendamment et peut être testé avant un scan complet.
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {CLOUD_PROVIDER_DEFINITIONS.map((provider) => {
          const config = providerConfigs[provider.id];
          const isConfigured = Boolean(config && validateCloudProviderConfig(provider.id, config.credentials).valid);
          return (
            <Card key={provider.id} className={isConfigured ? 'border-primary/40' : undefined}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2">
                    <Cloud className="h-4 w-4 text-primary" />
                    {provider.label}
                  </span>
                  {isConfigured ? (
                    <Badge className="gap-1 bg-resilience-high/10 text-resilience-high">
                      <Check className="h-3 w-3" /> Configuré
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Non configuré
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full" onClick={() => openProviderDialog(provider)}>
                  {isConfigured ? 'Modifier' : 'Configurer'}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!isConfigured || testingProvider === provider.id}
                  onClick={() => testProvider(provider.id)}
                >
                  {testingProvider === provider.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Tester la connexion
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-severity-critical"
                  disabled={!isConfigured}
                  onClick={() => removeProvider(provider.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Supprimer
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {activeProvider && (
        <Dialog open onOpenChange={() => setActiveProvider(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Configurer {activeProvider.label}</DialogTitle>
              <DialogDescription>Les identifiants sont enregistrés pour ce tenant uniquement.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {activeProvider.fields.map((field) => (
                <div key={field.name} className="space-y-1">
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
                <div className="space-y-2">
                  <Label>Régions</Label>
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
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => testProvider(activeProvider.id, credentials)}
                disabled={testingProvider === activeProvider.id}
              >
                {testingProvider === activeProvider.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Tester la connexion
              </Button>
              <Button onClick={saveProviderConfig}>
                <Plus className="mr-2 h-4 w-4" />
                Enregistrer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

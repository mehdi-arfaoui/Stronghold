import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BIATable } from '@/components/bia/BIATable';
import { BIAValidation } from '@/components/bia/BIAValidation';
import { RecoveryTierCard } from '@/components/bia/RecoveryTierCard';
import { RiskMatrix } from '@/components/dashboard/RiskMatrix';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import { LoadingState } from '@/components/common/LoadingState';
import { ValidateAllButton } from '@/components/analysis/ValidateAllButton';
import { ExportPanel } from '@/components/analysis/ExportPanel';
import { RedundancyGraph } from '@/components/analysis/RedundancyGraph';
import { biaApi } from '@/api/bia.api';
import { risksApi } from '@/api/risks.api';
import { analysisApi } from '@/api/analysis.api';
import { financialApi } from '@/api/financial.api';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import type { Risk } from '@/types/risks.types';
import type { BIAEntry } from '@/types/bia.types';

export function AnalysisPage() {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();
  const [exportOpen, setExportOpen] = useState(false);

  const biaQuery = useQuery({
    queryKey: ['bia-entries', tenantScope],
    queryFn: async () => (await biaApi.getEntries()).data,
  });

  const biaSummaryQuery = useQuery({
    queryKey: ['bia-summary', tenantScope],
    queryFn: async () => (await biaApi.getSummary()).data,
  });

  const orgProfileQuery = useQuery({
    queryKey: ['financial-org-profile', tenantScope],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
  });

  const risksQuery = useQuery({
    queryKey: ['risks'],
    queryFn: async () => (await risksApi.getRisks()).data,
  });

  const redundancyQuery = useQuery({
    queryKey: ['redundancy'],
    queryFn: async () => (await analysisApi.getRedundancy()).data,
  });

  const regionalQuery = useQuery({
    queryKey: ['regional-concentration'],
    queryFn: async () => (await analysisApi.getRegionalConcentration()).data,
  });

  const updateEntryMutation = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: string; value: number }) =>
      biaApi.updateEntry(id, { [field]: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bia-entries', tenantScope] }),
  });

  const validateEntryMutation = useMutation({
    mutationFn: (id: string) => biaApi.validateEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bia-entries', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['bia-summary', tenantScope] });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => biaApi.regenerate(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bia-entries', tenantScope] });
      toast.success('BIA regenere');
    },
  });

  const upsertFinancialOverrideMutation = useMutation({
    mutationFn: ({ nodeId, customCostPerHour, justification }: { nodeId: string; customCostPerHour: number; justification?: string }) =>
      financialApi.upsertNodeOverride(nodeId, { customCostPerHour, justification }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bia-entries', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['financial-summary', tenantScope] });
      toast.success('Override financier enregistre');
    },
    onError: () => toast.error('Impossible d enregistrer l override financier'),
  });

  const biaRaw: unknown = biaQuery.data;
  const entries = (Array.isArray(biaRaw)
    ? biaRaw
    : (biaRaw != null && typeof biaRaw === 'object' && 'entries' in biaRaw && Array.isArray((biaRaw as Record<string, unknown>).entries))
      ? ((biaRaw as Record<string, unknown>).entries as unknown[])
      : []) as BIAEntry[];
  const currencyCode = String(orgProfileQuery.data?.customCurrency ?? 'EUR').toUpperCase();
  const currencySymbol = currencyCode === 'USD' ? '$' : currencyCode === 'GBP' ? '\u00A3' : currencyCode === 'CHF' ? 'CHF ' : '\u20AC';
  const summary = biaSummaryQuery.data;
  const risks: Risk[] = Array.isArray(risksQuery.data) ? risksQuery.data : [];
  const redundancy = redundancyQuery.data ?? [];
  const regional = regionalQuery.data ?? [];

  if (biaQuery.isLoading || risksQuery.isLoading) {
    return <LoadingState message="Chargement de l'analyse..." />;
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="bia">
        <TabsList>
          <TabsTrigger value="bia">BIA</TabsTrigger>
          <TabsTrigger value="risks">Risques</TabsTrigger>
          <TabsTrigger value="redundancy">Redondance</TabsTrigger>
          <TabsTrigger value="regional">Concentration regionale</TabsTrigger>
        </TabsList>

        {/* BIA Tab */}
        <TabsContent value="bia" className="space-y-6">
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" /> Regenerer le BIA
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <Download className="mr-2 h-4 w-4" /> Exporter
            </Button>
            <ValidateAllButton
              entries={entries.map((e: { id: string; serviceName: string; validationStatus?: string }) => ({
                id: e.id,
                serviceName: e.serviceName,
                validationStatus: e.validationStatus,
              }))}
            />
          </div>

          {/* Export Panel (Drawer) */}
          <ExportPanel
            open={exportOpen}
            onOpenChange={setExportOpen}
            totalRows={entries.length}
          />

          {summary && (
            <BIAValidation totalServices={summary.totalServices} validatedCount={summary.validatedCount} />
          )}

          <Card>
            <CardContent className="p-0">
              <BIATable
                entries={entries}
                currencySymbol={currencySymbol}
                onUpdateEntry={(id, field, value) => updateEntryMutation.mutate({ id, field, value })}
                onValidateEntry={(id) => validateEntryMutation.mutate(id)}
                onUpsertFinancialOverride={(nodeId, payload) =>
                  upsertFinancialOverrideMutation.mutateAsync({
                    nodeId,
                    customCostPerHour: payload.customCostPerHour,
                    justification: payload.justification,
                  })
                }
                savingFinancialNodeId={upsertFinancialOverrideMutation.variables?.nodeId ?? null}
              />
            </CardContent>
          </Card>

          {summary && Array.isArray(summary.tiers) && summary.tiers.length > 0 && (
            <div className="grid gap-4 md:grid-cols-3">
              {summary.tiers.map((tier) => (
                <RecoveryTierCard
                  key={tier.tier}
                  tier={tier.tier}
                  label={tier.label}
                  rtoRange={tier.maxRTO}
                  serviceCount={tier.serviceCount}
                  financialImpact={tier.totalFinancialImpact}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Risks Tab */}
        <TabsContent value="risks" className="space-y-6">
          {risks.length > 0 && <RiskMatrix risks={risks} />}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Liste des risques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {risks.map((risk: Risk) => (
                <div key={risk.id} className="rounded-lg border p-4">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={risk.severity} />
                    <h4 className="font-semibold">{risk.title}</h4>
                    {risk.autoDetected && <span className="text-xs text-muted-foreground">(auto-detecte)</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{risk.description}</p>
                  {(risk.mitigations ?? []).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {risk.mitigations.map((m) => (
                        <p key={m.id} className="text-xs text-muted-foreground">- {m.description} ({m.status})</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {risks.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucun risque detecte. Lancez une analyse pour identifier les risques.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Redundancy Tab - Enhanced with RedundancyGraph */}
        <TabsContent value="redundancy" className="space-y-6">
          <RedundancyGraph data={redundancy} />
        </TabsContent>

        {/* Regional Tab */}
        <TabsContent value="regional" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Concentration regionale</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {regional.map((item) => (
                  <div key={`${item.provider}-${item.region}`} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium">{item.region}</p>
                      <p className="text-xs text-muted-foreground">{item.provider}</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span>{item.nodeCount} noeuds ({Math.round(item.percentage)}%)</span>
                      <span>{item.criticalNodeCount} critiques</span>
                      <SeverityBadge severity={item.risk === 'high' ? 'high' : item.risk === 'medium' ? 'medium' : 'low'} />
                    </div>
                  </div>
                ))}
                {regional.length === 0 && (
                  <p className="text-sm text-muted-foreground">Aucune donnee regionale disponible.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw, Download, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BIATable } from '@/components/bia/BIATable';
import { BIAValidation } from '@/components/bia/BIAValidation';
import { RecoveryTierCard } from '@/components/bia/RecoveryTierCard';
import { RiskMatrix } from '@/components/dashboard/RiskMatrix';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import { LoadingState } from '@/components/common/LoadingState';
import { biaApi } from '@/api/bia.api';
import { risksApi } from '@/api/risks.api';
import { analysisApi } from '@/api/analysis.api';
import type { Risk } from '@/types/risks.types';

export function AnalysisPage() {
  const queryClient = useQueryClient();

  const biaQuery = useQuery({
    queryKey: ['bia-entries'],
    queryFn: async () => (await biaApi.getEntries()).data,
  });

  const biaSummaryQuery = useQuery({
    queryKey: ['bia-summary'],
    queryFn: async () => (await biaApi.getSummary()).data,
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bia-entries'] }),
  });

  const validateEntryMutation = useMutation({
    mutationFn: (id: string) => biaApi.validateEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bia-entries'] });
      queryClient.invalidateQueries({ queryKey: ['bia-summary'] });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => biaApi.regenerate(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bia-entries'] });
      toast.success('BIA regenere');
    },
  });

  const validateAllMutation = useMutation({
    mutationFn: () => biaApi.validateAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bia-entries'] });
      queryClient.invalidateQueries({ queryKey: ['bia-summary'] });
      toast.success('Toutes les entrees validees');
    },
  });

  const entries = biaQuery.data ?? [];
  const summary = biaSummaryQuery.data;
  const risks = risksQuery.data ?? [];
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
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" /> Regenerer le BIA
            </Button>
            <Button variant="outline" size="sm" onClick={() => { biaApi.exportCSV(); }}>
              <Download className="mr-2 h-4 w-4" /> Exporter CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => validateAllMutation.mutate()}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Valider tout
            </Button>
          </div>

          {summary && (
            <BIAValidation totalServices={summary.totalServices} validatedCount={summary.validatedCount} />
          )}

          <Card>
            <CardContent className="p-0">
              <BIATable
                entries={entries}
                onUpdateEntry={(id, field, value) => updateEntryMutation.mutate({ id, field, value })}
                onValidateEntry={(id) => validateEntryMutation.mutate(id)}
              />
            </CardContent>
          </Card>

          {summary && summary.tiers.length > 0 && (
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
                  {risk.mitigations.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {risk.mitigations.map((m) => (
                        <p key={m.id} className="text-xs text-muted-foreground">— {m.description} ({m.status})</p>
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

        {/* Redundancy Tab */}
        <TabsContent value="redundancy" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Analyse de redondance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {redundancy.map((item) => (
                  <div key={item.nodeId} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium">{item.nodeName}</p>
                      <p className="text-xs text-muted-foreground">{item.nodeType}</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span>Score: {item.redundancyScore}/100</span>
                      <span>Multi-AZ: {item.multiAZ ? 'Oui' : 'Non'}</span>
                      <span>Replicas: {item.replicas}</span>
                    </div>
                  </div>
                ))}
                {redundancy.length === 0 && (
                  <p className="text-sm text-muted-foreground">Aucune donnee de redondance disponible.</p>
                )}
              </div>
            </CardContent>
          </Card>
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

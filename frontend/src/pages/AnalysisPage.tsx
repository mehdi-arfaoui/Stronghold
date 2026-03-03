import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Download, ExternalLink, FilterX, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { discoveryApi } from '@/api/discovery.api';
import { risksApi } from '@/api/risks.api';
import { analysisApi } from '@/api/analysis.api';
import { financialApi } from '@/api/financial.api';
import { useLicense } from '@/hooks/useLicense';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import {
  filterRisks,
  getRiskCriticityLabel,
  getRiskCriticityLevel,
  getRiskScore,
  type RiskCellFilter,
  type RiskCriticityLevel,
} from '@/lib/riskAnalysis';
import type { Risk } from '@/types/risks.types';
import type { BIAEntry } from '@/types/bia.types';

const DEFAULT_RISK_LEVELS: RiskCriticityLevel[] = ['critical', 'high', 'medium', 'low'];

const RISK_LEVEL_STYLES: Record<RiskCriticityLevel, string> = {
  critical: 'border-severity-critical bg-severity-critical/10 text-severity-critical',
  high: 'border-severity-high bg-severity-high/10 text-severity-high',
  medium: 'border-severity-medium bg-severity-medium/10 text-severity-medium',
  low: 'border-severity-low bg-severity-low/10 text-severity-low',
};

function RiskCriticityBadge({ level, score }: { level: RiskCriticityLevel; score: number }) {
  return (
    <Badge variant="outline" className={RISK_LEVEL_STYLES[level]}>
      {getRiskCriticityLabel(level)} - {score}
    </Badge>
  );
}

export function AnalysisPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();
  const { hasFeature } = useLicense();
  const [exportOpen, setExportOpen] = useState(false);
  const [activeRiskLevels, setActiveRiskLevels] = useState<RiskCriticityLevel[]>(DEFAULT_RISK_LEVELS);
  const [selectedRiskCell, setSelectedRiskCell] = useState<RiskCellFilter | null>(null);
  const [expandedRiskIds, setExpandedRiskIds] = useState<string[]>([]);
  const riskListRef = useRef<HTMLDivElement | null>(null);

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

  const riskGraphQuery = useQuery({
    queryKey: ['risk-graph', tenantScope],
    queryFn: async () => (await discoveryApi.getGraph()).data,
    staleTime: 60_000,
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
  const summary = biaSummaryQuery.data;
  const risks: Risk[] = Array.isArray(risksQuery.data) ? risksQuery.data : [];
  const redundancy = redundancyQuery.data ?? [];
  const regional = regionalQuery.data ?? [];
  const nodeNameById = useMemo(
    () => new Map((riskGraphQuery.data?.nodes ?? []).map((node) => [node.id, node.name])),
    [riskGraphQuery.data],
  );
  const filteredRisks = useMemo(
    () => filterRisks(risks, activeRiskLevels, selectedRiskCell),
    [activeRiskLevels, risks, selectedRiskCell],
  );

  const toggleRiskLevel = (level: RiskCriticityLevel) => {
    setActiveRiskLevels((current) =>
      current.includes(level)
        ? current.filter((entry) => entry !== level)
        : [...current, level].sort(
            (left, right) => DEFAULT_RISK_LEVELS.indexOf(left) - DEFAULT_RISK_LEVELS.indexOf(right),
          ),
    );
  };

  const toggleMitigations = (riskId: string) => {
    setExpandedRiskIds((current) =>
      current.includes(riskId) ? current.filter((entry) => entry !== riskId) : [...current, riskId],
    );
  };

  const handleRiskCellClick = (probability: number, impact: number) => {
    setSelectedRiskCell((current) =>
      current?.probability === probability && current.impact === impact
        ? null
        : { probability, impact },
    );
    window.requestAnimationFrame(() => {
      riskListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openDiscoveryForNode = (nodeId: string) => {
    navigate(`/discovery?focus=${encodeURIComponent(nodeId)}`);
  };

  if (biaQuery.isLoading || risksQuery.isLoading) {
    return <LoadingState variant="skeleton" message="Chargement de l'analyse..." count={5} />;
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
            {hasFeature('api-export') ? (
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                <Download className="mr-2 h-4 w-4" /> Exporter
              </Button>
            ) : null}
            <ValidateAllButton
              entries={entries.map((e: { id: string; serviceName: string; validationStatus?: string }) => ({
                id: e.id,
                serviceName: e.serviceName,
                validationStatus: e.validationStatus,
              }))}
            />
          </div>

          {!hasFeature('api-export') ? (
            <UpgradePrompt feature="Exports BIA" requiredPlan="Pro" />
          ) : null}

          {hasFeature('api-export') ? (
            <ExportPanel
              open={exportOpen}
              onOpenChange={setExportOpen}
              totalRows={entries.length}
            />
          ) : null}

          {/* TODO: add frontend compliance mapping views when the corresponding UI is finalized. */}

          {summary && (
            <BIAValidation totalServices={summary.totalServices} validatedCount={summary.validatedCount} />
          )}

          {orgProfileQuery.data?.mode === 'business_profile' ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Profil financier configure. Les couts/h utilisent le profil global sauf override personnalise.
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <span>
                Calculs bases sur les couts d infrastructure uniquement. Configurez votre profil financier pour l impact business.
              </span>
              <Button variant="outline" size="sm" onClick={() => navigate('/settings?tab=finance')}>
                Configurer
              </Button>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <BIATable
                entries={entries}
                currency={currencyCode}
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
                  currency={currencyCode}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Risks Tab */}
        <TabsContent value="risks" className="space-y-6">
          {risks.length > 0 && (
            <RiskMatrix
              risks={risks}
              onCellClick={handleRiskCellClick}
              activeCell={selectedRiskCell}
            />
          )}
          <Card ref={riskListRef}>
            <CardHeader>
              <CardTitle className="text-base">Liste des risques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {DEFAULT_RISK_LEVELS.map((level) => (
                    <Button
                      key={level}
                      type="button"
                      size="sm"
                      variant={activeRiskLevels.includes(level) ? 'default' : 'outline'}
                      onClick={() => toggleRiskLevel(level)}
                    >
                      {getRiskCriticityLabel(level)}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{filteredRisks.length} risque(s) affiche(s) sur {risks.length}</span>
                  {selectedRiskCell && (
                    <Badge variant="outline">
                      Impact {selectedRiskCell.impact} / Proba {selectedRiskCell.probability}
                    </Badge>
                  )}
                  {selectedRiskCell && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedRiskCell(null)}>
                      <FilterX className="mr-2 h-4 w-4" />
                      Retirer le filtre matrice
                    </Button>
                  )}
                </div>
              </div>

              {filteredRisks.map((risk: Risk) => {
                const score = getRiskScore(risk);
                const criticityLevel = getRiskCriticityLevel(score);
                const isExpanded = expandedRiskIds.includes(risk.id);

                return (
                  <div key={risk.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <RiskCriticityBadge level={criticityLevel} score={score} />
                          <SeverityBadge severity={risk.severity} />
                          <h4 className="truncate font-semibold">{risk.title}</h4>
                          {risk.autoDetected && <span className="text-xs text-muted-foreground">(auto-detecte)</span>}
                        </div>
                        <p className="line-clamp-3 text-sm text-muted-foreground">{risk.description}</p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>Impact {risk.impact}</p>
                        <p>Probabilite {risk.probability}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(risk.relatedNodes ?? []).length > 0 ? (
                        risk.relatedNodes.map((nodeId) => (
                          <Button
                            key={`${risk.id}-${nodeId}`}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => openDiscoveryForNode(nodeId)}
                          >
                            {nodeNameById.get(nodeId) || nodeId}
                            <ExternalLink className="ml-2 h-3.5 w-3.5" />
                          </Button>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">Aucun service rattache.</span>
                      )}
                    </div>

                    {(risk.mitigations ?? []).length > 0 && (
                      <div className="mt-3 space-y-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => toggleMitigations(risk.id)}>
                          {isExpanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
                          {isExpanded ? 'Masquer' : 'Afficher'} les mitigations ({risk.mitigations.length})
                        </Button>
                        {isExpanded && (
                          <div className="space-y-1 rounded-md border bg-muted/20 p-3">
                            {risk.mitigations.map((mitigation) => (
                              <p key={mitigation.id} className="text-sm text-muted-foreground">
                                - {mitigation.description} ({mitigation.status})
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {risks.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucun risque detecte. Lancez une analyse pour identifier les risques.</p>
              )}
              {risks.length > 0 && filteredRisks.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Aucun risque ne correspond aux filtres actifs.
                </p>
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

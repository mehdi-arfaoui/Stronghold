import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScenarioSelector } from '@/components/simulation/ScenarioSelector';
import { RecoveryPriorityKanban } from '@/components/simulation/RecoveryPriorityKanban';
import { SimulationResult } from '@/components/simulation/SimulationResult';
import { CascadeView } from '@/components/simulation/CascadeView';
import { BeforeAfterGraph } from '@/components/simulation/BeforeAfterGraph';
import { WarRoom } from '@/components/simulations/WarRoom';
import { BlastRadiusDrawer } from '@/components/simulations/BlastRadiusDrawer';
import { LoadingState } from '@/components/common/LoadingState';
import { useSimulation } from '@/hooks/useSimulation';
import { useGraph } from '@/hooks/useGraph';
import { discoveryApi } from '@/api/discovery.api';
import { simulationsApi } from '@/api/simulations.api';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ScenarioTemplate, SimulationConfig } from '@/types/simulation.types';

type SimulationSubView = 'library' | 'priorities' | 'history';

function mapScenarioToEngine(template: ScenarioTemplate, customParams: Record<string, unknown>, availableNodeIds: string[]): SimulationConfig {
  if (template.id === 'complete-region-loss') {
    return { scenarioType: 'region_loss', name: template.name, params: { region: customParams.region ?? 'unknown-region' } };
  }
  if (template.id === 'availability-zone-loss') {
    return { scenarioType: 'az_loss', name: template.name, params: { az: customParams.az ?? 'unknown-az' } };
  }
  if (template.id.includes('ransomware')) {
    return { scenarioType: 'ransomware', name: template.name, params: { targetType: 'VM', ...customParams } };
  }
  if (template.id === 'database-corruption') {
    return { scenarioType: 'database_failure', name: template.name, params: { databases: availableNodeIds.slice(0, 2), ...customParams } };
  }
  if (template.id.includes('network-partition')) {
    return { scenarioType: 'network_partition', name: template.name, params: { vpcA: 'unknown-vpc-a', vpcB: 'unknown-vpc-b', ...customParams } };
  }
  if (template.id === 'saas-provider-outage') {
    return { scenarioType: 'third_party_outage', name: template.name, params: { service: String(customParams.provider ?? 'Cloudflare') } };
  }
  if (template.id.includes('ddos')) {
    return { scenarioType: 'dns_failure', name: template.name, params: customParams };
  }

  return { scenarioType: 'custom', name: template.name, params: { nodes: availableNodeIds.slice(0, 3), ...customParams } };
}

export function SimulationPage() {
  const [activeSimId, setActiveSimId] = useState<string | undefined>();
  const [activeView, setActiveView] = useState<SimulationSubView>('library');
  const [warRoomOpen, setWarRoomOpen] = useState(false);
  const [blastRadiusOpen, setBlastRadiusOpen] = useState(false);
  const [scenarioModalOpen, setScenarioModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ScenarioTemplate | null>(null);
  const [selectedParams, setSelectedParams] = useState<Record<string, unknown>>({});

  const { simulations, simulationsLoading, createSimulation, isCreating, simulation } = useSimulation(activeSimId);
  const { allNodes } = useGraph();

  const graphQuery = useQuery({
    queryKey: ['graph-for-simulation'],
    queryFn: async () => (await discoveryApi.getGraph()).data,
    enabled: activeSimId !== undefined && simulation?.result !== undefined,
  });

  const templateQuery = useQuery({
    queryKey: ['simulation-templates-library'],
    queryFn: async () => (await simulationsApi.getTemplates()).data.templates ?? [],
  });

  const prioritiesQuery = useQuery({
    queryKey: ['recovery-priorities'],
    queryFn: async () => (await simulationsApi.getRecoveryPriorities()).data.priorities ?? [],
  });

  const setScenarioParam = (key: string, value: unknown) => {
    setSelectedParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleLaunch = async (template: ScenarioTemplate, params: Record<string, unknown>) => {
    try {
      const availableNodeIds = (allNodes ?? []).map((node) => node.id).filter(Boolean);
      const config = mapScenarioToEngine(template, params ?? {}, availableNodeIds);
      const result = await createSimulation(config);
      if (!result) {
        throw new Error('Simulation response is empty');
      }

      setActiveSimId(result.id);
      setBlastRadiusOpen(true);
      setScenarioModalOpen(false);
      setActiveView('library');
      toast.success('Simulation lancee');
    } catch {
      toast.error('Erreur lors du lancement');
    }
  };

  if (simulationsLoading) {
    return <LoadingState message="Chargement des simulations..." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Simulation de pannes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Simulez des incidents et validez vos priorites de reprise sur la meme page.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-1">
        <div className="flex flex-wrap gap-1">
          {[
            { key: 'library', label: 'Scenario Library' },
            { key: 'priorities', label: 'Recovery Priorities' },
            { key: 'history', label: 'History' },
          ].map((tab) => (
            <Button
              key={tab.key}
              size="sm"
              variant={activeView === tab.key ? 'default' : 'ghost'}
              className={cn('h-8', activeView === tab.key && 'pointer-events-none')}
              onClick={() => setActiveView(tab.key as SimulationSubView)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {activeView === 'library' && (
        <section className="space-y-4">
          <ScenarioSelector
            templates={templateQuery.data ?? []}
            isLoading={templateQuery.isLoading}
            isLaunching={isCreating}
            libraryOnly
            onSelectTemplate={(template, params) => {
              setSelectedTemplate(template);
              setSelectedParams(params);
              setScenarioModalOpen(true);
            }}
          />

          {simulation?.result && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Resultats de simulation</h2>
                  <p className="text-sm text-muted-foreground">
                    Impact du scenario "{simulation.name}" sur votre infrastructure.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => setWarRoomOpen(true)}>
                  Ouvrir la War Room
                </Button>
              </div>

              <SimulationResult result={simulation.result} />

              {simulation.result.cascadeSteps?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Propagation en cascade</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CascadeView steps={simulation.result.cascadeSteps} />
                  </CardContent>
                </Card>
              )}

              {graphQuery.data && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Graphe avant / apres</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BeforeAfterGraph
                      nodes={graphQuery.data.nodes}
                      edges={graphQuery.data.edges}
                      affectedNodes={simulation.result.affectedNodes ?? []}
                    />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </section>
      )}

      {activeView === 'priorities' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Recovery Priorities</h2>
            <p className="text-sm text-muted-foreground">
              Organisez l'ordre de reprise selon la criticite metier.
            </p>
          </div>
          <RecoveryPriorityKanban priorities={prioritiesQuery.data ?? []} />
        </section>
      )}

      {activeView === 'history' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">History</h2>
            <p className="text-sm text-muted-foreground">
              {simulations.length} simulation{simulations.length > 1 ? 's' : ''} executee{simulations.length > 1 ? 's' : ''}
            </p>
          </div>
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Scenario</TableHead>
                    <TableHead>Impact infra</TableHead>
                    <TableHead>Score resilience</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {simulations.map((sim) => (
                    <TableRow
                      key={sim.id}
                      className="cursor-pointer"
                      onClick={() => {
                        setActiveSimId(sim.id);
                        if (sim.status === 'completed') {
                          setWarRoomOpen(true);
                        }
                      }}
                    >
                      <TableCell className="text-sm">{formatDate(sim.createdAt)}</TableCell>
                      <TableCell className="font-medium">{sim.name}</TableCell>
                      <TableCell>
                        {sim.result ? (
                          <Badge variant={sim.result.infrastructureImpact > 50 ? 'destructive' : 'secondary'}>
                            {Math.round(sim.result.infrastructureImpact)}%
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {sim.result ? (
                          <span className="text-sm">
                            {sim.result.resilienceScoreBefore} &rarr; {sim.result.resilienceScoreAfter}
                          </span>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sim.status === 'completed' ? 'default' : sim.status === 'failed' ? 'destructive' : 'secondary'}>
                          {sim.status === 'completed' ? 'Terminee' : sim.status === 'failed' ? 'Echouee' : 'En cours'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {sim.status === 'completed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSimId(sim.id);
                              setWarRoomOpen(true);
                            }}
                          >
                            War Room
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}

      <Dialog open={scenarioModalOpen} onOpenChange={setScenarioModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Scenario Detail & Launch</DialogTitle>
          </DialogHeader>
          {!selectedTemplate ? (
            <p className="text-sm text-muted-foreground">Selectionnez un scenario dans la bibliotheque.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="font-medium">{selectedTemplate.name}</p>
                <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
                {selectedTemplate.realWorldExample && (
                  <p className="mt-1 text-xs text-muted-foreground">Exemple reel : {selectedTemplate.realWorldExample}</p>
                )}
              </div>

              {(selectedTemplate.configurableParams ?? []).length > 0 && (
                <div className="space-y-3">
                  {(selectedTemplate.configurableParams ?? []).map((param) => {
                    const value = selectedParams[param.key] ?? param.default;
                    return (
                      <div key={param.key} className="space-y-1">
                        <Label>{param.label}</Label>
                        {param.type === 'select' && (
                          <Select value={String(value ?? '')} onValueChange={(val) => setScenarioParam(param.key, val)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(param.options ?? []).map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        {param.type === 'number' && (
                          <Input
                            type="number"
                            value={Number(value ?? 0)}
                            onChange={(e) => setScenarioParam(param.key, Number(e.target.value ?? 0))}
                          />
                        )}
                        {param.type === 'boolean' && (
                          <Select value={String(Boolean(value ?? false))} onValueChange={(val) => setScenarioParam(param.key, val === 'true')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Oui</SelectItem>
                              <SelectItem value="false">Non</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <Button
                className="w-full"
                variant={selectedTemplate.severity === 'critical' ? 'destructive' : 'default'}
                onClick={() => handleLaunch(selectedTemplate, selectedParams)}
                disabled={isCreating}
              >
                {isCreating ? 'Lancement...' : `Lancer (${selectedTemplate.severity.toUpperCase()})`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {simulation?.result && (
        <BlastRadiusDrawer
          open={blastRadiusOpen && !warRoomOpen}
          onClose={() => setBlastRadiusOpen(false)}
          onOpenWarRoom={() => {
            setBlastRadiusOpen(false);
            setWarRoomOpen(true);
          }}
          scenarioName={simulation.name}
          result={simulation.result}
        />
      )}

      {simulation?.result && (
        <WarRoom
          open={warRoomOpen}
          onClose={() => setWarRoomOpen(false)}
          scenarioName={simulation.name}
          scenarioType={simulation.scenarioType}
          result={simulation.result}
        />
      )}
    </div>
  );
}

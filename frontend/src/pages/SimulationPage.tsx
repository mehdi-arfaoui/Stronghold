import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import type { ScenarioTemplate, SimulationConfig } from '@/types/simulation.types';

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
  const [warRoomOpen, setWarRoomOpen] = useState(false);
  const [blastRadiusOpen, setBlastRadiusOpen] = useState(false);

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
      toast.success('Simulation lancée');
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
        <h2 className="mb-4 text-lg font-semibold">Scénarios</h2>
        <ScenarioSelector
          templates={templateQuery.data ?? []}
          isLoading={templateQuery.isLoading}
          isLaunching={isCreating}
          onLaunch={handleLaunch}
        />
      </div>

      <RecoveryPriorityKanban priorities={prioritiesQuery.data ?? []} />

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

      {simulation?.result && !warRoomOpen && (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Résultats</h2>
            <Button type="button" variant="outline" onClick={() => setWarRoomOpen(true)}>
              Ouvrir la War Room
            </Button>
          </div>

          <SimulationResult result={simulation.result} />

          {simulation.result.cascadeSteps?.length > 0 && (
            <CascadeView steps={simulation.result.cascadeSteps} />
          )}

          {graphQuery.data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Graphe avant/après</CardTitle>
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

      {simulations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historique des simulations</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {simulations.map((sim) => (
                  <TableRow
                    key={sim.id}
                    className="cursor-pointer"
                    onClick={() => { setActiveSimId(sim.id); if (sim.status === 'completed') setWarRoomOpen(true); }}
                  >
                    <TableCell className="text-sm">{formatDate(sim.createdAt)}</TableCell>
                    <TableCell>{sim.name}</TableCell>
                    <TableCell>
                      {sim.result ? `${Math.round(sim.result.infrastructureImpact)}%` : '-'}
                    </TableCell>
                    <TableCell>
                      {sim.result ? (
                        <span>
                          {sim.result.resilienceScoreBefore} &rarr; {sim.result.resilienceScoreAfter}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sim.status === 'completed' ? 'default' : sim.status === 'failed' ? 'destructive' : 'secondary'}>
                        {sim.status}
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
                          Ouvrir la War Room
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

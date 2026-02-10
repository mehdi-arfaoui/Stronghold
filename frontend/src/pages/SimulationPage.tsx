import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScenarioSelector } from '@/components/simulation/ScenarioSelector';
import { ScenarioParams } from '@/components/simulation/ScenarioParams';
import { SimulationResult } from '@/components/simulation/SimulationResult';
import { CascadeView } from '@/components/simulation/CascadeView';
import { BeforeAfterGraph } from '@/components/simulation/BeforeAfterGraph';
import { WarRoom } from '@/components/simulations/WarRoom';
import { BlastRadiusDrawer } from '@/components/simulations/BlastRadiusDrawer';
import { LoadingState } from '@/components/common/LoadingState';
import { useSimulation } from '@/hooks/useSimulation';
import { useGraph } from '@/hooks/useGraph';
import { discoveryApi } from '@/api/discovery.api';
import { formatDate } from '@/lib/formatters';
import type { ScenarioType, SimulationConfig } from '@/types/simulation.types';

export function SimulationPage() {
  const [selectedScenario, setSelectedScenario] = useState<ScenarioType | null>(null);
  const [paramsOpen, setParamsOpen] = useState(false);
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

  const handleScenarioSelect = (type: ScenarioType) => {
    setSelectedScenario(type);
    setParamsOpen(true);
  };

  const handleLaunch = async (params: Record<string, unknown>) => {
    try {
      const config: SimulationConfig = {
        scenarioType: selectedScenario!,
        name: (params.name as string) || `Simulation ${selectedScenario}`,
        params,
      };
      const result = await createSimulation(config);
      if (!result) {
        throw new Error('Simulation response is empty');
      }

      setActiveSimId(result.id);
      setParamsOpen(false);
      setBlastRadiusOpen(true);
      toast.success('Simulation lancee');
    } catch {
      toast.error('Erreur lors du lancement');
    }
  };

  const availableRegions = [...new Set(allNodes.map((n) => n.region).filter(Boolean) as string[])];
  const availableDbNodes = allNodes
    .filter((n) => n.type === 'DATABASE')
    .map((n) => ({ id: n.id, name: n.name }));

  if (simulationsLoading) {
    return <LoadingState message="Chargement des simulations..." />;
  }

  return (
    <div className="space-y-6">
      {/* Scenario selector */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Scenarios predefinies</h2>
        <ScenarioSelector onSelect={handleScenarioSelect} selectedType={selectedScenario ?? undefined} />
      </div>

      {/* Params dialog */}
      {selectedScenario && (
        <ScenarioParams
          scenarioType={selectedScenario}
          open={paramsOpen}
          onClose={() => setParamsOpen(false)}
          onLaunch={handleLaunch}
          isLoading={isCreating}
          availableRegions={availableRegions}
          availableNodes={availableDbNodes}
        />
      )}

      {/* Blast Radius — impact visualization after simulation creation */}
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

      {/* War Room — immersive simulation view */}
      {simulation?.result && (
        <WarRoom
          open={warRoomOpen}
          onClose={() => setWarRoomOpen(false)}
          scenarioName={simulation.name}
          scenarioType={simulation.scenarioType}
          result={simulation.result}
        />
      )}

      {/* Active simulation result */}
      {simulation?.result && !warRoomOpen && (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Resultats</h2>
            <Button type="button" variant="outline" onClick={() => setWarRoomOpen(true)}>
              Ouvrir la War Room
            </Button>
          </div>

          <SimulationResult result={simulation.result} />

          {simulation.result.cascadeSteps.length > 0 && (
            <CascadeView steps={simulation.result.cascadeSteps} />
          )}

          {graphQuery.data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Graphe avant/apres</CardTitle>
              </CardHeader>
              <CardContent>
                <BeforeAfterGraph
                  nodes={graphQuery.data.nodes}
                  edges={graphQuery.data.edges}
                  affectedNodes={simulation.result.affectedNodes}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* History */}
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

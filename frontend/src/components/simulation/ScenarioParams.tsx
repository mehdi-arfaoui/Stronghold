import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import type { ScenarioType } from '@/types/simulation.types';

interface ScenarioParamsProps {
  scenarioType: ScenarioType;
  open: boolean;
  onClose: () => void;
  onLaunch: (params: Record<string, unknown>) => void;
  isLoading?: boolean;
  availableRegions?: string[];
  availableNodes?: { id: string; name: string }[];
}

export function ScenarioParams({
  scenarioType,
  open,
  onClose,
  onLaunch,
  isLoading,
  availableRegions = [],
  availableNodes = [],
}: ScenarioParamsProps) {
  const [params, setParams] = useState<Record<string, string>>({});

  const handleLaunch = () => {
    onLaunch({ ...params, scenarioType });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurer la simulation</DialogTitle>
          <DialogDescription>Definissez les parametres du scenario</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label>Nom de la simulation</Label>
            <Input
              placeholder="Ex: Test perte eu-west-1"
              value={params.name || ''}
              onChange={(e) => setParams((p) => ({ ...p, name: e.target.value }))}
            />
          </div>

          {(scenarioType === 'region_loss' || scenarioType === 'network_partition') && availableRegions.length > 0 && (
            <div>
              <Label>Region cible</Label>
              <Select value={params.region || ''} onValueChange={(v) => setParams((p) => ({ ...p, region: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une region" />
                </SelectTrigger>
                <SelectContent>
                  {availableRegions.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(scenarioType === 'database_failure' || scenarioType === 'custom') && availableNodes.length > 0 && (
            <div>
              <Label>Noeud cible</Label>
              <Select value={params.nodeId || ''} onValueChange={(v) => setParams((p) => ({ ...p, nodeId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir un noeud" />
                </SelectTrigger>
                <SelectContent>
                  {availableNodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {scenarioType === 'ransomware' && (
            <div>
              <Label>Scope de l&apos;attaque</Label>
              <Select value={params.scope || 'databases'} onValueChange={(v) => setParams((p) => ({ ...p, scope: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="databases">Bases de donnees</SelectItem>
                  <SelectItem value="storage">Stockage</SelectItem>
                  <SelectItem value="all">Toute l&apos;infrastructure</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleLaunch} disabled={isLoading}>
            {isLoading ? 'Lancement...' : 'Lancer la simulation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

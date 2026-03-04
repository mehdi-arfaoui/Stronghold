import { useState, useMemo } from 'react';
import {
  Search,
  Crosshair,
  AlertTriangle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Info,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { RedundancyAnalysis } from '@/types/analysis.types';

type RedundancyLevel = 'full' | 'partial' | 'none';

function getRedundancyLevel(item: RedundancyAnalysis): RedundancyLevel {
  if (item.multiAZ && item.replicas > 1) return 'full';
  if (item.multiAZ || item.replicas > 0 || item.hasBackup) return 'partial';
  return 'none';
}

const LEVEL_CONFIG: Record<RedundancyLevel, { label: string; color: string; bgColor: string; borderColor: string; icon: typeof ShieldCheck }> = {
  full: { label: 'Redondance complète', color: 'text-resilience-high', bgColor: 'bg-resilience-high/10', borderColor: 'border-l-resilience-high', icon: ShieldCheck },
  partial: { label: 'Redondance partielle', color: 'text-severity-medium', bgColor: 'bg-severity-medium/10', borderColor: 'border-l-severity-medium', icon: ShieldAlert },
  none: { label: 'SPOF détecté', color: 'text-severity-critical', bgColor: 'bg-severity-critical/10', borderColor: 'border-l-severity-critical', icon: Shield },
};

interface RedundancyGraphProps {
  data: RedundancyAnalysis[];
}

export function RedundancyGraph({ data }: RedundancyGraphProps) {
  const [search, setSearch] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<RedundancyLevel | null>(null);
  const [selectedNode, setSelectedNode] = useState<RedundancyAnalysis | null>(null);

  const enrichedData = useMemo(
    () => data.map((item) => ({ ...item, level: getRedundancyLevel(item) })),
    [data]
  );

  const filteredData = useMemo(() => {
    return enrichedData.filter((item) => {
      if (selectedLevel && item.level !== selectedLevel) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          item.nodeName.toLowerCase().includes(s) ||
          item.nodeType.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [enrichedData, search, selectedLevel]);

  const stats = useMemo(() => {
    const counts = { full: 0, partial: 0, none: 0 };
    enrichedData.forEach((item) => counts[item.level]++);
    return counts;
  }, [enrichedData]);

  const focusSPOFs = () => {
    setSelectedLevel('none');
    setSearch('');
  };

  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        <AlertTriangle className="h-5 w-5 text-severity-critical shrink-0" />
        <p className="text-sm">
          <span className="font-semibold text-severity-critical">{stats.none} SPOF détecté{stats.none > 1 ? 's' : ''}</span>
          {' — '}
          <span className="text-severity-medium">{stats.partial} partiellement redondé{stats.partial > 1 ? 's' : ''}</span>
          {' — '}
          <span className="text-resilience-high">{stats.full} pleinement protégé{stats.full > 1 ? 's' : ''}</span>
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un composant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Rechercher"
          />
        </div>

        <div className="flex gap-1.5">
          {(['full', 'partial', 'none'] as RedundancyLevel[]).map((level) => {
            const config = LEVEL_CONFIG[level];
            return (
              <Button
                key={level}
                variant={selectedLevel === level ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedLevel(selectedLevel === level ? null : level)}
                className="gap-1.5"
              >
                <config.icon className="h-3.5 w-3.5" />
                {stats[level]}
              </Button>
            );
          })}
        </div>

        <Button variant="outline" size="sm" onClick={focusSPOFs} className="gap-1.5 text-severity-critical">
          <Crosshair className="h-3.5 w-3.5" />
          Voir les SPOF
        </Button>
      </div>

      {/* Node Grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filteredData.map((item) => {
          const config = LEVEL_CONFIG[item.level];
          const isSpof = item.level === 'none';

          return (
            <button
              key={item.nodeId}
              type="button"
              onClick={() => setSelectedNode(item)}
              className={cn(
                'group relative rounded-lg border-l-4 border bg-card p-4 text-left transition-all duration-200 hover:shadow-md hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-ring',
                config.borderColor,
                isSpof && 'animate-pulse-subtle'
              )}
              aria-label={`${item.nodeName} — ${config.label}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <config.icon className={cn('h-4 w-4 shrink-0', config.color)} />
                    <h4 className="font-medium text-sm truncate">{item.nodeName}</h4>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.nodeType}</p>
                </div>
                <Badge variant="outline" className={cn('text-xs shrink-0', config.bgColor, config.color)}>
                  {item.redundancyScore}/100
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Multi-AZ</p>
                  <p className={item.multiAZ ? 'text-resilience-high font-medium' : 'text-muted-foreground'}>
                    {item.multiAZ ? 'Oui' : 'Non'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Replicas</p>
                  <p className="font-medium">{item.replicas}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Backup</p>
                  <p className={item.hasBackup ? 'text-resilience-high font-medium' : 'text-muted-foreground'}>
                    {item.hasBackup ? 'Oui' : 'Non'}
                  </p>
                </div>
              </div>

              <div className="mt-2">
                <Progress
                  value={item.redundancyScore}
                  className={cn('h-1.5', item.level === 'full' ? '[&>div]:bg-resilience-high' : item.level === 'partial' ? '[&>div]:bg-severity-medium' : '[&>div]:bg-severity-critical')}
                />
              </div>
            </button>
          );
        })}
      </div>

      {filteredData.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Search className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Aucun composant ne correspond à votre recherche.</p>
        </div>
      )}

      {/* Detail Panel */}
      {selectedNode && (
        <Card className="mt-4">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4" />
              {selectedNode.nodeName}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setSelectedNode(null)} aria-label="Fermer">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Type</p>
                <p className="font-medium">{selectedNode.nodeType}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Niveau de redondance</p>
                <Badge className={cn(LEVEL_CONFIG[getRedundancyLevel(selectedNode)].bgColor, LEVEL_CONFIG[getRedundancyLevel(selectedNode)].color)}>
                  {LEVEL_CONFIG[getRedundancyLevel(selectedNode)].label}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Score de résilience</p>
                <div className="flex items-center gap-2">
                  <Progress value={selectedNode.redundancyScore} className="h-2 flex-1" />
                  <span className="font-medium">{selectedNode.redundancyScore}/100</span>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Multi-AZ / Replicas / Backup</p>
                <p className="font-medium">
                  {selectedNode.multiAZ ? 'Multi-AZ' : 'Single-AZ'} / {selectedNode.replicas} replicas / {selectedNode.hasBackup ? 'Backup actif' : 'Pas de backup'}
                </p>
              </div>
            </div>

            {selectedNode.recommendations.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Recommandations</p>
                <ul className="space-y-1.5">
                  {selectedNode.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-primary mt-0.5">•</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

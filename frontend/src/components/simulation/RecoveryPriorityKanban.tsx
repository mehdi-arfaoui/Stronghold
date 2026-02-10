import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { RecoveryPriority } from '@/types/simulation.types';

const TIERS: RecoveryPriority['tier'][] = ['T0', 'T1', 'T2', 'T3'];

interface RecoveryPriorityKanbanProps {
  priorities: RecoveryPriority[];
}

export function RecoveryPriorityKanban({ priorities }: RecoveryPriorityKanbanProps) {
  const [manualTier, setManualTier] = useState<Record<string, RecoveryPriority['tier']>>({});

  const grouped = useMemo(() => {
    const base: Record<RecoveryPriority['tier'], RecoveryPriority[]> = { T0: [], T1: [], T2: [], T3: [] };
    (priorities ?? []).forEach((item) => {
      const tier = manualTier[item.nodeId] ?? item.tier;
      base[tier].push(item);
    });
    TIERS.forEach((tier) => base[tier].sort((a, b) => b.score - a.score));
    return base;
  }, [priorities, manualTier]);

  const counts = TIERS.map((tier) => ({ tier, count: grouped[tier]?.length ?? 0 }));
  const total = Math.max(priorities.length, 1);

  const exportCsv = () => {
    const rows = ['nodeId,nodeName,tier,score,rto,dependentCount,criticalityScore'];
    TIERS.forEach((tier) => {
      (grouped[tier] ?? []).forEach((item) => {
        rows.push([item.nodeId, item.nodeName, manualTier[item.nodeId] ?? item.tier, item.score, item.rto, item.dependentCount, item.criticalityScore].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','));
      });
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-priorities.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Recovery Priority — Kanban</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>Export PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          {counts.map((item) => (
            <div key={item.tier} className="rounded-md border p-3">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>{item.tier}</span>
                <span>{item.count}</span>
              </div>
              <Progress value={(item.count / total) * 100} />
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-4">
          {TIERS.map((tier) => (
            <div key={tier} className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <h4 className="font-semibold">{tier}</h4>
              {(grouped[tier] ?? []).map((item) => (
                <div key={item.nodeId} className="space-y-2 rounded-md border bg-background p-3" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', item.nodeId)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
                  e.preventDefault();
                  const draggedId = e.dataTransfer.getData('text/plain');
                  if (draggedId) setManualTier((prev) => ({ ...prev, [draggedId]: tier }));
                }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.nodeName ?? item.nodeId}</p>
                    <Badge variant="secondary">{item.score}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">RTO {item.rto} min • Dépendants {item.dependentCount}</p>
                  <div className="flex flex-wrap gap-1">
                    {TIERS.map((targetTier) => (
                      <Button key={targetTier} size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setManualTier((prev) => ({ ...prev, [item.nodeId]: targetTier }))}>
                        {targetTier}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

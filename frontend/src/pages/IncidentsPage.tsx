import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { IncidentDeclarationForm } from '@/components/incidents/IncidentDeclarationForm';
import { formatRelativeTime } from '@/lib/formatters';
import { incidentsApi } from '@/api/incidents.api';

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  investigating: 'Investigation',
  mitigating: 'Mitigation',
  resolved: 'Resolu',
  closed: 'Ferme',
};

export function IncidentsPage() {
  const [formOpen, setFormOpen] = useState(false);

  const query = useQuery({
    queryKey: ['incidents'],
    queryFn: async () => (await incidentsApi.getAll()).data,
  });

  if (query.isLoading) return <LoadingState message="Chargement des incidents..." />;

  const incidents = query.data ?? [];

  if (incidents.length === 0) {
    return (
      <>
        <EmptyState
          icon={AlertTriangle}
          title="Aucun incident"
          description="Les incidents seront affiches ici lorsqu'ils surviennent."
          actionLabel="Declarer un incident"
          onAction={() => setFormOpen(true)}
        />
        <IncidentDeclarationForm open={formOpen} onOpenChange={setFormOpen} />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Gestion des incidents</h2>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Declarer un incident
        </Button>
      </div>

      <IncidentDeclarationForm open={formOpen} onOpenChange={setFormOpen} />

      <div className="space-y-4">
        {incidents.map((inc) => (
          <Card key={inc.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={inc.severity} />
                  <span>{inc.title}</span>
                </div>
                <Badge variant={inc.status === 'resolved' || inc.status === 'closed' ? 'default' : 'destructive'}>
                  {STATUS_LABELS[inc.status] || inc.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{inc.description}</p>
              <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                <span>Cree {formatRelativeTime(inc.createdAt)}</span>
                {inc.resolvedAt && <span>Resolu {formatRelativeTime(inc.resolvedAt)}</span>}
                <span>{inc.affectedNodes.length} noeud(s) impacte(s)</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

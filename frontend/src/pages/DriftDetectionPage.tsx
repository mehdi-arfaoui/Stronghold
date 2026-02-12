import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  Clock,
  Eye,
  Loader2,
  Minus,
  Play,
  RefreshCw,
  Settings,
  Shield,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { driftApi, type DriftEvent } from '@/api/drift.api';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';

const SEVERITY_CONFIG: Record<string, { color: string; icon: typeof AlertTriangle; label: string }> = {
  critical: { color: 'bg-red-500/10 text-red-700 border-red-500/20', icon: XCircle, label: 'Critique' },
  high: { color: 'bg-orange-500/10 text-orange-700 border-orange-500/20', icon: AlertTriangle, label: 'Haute' },
  medium: { color: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20', icon: Activity, label: 'Moyenne' },
  low: { color: 'bg-blue-500/10 text-blue-700 border-blue-500/20', icon: Shield, label: 'Basse' },
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  acknowledged: 'Acquitte',
  resolved: 'Resolu',
  ignored: 'Ignore',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DriftPageInner() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [showScheduleConfig, setShowScheduleConfig] = useState(false);

  const scoreQuery = useQuery({
    queryKey: ['drift-score'],
    queryFn: async () => (await driftApi.getScore()).data,
  });

  const eventsQuery = useQuery({
    queryKey: ['drift-events', statusFilter],
    queryFn: async () => (await driftApi.getEvents({ status: statusFilter || undefined })).data,
  });

  const snapshotsQuery = useQuery({
    queryKey: ['drift-snapshots'],
    queryFn: async () => (await driftApi.getSnapshots(10)).data,
  });

  const scheduleQuery = useQuery({
    queryKey: ['drift-schedule'],
    queryFn: async () => (await driftApi.getSchedule()).data,
  });

  const runCheckMutation = useMutation({
    mutationFn: () => driftApi.runCheck(),
    onSuccess: () => {
      toast.success('Drift check termine');
      queryClient.invalidateQueries({ queryKey: ['drift-score'] });
      queryClient.invalidateQueries({ queryKey: ['drift-events'] });
      queryClient.invalidateQueries({ queryKey: ['drift-snapshots'] });
    },
    onError: () => toast.error('Erreur lors du drift check'),
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      driftApi.updateEvent(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drift-events'] });
      queryClient.invalidateQueries({ queryKey: ['drift-score'] });
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: (data: { enabled?: boolean; cronExpr?: string }) =>
      driftApi.updateSchedule(data),
    onSuccess: () => {
      toast.success('Planning mis a jour');
      queryClient.invalidateQueries({ queryKey: ['drift-schedule'] });
    },
  });

  const score = scoreQuery.data;
  const events = eventsQuery.data?.events ?? [];
  const summary = eventsQuery.data?.summary;
  const snapshots = snapshotsQuery.data ?? [];
  const schedule = scheduleQuery.data;

  const scoreColor = (score?.score ?? 0) >= 80
    ? 'text-green-600'
    : (score?.score ?? 0) >= 50
      ? 'text-yellow-600'
      : 'text-red-600';

  const trendIcon = score?.trend === 'improving'
    ? <TrendingUp className="h-4 w-4 text-green-600" />
    : score?.trend === 'degrading'
      ? <TrendingDown className="h-4 w-4 text-red-600" />
      : <Minus className="h-4 w-4 text-muted-foreground" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Drift Detection</h1>
          {summary?.byStatus?.open != null && summary.byStatus.open > 0 && (
            <Badge variant="destructive">{summary.byStatus.open} ouvert(s)</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowScheduleConfig(!showScheduleConfig)}
          >
            <Settings className="mr-2 h-4 w-4" />
            Configurer
          </Button>
          <Button
            onClick={() => runCheckMutation.mutate()}
            disabled={runCheckMutation.isPending}
          >
            {runCheckMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Lancer un scan
          </Button>
        </div>
      </div>

      {/* Score Hero Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-8">
            <div className="text-center">
              <div className={cn('text-5xl font-bold', scoreColor)}>
                {score?.score ?? '—'}
              </div>
              <p className="text-sm text-muted-foreground mt-1">/ 100</p>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Score de Resilience</h3>
                {trendIcon}
                {score?.delta != null && score.delta !== 0 && (
                  <span className={cn(
                    'text-sm font-medium',
                    score.delta > 0 ? 'text-green-600' : 'text-red-600'
                  )}>
                    {score.delta > 0 ? '+' : ''}{score.delta} depuis le dernier scan
                  </span>
                )}
              </div>
              <Progress value={score?.score ?? 0} className="h-2" />
              <div className="flex gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Dernier scan : {formatDate(score?.lastScanAt ?? null)}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Prochain scan : {score?.nextScanAt ? formatDate(score.nextScanAt) : 'Non planifie'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Schedule Config */}
      {showScheduleConfig && schedule && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration du planning</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Button
                variant={schedule.enabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateScheduleMutation.mutate({ enabled: !schedule.enabled })}
              >
                {schedule.enabled ? 'Actif' : 'Inactif'}
              </Button>
              <span className="text-sm text-muted-foreground">
                Expression cron : <code className="bg-muted px-2 py-0.5 rounded">{schedule.cronExpr}</code>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {['', 'open', 'acknowledged', 'resolved', 'ignored'].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s === '' ? 'Tous' : STATUS_LABELS[s] ?? s}
          </Button>
        ))}
      </div>

      {/* Drift Events */}
      <div className="space-y-3">
        {eventsQuery.isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {!eventsQuery.isLoading && events.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Shield className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-semibold">Aucun drift detecte</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Lancez un scan pour verifier l'etat de votre infrastructure.
              </p>
            </CardContent>
          </Card>
        )}

        {events.map((event: DriftEvent) => {
          const sev = SEVERITY_CONFIG[event.severity] ?? SEVERITY_CONFIG.low;
          const SevIcon = sev.icon;

          return (
            <Card key={event.id} className={cn(event.status === 'open' && 'border-l-4', event.severity === 'critical' && 'border-l-red-500', event.severity === 'high' && 'border-l-orange-500', event.severity === 'medium' && 'border-l-yellow-500')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={sev.color}>
                        <SevIcon className="mr-1 h-3 w-3" />
                        {sev.label}
                      </Badge>
                      <Badge variant="secondary">{event.category}</Badge>
                      {event.affectsSPOF && <Badge variant="destructive">SPOF</Badge>}
                      {event.affectsBIA && <Badge variant="outline">BIA</Badge>}
                      {event.affectsRTO && <Badge variant="outline">RTO</Badge>}
                    </div>
                    <p className="font-medium">{event.description}</p>
                    {event.nodeName && (
                      <p className="text-sm text-muted-foreground mt-1">
                        Service : {event.nodeName} ({event.nodeType})
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(event.createdAt)}
                    </p>
                  </div>

                  {event.status === 'open' && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateEventMutation.mutate({ id: event.id, status: 'acknowledged' })}
                        disabled={updateEventMutation.isPending}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        Acquitter
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateEventMutation.mutate({ id: event.id, status: 'resolved' })}
                        disabled={updateEventMutation.isPending}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        Resoudre
                      </Button>
                    </div>
                  )}

                  {event.status !== 'open' && (
                    <Badge variant="secondary">
                      {STATUS_LABELS[event.status] ?? event.status}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Snapshot History */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Historique des scans
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Noeuds</th>
                    <th className="pb-2 font-medium">Drifts</th>
                    <th className="pb-2 font-medium">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {snapshots.map((snap, i) => {
                    const prev = snapshots[i + 1];
                    const nodeDelta = prev ? snap.nodeCount - prev.nodeCount : 0;
                    return (
                      <tr key={snap.id}>
                        <td className="py-2">{formatDate(snap.capturedAt)}</td>
                        <td className="py-2">{snap.nodeCount}</td>
                        <td className="py-2">
                          {snap.driftCount > 0 ? (
                            <Badge variant="outline" className={snap.openDriftCount > 0 ? 'bg-red-500/10 text-red-700' : ''}>
                              {snap.driftCount} ({snap.openDriftCount} ouvert{snap.openDriftCount > 1 ? 's' : ''})
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="py-2">
                          {nodeDelta > 0 && (
                            <span className="flex items-center gap-1 text-green-600">
                              <ArrowUp className="h-3 w-3" /> +{nodeDelta}
                            </span>
                          )}
                          {nodeDelta < 0 && (
                            <span className="flex items-center gap-1 text-red-600">
                              <ArrowDown className="h-3 w-3" /> {nodeDelta}
                            </span>
                          )}
                          {nodeDelta === 0 && (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function DriftDetectionPage() {
  return (
    <ModuleErrorBoundary moduleName="Drift Detection">
      <DriftPageInner />
    </ModuleErrorBoundary>
  );
}

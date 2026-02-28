import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  DollarSign,
  Download,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  X,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { SimulationResult, WarRoomData } from '@/types/simulation.types';

interface WarRoomProps {
  open: boolean;
  onClose: () => void;
  scenarioName: string;
  scenarioType: string;
  result: SimulationResult;
  currency: string;
  onGenerateReport?: () => void;
}

type NodeVisualState = 'healthy' | 'at_risk' | 'degraded' | 'recent_down' | 'stale_down';

const PLAYBACK_SPEEDS = [1, 2, 5, 10] as const;
const SEEK_STEP_SECONDS = 15;

const SEVERITY_CONFIG = {
  critical: { label: 'CRITIQUE', color: 'bg-severity-critical text-white' },
  high: { label: 'HAUT', color: 'bg-severity-high text-white' },
  medium: { label: 'MOYEN', color: 'bg-severity-medium text-white' },
  low: { label: 'BAS', color: 'bg-severity-low text-white' },
};

function getSeverity(impact: number): keyof typeof SEVERITY_CONFIG {
  if (impact >= 75) return 'critical';
  if (impact >= 50) return 'high';
  if (impact >= 25) return 'medium';
  return 'low';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatPlaybackTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `T+${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes} min ${String(remainder).padStart(2, '0')} sec`;
}

function resolveCumulativeLossAtSecond(
  seconds: number,
  timeline: Array<{
    timestampSeconds: number;
    cumulativeBusinessLoss: number;
    activeHourlyCost: number;
  }> | undefined,
  hourlyLossFallback: number,
): number {
  const safeSeconds = Math.max(0, seconds);
  if (!timeline || timeline.length === 0) {
    return hourlyLossFallback * (safeSeconds / 3600);
  }

  const ordered = [...timeline].sort((left, right) => left.timestampSeconds - right.timestampSeconds);
  const first = ordered[0];
  if (!first) return 0;
  if (safeSeconds <= first.timestampSeconds) {
    return first.cumulativeBusinessLoss;
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;
    if (safeSeconds > current.timestampSeconds) continue;

    const deltaSeconds = Math.max(1, current.timestampSeconds - previous.timestampSeconds);
    const ratio = (safeSeconds - previous.timestampSeconds) / deltaSeconds;
    return previous.cumulativeBusinessLoss + ratio * (current.cumulativeBusinessLoss - previous.cumulativeBusinessLoss);
  }

  return ordered[ordered.length - 1]?.cumulativeBusinessLoss ?? 0;
}

function resolveActiveHourlyCostAtSecond(
  seconds: number,
  timeline: Array<{
    timestampSeconds: number;
    activeHourlyCost: number;
  }> | undefined,
  fallback: number,
): number {
  if (!timeline || timeline.length === 0) return fallback;

  const ordered = [...timeline].sort((left, right) => left.timestampSeconds - right.timestampSeconds);
  let activeHourlyCost = ordered[0]?.activeHourlyCost ?? fallback;
  for (const point of ordered) {
    if (seconds < point.timestampSeconds) break;
    activeHourlyCost = point.activeHourlyCost;
  }
  return activeHourlyCost;
}

function resolveEventMarker(impactType: WarRoomData['propagationTimeline'][number]['impactType']) {
  if (impactType === 'initial_failure') {
    return { label: 'Initial', tone: 'bg-severity-critical text-white' };
  }
  if (impactType === 'direct_cascade') {
    return { label: 'Direct', tone: 'bg-severity-high text-white' };
  }
  if (impactType === 'indirect_cascade') {
    return { label: 'Indirect', tone: 'bg-severity-medium text-white' };
  }
  return { label: 'Degrade', tone: 'bg-muted text-foreground' };
}

function resolveConfidenceTone(
  confidence: NonNullable<SimulationResult['warRoomFinancial']>['costConfidence'] | undefined,
) {
  if (confidence === 'reliable') {
    return 'border-resilience-high text-resilience-high';
  }
  if (confidence === 'approximate') {
    return 'border-severity-medium text-severity-medium';
  }
  return 'border-severity-critical text-severity-critical';
}

function resolveNodeStateClass(state: NodeVisualState, selected: boolean): string {
  const selectionRing = selected ? 'ring-2 ring-offset-2 ring-severity-high' : '';
  if (state === 'stale_down') {
    return cn('border-severity-critical bg-severity-critical/15 text-foreground', selectionRing);
  }
  if (state === 'recent_down') {
    return cn('border-severity-critical bg-severity-critical/10 text-foreground', selectionRing);
  }
  if (state === 'degraded') {
    return cn('border-severity-medium bg-severity-medium/10 text-foreground', selectionRing);
  }
  if (state === 'at_risk') {
    return cn('border-severity-high bg-severity-high/10 animate-pulse text-foreground', selectionRing);
  }
  return cn('border-border bg-card text-foreground', selectionRing);
}

export function WarRoom({
  open,
  onClose,
  scenarioName,
  scenarioType: _scenarioType,
  result,
  currency,
  onGenerateReport,
}: WarRoomProps) {
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(5);
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const playbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const journalRef = useRef<HTMLDivElement | null>(null);
  const lastVisibleEventCountRef = useRef(0);

  const severity = getSeverity(result.infrastructureImpact ?? 0);
  const sevConfig = SEVERITY_CONFIG[severity];

  const warRoomData: WarRoomData = result.warRoomData ?? {
    propagationTimeline: [],
    impactedNodes: [],
    remediationActions: [],
  };

  const timelineEvents = useMemo(() => (
    [...(warRoomData.propagationTimeline ?? [])]
      .map((event) => ({
        ...event,
        delaySeconds: Number(event.delaySeconds ?? (event.timestampMinutes * 60)),
      }))
      .sort((left, right) => left.delaySeconds - right.delaySeconds)
  ), [warRoomData.propagationTimeline]);

  const fallbackImpactedNodes = useMemo(() => (
    (result.affectedNodes ?? []).map((node) => {
      const matchingService = (result.impactedServices ?? []).find((service) => service.serviceName === node.nodeName);
      return {
        id: node.nodeId,
        name: node.nodeName,
        type: node.nodeType,
        status: node.status === 'degraded' ? ('degraded' as const) : ('down' as const),
        impactedAt: node.cascadeLevel,
        impactedAtSeconds: node.cascadeLevel * 60,
        estimatedRecovery:
          matchingService?.estimatedRTO ??
          Math.round((result.estimatedDowntime ?? 60) / Math.max((result.affectedNodes ?? []).length, 1)),
      };
    })
  ), [result.affectedNodes, result.impactedServices, result.estimatedDowntime]);

  const impactedNodes = warRoomData.impactedNodes?.length
    ? warRoomData.impactedNodes.map((node) => ({
        ...node,
        impactedAtSeconds: Number(node.impactedAtSeconds ?? (node.impactedAt * 60)),
      }))
    : fallbackImpactedNodes;

  const maxTimelineDelaySeconds = Math.max(
    0,
    ...timelineEvents.map((event) => event.delaySeconds),
    ...impactedNodes.map((node) => Number(node.impactedAtSeconds ?? 0)),
    Number(result.warRoomFinancial?.totalDurationSeconds ?? 0),
  );
  const maxTimeSeconds = Math.max(1, Math.ceil(maxTimelineDelaySeconds));

  useEffect(() => {
    if (!open) {
      setCurrentTimeSeconds(0);
      setIsPlaying(false);
      setSelectedEventKey(null);
      setSelectedNodeId(null);
      return;
    }

    setCurrentTimeSeconds(0);
    setSelectedEventKey(null);
    setSelectedNodeId(null);
    setIsPlaying(true);
  }, [open, scenarioName, maxTimeSeconds, timelineEvents.length]);

  useEffect(() => {
    if (!open || !isPlaying) {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
        playbackRef.current = null;
      }
      return;
    }

    playbackRef.current = setInterval(() => {
      setCurrentTimeSeconds((previous) => {
        const next = Math.min(maxTimeSeconds, previous + (0.2 * playbackSpeed));
        if (next >= maxTimeSeconds) {
          setIsPlaying(false);
        }
        return next;
      });
    }, 200);

    return () => {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
        playbackRef.current = null;
      }
    };
  }, [isPlaying, maxTimeSeconds, open, playbackSpeed]);

  useEffect(() => {
    return () => {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
      }
    };
  }, []);

  const visibleEvents = useMemo(
    () => timelineEvents.filter((event) => event.delaySeconds <= currentTimeSeconds + 0.001),
    [currentTimeSeconds, timelineEvents],
  );
  const deferredVisibleEvents = useDeferredValue(visibleEvents);

  useEffect(() => {
    if (!journalRef.current) return;
    if (deferredVisibleEvents.length <= lastVisibleEventCountRef.current) return;
    journalRef.current.scrollTop = journalRef.current.scrollHeight;
    lastVisibleEventCountRef.current = deferredVisibleEvents.length;
  }, [deferredVisibleEvents.length]);

  const firstImpactByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of impactedNodes) {
      map.set(node.id, Number(node.impactedAtSeconds ?? 0));
    }
    for (const event of timelineEvents) {
      const previous = map.get(event.nodeId);
      if (previous == null || event.delaySeconds < previous) {
        map.set(event.nodeId, event.delaySeconds);
      }
    }
    return map;
  }, [impactedNodes, timelineEvents]);

  const latestVisibleEventByNodeId = useMemo(() => {
    const map = new Map<string, WarRoomData['propagationTimeline'][number]>();
    for (const event of deferredVisibleEvents) {
      map.set(event.nodeId, event);
    }
    return map;
  }, [deferredVisibleEvents]);

  const nodeVisualStateById = useMemo(() => {
    const map = new Map<string, NodeVisualState>();

    for (const node of impactedNodes) {
      const firstImpactSeconds = firstImpactByNodeId.get(node.id);
      const latestVisibleEvent = latestVisibleEventByNodeId.get(node.id);

      if (latestVisibleEvent) {
        const secondsSinceImpact = currentTimeSeconds - latestVisibleEvent.delaySeconds;
        if (latestVisibleEvent.impactType === 'degraded') {
          map.set(node.id, 'degraded');
          continue;
        }
        map.set(node.id, secondsSinceImpact >= 45 ? 'stale_down' : 'recent_down');
        continue;
      }

      if (firstImpactSeconds != null && currentTimeSeconds >= Math.max(0, firstImpactSeconds - 5)) {
        map.set(node.id, 'at_risk');
        continue;
      }

      map.set(node.id, 'healthy');
    }

    return map;
  }, [currentTimeSeconds, firstImpactByNodeId, impactedNodes, latestVisibleEventByNodeId]);

  const currentlyImpactedNodes = impactedNodes.filter((node) => {
    const state = nodeVisualStateById.get(node.id);
    return state === 'recent_down' || state === 'stale_down' || state === 'degraded';
  }).length;
  const currentlyDownNodes = impactedNodes.filter((node) => {
    const state = nodeVisualStateById.get(node.id);
    return state === 'recent_down' || state === 'stale_down';
  }).length;
  const totalNodes = result.blastRadiusMetrics?.totalNodesInGraph ?? impactedNodes.length ?? 0;
  const impactedInfraPercent =
    totalNodes > 0
      ? (currentlyImpactedNodes / totalNodes) * 100
      : result.infrastructureImpact ?? 0;

  const projectedBusinessLoss = result.warRoomFinancial?.projectedBusinessLoss ?? result.financialLoss ?? 0;
  const hourlyLoss =
    result.warRoomFinancial?.hourlyDowntimeCost ??
    projectedBusinessLoss / Math.max((result.estimatedDowntime ?? 60) / 60, 1);
  const activeHourlyCost = resolveActiveHourlyCostAtSecond(
    currentTimeSeconds,
    result.warRoomFinancial?.cumulativeLossTimeline,
    hourlyLoss,
  );
  const cumulativeBusinessLoss = resolveCumulativeLossAtSecond(
    currentTimeSeconds,
    result.warRoomFinancial?.cumulativeLossTimeline,
    hourlyLoss,
  );
  const completionRatio = clamp((currentTimeSeconds / maxTimeSeconds) * 100, 0, 100);
  const simulationComplete = currentTimeSeconds >= maxTimeSeconds;

  const topCostNodes = (result.warRoomFinancial?.nodeCostBreakdown ?? []).slice(0, 5);
  const summaryTopCostNodes = topCostNodes.slice(0, 3);
  const primaryRecommendation = result.recommendations?.[0];
  const estimatedSavings = primaryRecommendation
    ? Math.max(
        0,
        projectedBusinessLoss * (1 - (primaryRecommendation.estimatedRto / Math.max(result.warRoomFinancial?.totalDurationMinutes ?? (maxTimeSeconds / 60), 1))),
      )
    : 0;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="War Room - Simulation d impact"
    >
      <div className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-severity-critical" />
            <h2 className="text-lg font-bold">War Room</h2>
          </div>
          <Badge className={sevConfig.color}>{sevConfig.label}</Badge>
          <span className="text-sm text-muted-foreground">{scenarioName}</span>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={cn(
              'font-mono text-xs',
              resolveConfidenceTone(result.warRoomFinancial?.costConfidence),
            )}
          >
            {result.warRoomFinancial?.costConfidenceLabel ?? 'Estimation grossiere'}
          </Badge>
          {onGenerateReport && (
            <Button variant="outline" size="sm" onClick={onGenerateReport}>
              <Download className="mr-2 h-4 w-4" />
              Exporter
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ImpactCard
              icon={Activity}
              label="Services down"
              value={`${currentlyDownNodes}/${Math.max(impactedNodes.length, 1)}`}
              accent="text-severity-critical"
            />
            <ImpactCard
              icon={Clock}
              label="Temps"
              value={formatPlaybackTime(currentTimeSeconds)}
              accent="text-severity-high"
            />
            <ImpactCard
              icon={DollarSign}
              label="Cout estime"
              value={formatCurrency(cumulativeBusinessLoss, currency)}
              accent="text-severity-medium"
            />
            <ImpactCard
              icon={ShieldAlert}
              label="% Infra"
              value={`${impactedInfraPercent.toFixed(1)}%`}
              accent="text-resilience-high"
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
            <div className="space-y-6">
              <section className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Propagation en cours
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Les noeuds passent de sain a degrade puis indisponible selon la timeline backend.
                    </p>
                  </div>
                  <Badge variant="outline">{formatPlaybackTime(currentTimeSeconds)}</Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {impactedNodes.map((node) => {
                    const state = nodeVisualStateById.get(node.id) ?? 'healthy';
                    const firstImpactSeconds = firstImpactByNodeId.get(node.id) ?? node.impactedAtSeconds ?? 0;
                    const latestEvent = latestVisibleEventByNodeId.get(node.id);
                    const isSelected =
                      selectedNodeId === node.id ||
                      (selectedEventKey != null && selectedEventKey === `${node.id}:${latestEvent?.delaySeconds ?? 0}`);

                    return (
                      <button
                        type="button"
                        key={node.id}
                        onClick={() => {
                          setSelectedNodeId(node.id);
                          if (latestEvent) {
                            setSelectedEventKey(`${latestEvent.nodeId}:${latestEvent.delaySeconds}`);
                          }
                        }}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-colors duration-1000 ease-in-out',
                          resolveNodeStateClass(state, isSelected),
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{node.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{node.type}</p>
                          </div>
                          <Badge variant="outline" className="shrink-0">
                            {state === 'recent_down' || state === 'stale_down'
                              ? 'DOWN'
                              : state === 'degraded'
                                ? 'DEGRADE'
                                : state === 'at_risk'
                                  ? 'IMPACT'
                                  : 'SAIN'}
                          </Badge>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{formatPlaybackTime(firstImpactSeconds)}</span>
                          <span>RTO {Math.max(1, Math.round(node.estimatedRecovery))} min</span>
                        </div>

                        <div className="mt-3 h-1.5 rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-full rounded-full transition-[width,background-color] duration-1000 ease-in-out',
                              state === 'recent_down' || state === 'stale_down'
                                ? 'bg-severity-critical'
                                : state === 'degraded' || state === 'at_risk'
                                  ? 'bg-severity-high'
                                  : 'bg-resilience-high',
                            )}
                            style={{
                              width: `${clamp((currentTimeSeconds / Math.max(firstImpactSeconds || 1, 1)) * 100, state === 'healthy' ? 0 : 12, 100)}%`,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {(result.warRoomFinancial?.nodeCostBreakdown?.length ?? 0) > 0 && (
                <section className="rounded-xl border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Couts temps reel
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Burn rate actif {formatCurrency(activeHourlyCost, currency)}/h
                      </p>
                    </div>
                    <Badge variant="outline">
                      Couverture BIA {Math.round((result.warRoomFinancial?.biaCoverageRatio ?? 0) * 100)}%
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {topCostNodes.map((node) => (
                      <div key={node.nodeId} className="rounded-lg border bg-background px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{node.nodeName}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {node.nodeType} · {node.costSourceLabel ?? 'Source inconnue'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">{formatCurrency(node.totalCost ?? 0, currency)}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatCurrency(node.costPerHour ?? 0, currency)}/h
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{formatPlaybackTime(node.impactedAtSeconds ?? 0)}</span>
                          <span>Downtime {Math.round(node.downtimeMinutes ?? 0)} min</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Remediation priorisee
                </h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {(warRoomData.remediationActions ?? []).map((action) => (
                    <div key={action.id} className="rounded-lg border bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{action.title}</p>
                        <Badge variant="outline">{action.priority}</Badge>
                      </div>
                      <Badge
                        className="mt-2"
                        variant={
                          action.status === 'completed'
                            ? 'default'
                            : action.status === 'in_progress'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {action.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </section>

              {simulationComplete && (
                <section className="rounded-xl border border-severity-medium/40 bg-severity-medium/5 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-semibold">Resume de la simulation</h3>
                      <p className="text-sm text-muted-foreground">{scenarioName}</p>
                    </div>
                    <Badge variant="outline">{formatPlaybackTime(maxTimeSeconds)}</Badge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <SummaryStat label="Duree totale" value={formatDuration(maxTimeSeconds)} />
                    <SummaryStat
                      label="Services impactes"
                      value={`${impactedNodes.length} / ${Math.max(totalNodes, impactedNodes.length || 1)}`}
                    />
                    <SummaryStat
                      label="Cout total"
                      value={formatCurrency(projectedBusinessLoss, currency)}
                    />
                    <SummaryStat
                      label="Fiabilite"
                      value={result.warRoomFinancial?.costConfidenceLabel ?? 'Estimation grossiere'}
                    />
                  </div>

                  {summaryTopCostNodes.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Top services couteux
                      </h4>
                      {summaryTopCostNodes.map((node, index) => (
                        <div key={node.nodeId} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {index + 1}. {node.nodeName}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {node.costSourceLabel ?? 'Source inconnue'}
                            </p>
                          </div>
                          <span className="font-semibold">{formatCurrency(node.totalCost ?? 0, currency)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {primaryRecommendation && (
                    <div className="mt-4 rounded-lg border bg-background p-3">
                      <p className="text-sm font-semibold">Recommandation prioritaire</p>
                      <p className="mt-1 text-sm">{primaryRecommendation.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Objectif RTO {Math.max(1, Math.round(primaryRecommendation.estimatedRto))} min.
                        Economie theorique par incident {formatCurrency(estimatedSavings, currency)} si cet objectif est tenu.
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {onGenerateReport && (
                      <Button variant="outline" onClick={onGenerateReport}>
                        <Download className="mr-2 h-4 w-4" />
                        Ajouter au rapport
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCurrentTimeSeconds(0);
                        setSelectedEventKey(null);
                        setSelectedNodeId(null);
                        setIsPlaying(true);
                      }}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Relancer
                    </Button>
                  </div>
                </section>
              )}
            </div>

            <div className="space-y-6">
              <section className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Journal des evenements
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Les evenements apparaissent selon la timeline calculee par le backend.
                    </p>
                  </div>
                  <Badge variant="outline">{deferredVisibleEvents.length} evenements</Badge>
                </div>

                <div ref={journalRef} className="max-h-[46rem] space-y-2 overflow-y-auto pr-1">
                  {deferredVisibleEvents.map((event) => {
                    const marker = resolveEventMarker(event.impactType);
                    const eventKey = `${event.nodeId}:${event.delaySeconds}`;
                    const selected = eventKey === selectedEventKey;

                    return (
                      <button
                        type="button"
                        key={eventKey}
                        onClick={() => {
                          setSelectedEventKey(eventKey);
                          setSelectedNodeId(event.nodeId);
                        }}
                        className={cn(
                          'w-full rounded-lg border p-3 text-left transition-colors',
                          selected
                            ? 'border-severity-high bg-severity-high/10'
                            : 'bg-background hover:border-severity-high/40',
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge className={marker.tone}>{marker.label}</Badge>
                            <p className="truncate text-sm font-medium">{event.nodeName}</p>
                          </div>
                          <span className="text-xs font-mono text-muted-foreground">
                            {formatPlaybackTime(event.delaySeconds)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{event.description}</p>
                        {event.parentNodeName && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Cause: {event.parentNodeName} via {event.edgeType}
                          </p>
                        )}
                      </button>
                    );
                  })}

                  {deferredVisibleEvents.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      Aucun evenement visible a {formatPlaybackTime(currentTimeSeconds)}.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  RTO de reference
                </h3>
                <div className="mt-3 space-y-3">
                  {(result.impactedServices ?? []).slice(0, 5).map((service) => {
                    const rtoMinutes = Math.max(service.estimatedRTO ?? 1, 1);
                    const rtoProgress = Math.min(((currentTimeSeconds / 60) / rtoMinutes) * 100, 100);
                    return (
                      <div key={service.serviceName} className="space-y-1">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="truncate">{service.serviceName}</span>
                          <span className="font-mono text-muted-foreground">RTO {rtoMinutes} min</span>
                        </div>
                        <Progress value={rtoProgress} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t bg-card px-6 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsPlaying((previous) => !previous)}
              aria-label={isPlaying ? 'Pause' : 'Lecture'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTimeSeconds((previous) => Math.max(0, previous - SEEK_STEP_SECONDS));
              }}
              aria-label="Reculer"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTimeSeconds((previous) => Math.min(maxTimeSeconds, previous + SEEK_STEP_SECONDS));
              }}
              aria-label="Avancer"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTimeSeconds(0);
                setSelectedEventKey(null);
                setSelectedNodeId(null);
              }}
              aria-label="Reinitialiser"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {PLAYBACK_SPEEDS.map((speed) => (
              <Button
                key={speed}
                type="button"
                variant={playbackSpeed === speed ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPlaybackSpeed(speed)}
              >
                {speed}x
              </Button>
            ))}
          </div>

          <div className="flex flex-1 items-center gap-3">
            <span className="w-20 shrink-0 text-xs font-mono text-muted-foreground">
              {formatPlaybackTime(currentTimeSeconds)}
            </span>
            <input
              aria-label="Timeline"
              type="range"
              min={0}
              max={maxTimeSeconds}
              step={1}
              value={Math.floor(currentTimeSeconds)}
              onChange={(event) => {
                setIsPlaying(false);
                setCurrentTimeSeconds(Number(event.target.value));
              }}
              className="h-2 w-full cursor-pointer accent-[hsl(var(--destructive))]"
            />
            <span className="w-20 shrink-0 text-right text-xs font-mono text-muted-foreground">
              {formatPlaybackTime(maxTimeSeconds)}
            </span>
          </div>

          <div className="text-sm text-muted-foreground">
            {simulationComplete
              ? (
                <Badge variant="outline" className="border-resilience-high text-resilience-high">
                  Simulation terminee
                </Badge>
              )
              : (
                <span>{isPlaying ? 'Lecture en cours' : 'Pause'}</span>
              )}
          </div>
        </div>

        <div className="mt-3 h-2 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-severity-critical transition-[width] duration-200"
            style={{ width: `${completionRatio}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ImpactCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', accent)} />
        <span>{label}</span>
      </div>
      <p className={cn('text-xl font-bold tabular-nums', accent)}>{value}</p>
    </div>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

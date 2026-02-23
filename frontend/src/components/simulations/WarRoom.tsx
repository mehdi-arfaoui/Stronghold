import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Download,
  Clock,
  DollarSign,
  Activity,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
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

type AnimationPhase = 'idle' | 'initial' | 'propagating' | 'complete';
type NodeVisualState = 'healthy' | 'at_risk' | 'down';

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

function resolveCumulativeLossAtMinutes(
  minutes: number,
  timeline: Array<{ timestampMinutes: number; cumulativeBusinessLoss: number }> | undefined,
  hourlyLossFallback: number,
): number {
  const safeMinutes = Math.max(0, minutes);
  if (!timeline || timeline.length === 0) {
    return (hourlyLossFallback * safeMinutes) / 60;
  }

  const ordered = [...timeline].sort((a, b) => a.timestampMinutes - b.timestampMinutes);
  const first = ordered[0];
  if (!first) return 0;

  if (safeMinutes <= first.timestampMinutes) {
    return first.cumulativeBusinessLoss;
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;
    if (safeMinutes > current.timestampMinutes) continue;

    const range = Math.max(1, current.timestampMinutes - previous.timestampMinutes);
    const ratio = (safeMinutes - previous.timestampMinutes) / range;
    return previous.cumulativeBusinessLoss + ratio * (current.cumulativeBusinessLoss - previous.cumulativeBusinessLoss);
  }

  return ordered[ordered.length - 1]?.cumulativeBusinessLoss ?? 0;
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
  const [phase, setPhase] = useState<AnimationPhase>('idle');
  const [currentStep, setCurrentStep] = useState(0);
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const severity = getSeverity(result.infrastructureImpact ?? 0);
  const sevConfig = SEVERITY_CONFIG[severity];

  const warRoomData: WarRoomData = result.warRoomData ?? {
    propagationTimeline: [],
    impactedNodes: [],
    remediationActions: [],
  };

  const timelineEvents = warRoomData.propagationTimeline ?? [];
  const impactedNodes = warRoomData.impactedNodes?.length
    ? warRoomData.impactedNodes
    : (result.affectedNodes ?? []).map((node) => {
        const matchingService = (result.impactedServices ?? []).find((service) => service.serviceName === node.nodeName);
        return {
          id: node.nodeId,
          name: node.nodeName,
          type: node.nodeType,
          status: node.status,
          impactedAt: node.cascadeLevel,
          estimatedRecovery:
            matchingService?.estimatedRTO ??
            Math.round((result.estimatedDowntime ?? 60) / Math.max((result.affectedNodes ?? []).length, 1)),
        };
      });

  const timelineIndexByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    (timelineEvents ?? []).forEach((event, index) => {
      if (!map.has(event.nodeId)) {
        map.set(event.nodeId, index);
      }
    });
    return map;
  }, [timelineEvents]);
  const nodeStates = useMemo<Record<string, NodeVisualState>>(() => {
    const next: Record<string, NodeVisualState> = {};
    for (const node of impactedNodes) {
      const timelineIndex = timelineIndexByNodeId.get(node.id);
      if (phase === 'complete') {
        next[node.id] = 'down';
        continue;
      }
      if (timelineIndex == null) {
        next[node.id] = 'healthy';
        continue;
      }
      if (currentStep > timelineIndex) {
        next[node.id] = 'down';
      } else if (currentStep === timelineIndex) {
        next[node.id] = 'at_risk';
      } else {
        next[node.id] = 'healthy';
      }
    }
    return next;
  }, [currentStep, impactedNodes, phase, timelineIndexByNodeId]);
  const totalNodes = impactedNodes.length ?? 0;
  const downNodes = Object.values(nodeStates).filter((state) => state === 'down').length;
  const impactedServiceCount = (result.impactedServices ?? []).filter((service) => service.impact !== 'none').length;
  const estimatedUsers =
    impactedServiceCount *
    Math.max(Math.round((result.blastRadiusMetrics?.totalNodesInGraph ?? 10) / Math.max(impactedServiceCount, 1)), 1);
  const estimatedDowntimeMinutes = Math.max(result.estimatedDowntime ?? 60, 1);
  const projectedBusinessLoss = result.warRoomFinancial?.projectedBusinessLoss ?? result.financialLoss ?? 0;
  const hourlyLoss =
    result.warRoomFinancial?.hourlyDowntimeCost ??
    projectedBusinessLoss / Math.max(estimatedDowntimeMinutes / 60, 1);
  const recoveryCostEstimate =
    result.warRoomFinancial?.recoveryCostEstimate ?? projectedBusinessLoss * 0.25;
  const simulatedMinutes =
    phase === 'complete'
      ? estimatedDowntimeMinutes
      : (Math.max(0, timelinePosition) / 100) * estimatedDowntimeMinutes;
  const cumulativeBusinessLoss = resolveCumulativeLossAtMinutes(
    simulatedMinutes,
    result.warRoomFinancial?.cumulativeLossTimeline,
    hourlyLoss,
  );

  const startAnimation = useCallback(() => {
    setPhase('initial');
    setCurrentStep(-1);
    setTimelinePosition(0);
    setIsPlaying(true);
    setElapsedSeconds(0);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((previous) => previous + 1);
    }, 1000);

    let step = 0;
    const animateStep = () => {
      if (step >= timelineEvents.length) {
        setPhase('complete');
        setTimelinePosition(100);
        setIsPlaying(false);
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      setPhase('propagating');
      setCurrentStep(step);
      setTimelinePosition(((step + 1) / Math.max(timelineEvents.length, 1)) * 100);
      step += 1;
      animationRef.current = setTimeout(animateStep, 700);
    };

    setTimeout(animateStep, 400);
  }, [timelineEvents]);

  const pauseAnimation = () => {
    setIsPlaying(false);
    if (animationRef.current) clearTimeout(animationRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const resetAnimation = useCallback(() => {
    pauseAnimation();
    setPhase('idle');
    setCurrentStep(0);
    setTimelinePosition(0);
    setElapsedSeconds(0);
  }, []);

  useEffect(() => {
    return () => {
      if (animationRef.current) clearTimeout(animationRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (open) {
      const timeout = setTimeout(startAnimation, 500);
      return () => clearTimeout(timeout);
    }
    resetAnimation();
    return () => undefined;
  }, [open, startAnimation, resetAnimation]);

  if (!open) return null;

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true" aria-label="War Room - Simulation d impact">
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
          <div className="flex items-center gap-1.5 text-sm font-mono bg-muted px-3 py-1.5 rounded">
            <Clock className="h-4 w-4" />
            {formatTime(elapsedSeconds)}
          </div>
          {onGenerateReport && (
            <Button variant="outline" size="sm" onClick={onGenerateReport} disabled={phase !== 'complete'}>
              <Download className="mr-2 h-4 w-4" />
              Generer le rapport
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 p-6 overflow-auto space-y-6">
          <div className="rounded-lg border bg-card p-3 text-sm flex flex-wrap gap-4">
            <span>Services down: {downNodes}/{Math.max(totalNodes, 1)}</span>
            <span>Temps: {Math.floor(elapsedSeconds / 60)}min</span>
            <span className="font-semibold text-severity-critical">
              Perte cumulee: {formatCurrency(cumulativeBusinessLoss, currency)}
            </span>
          </div>

          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {(impactedNodes ?? []).map((node) => {
              const state = nodeStates[node.id] ?? 'healthy';
              return (
                <div
                  key={node.id}
                  className={cn(
                    'rounded-lg border p-3 transition-all duration-500',
                    state === 'down'
                      ? 'border-severity-critical bg-severity-critical/10'
                      : state === 'at_risk'
                        ? 'border-severity-medium bg-severity-medium/10'
                        : 'border-border bg-card',
                  )}
                >
                  <p className="text-xs font-semibold truncate">{node.name}</p>
                  <p className="text-xs text-muted-foreground">{node.type}</p>
                  <Badge className="mt-2" variant="outline">
                    {state === 'down' ? 'DOWN' : state === 'at_risk' ? 'AT RISK' : 'HEALTHY'}
                  </Badge>
                </div>
              );
            })}
          </div>

          {(timelineEvents ?? []).map((event, index) => (
            <div
              key={`${event.nodeId}-${index}`}
              className={cn(
                'rounded-md border p-3 text-xs transition-all duration-300',
                index <= currentStep ? 'border-severity-critical/40 bg-severity-critical/5' : 'opacity-50',
              )}
            >
              <p className="font-medium">T+{event.timestampMinutes}m - {event.nodeName}</p>
              <p className="text-muted-foreground">{event.description}</p>
            </div>
          ))}
        </div>

        <div className="w-96 border-l bg-card p-4 space-y-4 overflow-y-auto">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Actions de remediation</h3>
          {(warRoomData.remediationActions ?? []).map((action) => (
            <div key={action.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{action.title}</p>
                <Badge variant="outline">{action.priority}</Badge>
              </div>
              <Badge
                className="mt-2"
                variant={action.status === 'completed' ? 'default' : action.status === 'in_progress' ? 'secondary' : 'outline'}
              >
                {action.status}
              </Badge>
            </div>
          ))}

          <div className="space-y-3 pt-2">
            <ImpactCard icon={Activity} label="Impactes" value={downNodes} total={totalNodes} color="text-severity-critical" animated={phase === 'propagating'} currency={currency} />
            <ImpactCard icon={DollarSign} label="Cout/heure" value={hourlyLoss ?? 0} format="currency" color="text-severity-medium" animated={phase === 'propagating'} currency={currency} />
            <ImpactCard icon={DollarSign} label="Perte cumulee" value={cumulativeBusinessLoss ?? 0} format="currency" color="text-severity-critical" animated={phase === 'propagating'} currency={currency} />
            <ImpactCard icon={DollarSign} label="Cout recovery estime" value={recoveryCostEstimate ?? 0} format="currency" color="text-severity-high" animated={phase === 'propagating'} currency={currency} />
            <ImpactCard icon={DollarSign} label="Perte business finale" value={projectedBusinessLoss ?? 0} format="currency" color="text-severity-critical" animated={phase === 'propagating'} currency={currency} />
            <ImpactCard icon={Clock} label="Utilisateurs impactes" value={estimatedUsers ?? 0} color="text-severity-high" animated={phase === 'propagating'} currency={currency} />
          </div>

          {(result.warRoomFinancial?.nodeCostBreakdown?.length ?? 0) > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top couts noeuds impactes</h4>
              {(result.warRoomFinancial?.nodeCostBreakdown ?? []).slice(0, 5).map((node) => (
                <div key={node.nodeId} className="rounded-md border bg-background px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{node.nodeName}</span>
                    <span className="font-mono">{formatCurrency(node.costPerHour, currency)}/h</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-muted-foreground">
                    <span>{node.nodeType}</span>
                    <span>RTO {Math.max(1, Math.round(node.rtoMinutes))} min</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">RTO/RPO</h4>
            {(result.impactedServices ?? []).slice(0, 5).map((service) => {
              const rtoMinutes = Math.max(service.estimatedRTO ?? 1, 1);
              const rtoProgress = Math.min((elapsedSeconds / 60 / rtoMinutes) * 100, 100);
              return (
                <div key={service.serviceName} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{service.serviceName}</span>
                    <span className="font-mono text-muted-foreground">RTO: {rtoMinutes}min</span>
                  </div>
                  <Progress value={rtoProgress ?? 0} className="h-1.5" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={isPlaying ? pauseAnimation : startAnimation} aria-label={isPlaying ? 'Pause' : 'Lecture'}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetAnimation} aria-label="Reinitialiser">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 relative">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-severity-critical transition-all duration-500 rounded-full" style={{ width: `${timelinePosition ?? 0}%` }} />
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {phase === 'complete'
              ? <Badge variant="outline" className="text-resilience-high border-resilience-high">Simulation terminee</Badge>
              : phase === 'idle'
                ? <span>Pret</span>
                : <span className="animate-pulse">En cours...</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpactCard({
  icon: Icon,
  label,
  value,
  total,
  format,
  color,
  animated,
  currency,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  total?: number;
  format?: 'currency';
  color: string;
  animated?: boolean;
  currency: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className={cn('h-3.5 w-3.5', color)} />
        {label}
      </div>
      <p className={cn('text-xl font-bold tabular-nums', color, animated && 'animate-pulse')}>
        {format === 'currency' ? formatCurrency(value ?? 0, currency) : value ?? 0}
        {total !== undefined && <span className="text-sm font-normal text-muted-foreground">/{total ?? 0}</span>}
      </p>
    </div>
  );
}

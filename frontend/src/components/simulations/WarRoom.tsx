import { useState, useEffect, useCallback, useRef } from 'react';
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

export function WarRoom({ open, onClose, scenarioName, scenarioType: _scenarioType, result, onGenerateReport }: WarRoomProps) {
  const [phase, setPhase] = useState<AnimationPhase>('idle');
  const [currentStep, setCurrentStep] = useState(0);
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [nodeStates, setNodeStates] = useState<Record<string, NodeVisualState>>({});
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
  const impactedNodes = warRoomData.impactedNodes?.length ? warRoomData.impactedNodes : (result.affectedNodes ?? []).map((node) => ({
    id: node.nodeId,
    name: node.nodeName,
    type: node.nodeType,
    status: node.status,
    impactedAt: node.cascadeLevel,
    estimatedRecovery: 60,
  }));

  const totalNodes = impactedNodes.length ?? 0;
  const downNodes = Object.values(nodeStates).filter((s) => s === 'down').length;
  const estimatedUsers = (result.impactedServices ?? []).reduce((acc, s) => acc + (s.impact !== 'none' ? 100 : 0), 0);
  const hourlyLoss = (result.financialLoss ?? 0) / Math.max((result.estimatedDowntime ?? 0) / 60, 1);

  const startAnimation = useCallback(() => {
    setPhase('initial');
    setCurrentStep(0);
    setTimelinePosition(0);
    setNodeStates({});
    setIsPlaying(true);
    setElapsedSeconds(0);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    let step = 0;
    const animateStep = () => {
      if (step >= timelineEvents.length) {
        setPhase('complete');
        setIsPlaying(false);
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      setPhase('propagating');
      setCurrentStep(step);
      const event = timelineEvents[step];

      setNodeStates((prev) => {
        const next = { ...prev };
        next[event.nodeId] = 'at_risk';
        setTimeout(() => {
          setNodeStates((later) => ({ ...later, [event.nodeId]: 'down' }));
        }, 250);
        return next;
      });

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
    setNodeStates({});
  }, []);

  useEffect(() => {
    return () => {
      if (animationRef.current) clearTimeout(animationRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(startAnimation, 500);
      return () => clearTimeout(t);
    }
    resetAnimation();
    return () => undefined;
  }, [open, startAnimation, resetAnimation]);

  if (!open) return null;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true" aria-label="War Room — Simulation d'impact">
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
            <span>🔴 Services down: {downNodes}/{Math.max(totalNodes, 1)}</span>
            <span>⏱️ Temps: {Math.floor(elapsedSeconds / 60)}min</span>
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
                        : 'border-border bg-card'
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

          {(timelineEvents ?? []).map((event, i) => (
            <div
              key={`${event.nodeId}-${i}`}
              className={cn('rounded-md border p-3 text-xs transition-all duration-300', i <= currentStep ? 'border-severity-critical/40 bg-severity-critical/5' : 'opacity-50')}
            >
              <p className="font-medium">T+{event.timestampMinutes}m — {event.nodeName}</p>
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
            <ImpactCard icon={Activity} label="Impactes" value={downNodes} total={totalNodes} color="text-severity-critical" animated={phase === 'propagating'} />
            <ImpactCard icon={DollarSign} label="Cout/heure" value={hourlyLoss ?? 0} format="currency" color="text-severity-medium" animated={phase === 'propagating'} />
            <ImpactCard icon={Clock} label="Utilisateurs impactes" value={estimatedUsers ?? 0} color="text-severity-high" animated={phase === 'propagating'} />
          </div>

          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">RTO/RPO</h4>
            {(result.impactedServices ?? []).slice(0, 5).map((svc) => {
              const rtoMinutes = Math.max(svc.estimatedRTO ?? 1, 1);
              const rtoProgress = Math.min((elapsedSeconds / 60 / rtoMinutes) * 100, 100);
              return (
                <div key={svc.serviceName} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{svc.serviceName}</span>
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
            {phase === 'complete' ? <Badge variant="outline" className="text-resilience-high border-resilience-high">Simulation terminee</Badge> : phase === 'idle' ? <span>Pret</span> : <span className="animate-pulse">En cours...</span>}
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
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  total?: number;
  format?: 'currency';
  color: string;
  animated?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className={cn('h-3.5 w-3.5', color)} />
        {label}
      </div>
      <p className={cn('text-xl font-bold tabular-nums', color, animated && 'animate-pulse')}>
        {format === 'currency' ? formatCurrency(value ?? 0) : value ?? 0}
        {total !== undefined && <span className="text-sm font-normal text-muted-foreground">/{total ?? 0}</span>}
      </p>
    </div>
  );
}

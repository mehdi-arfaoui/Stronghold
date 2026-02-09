import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Download,
  AlertTriangle,
  Clock,
  Users,
  DollarSign,
  Activity,
  Zap,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import type { SimulationResult } from '@/types/simulation.types';

interface WarRoomProps {
  open: boolean;
  onClose: () => void;
  scenarioName: string;
  scenarioType: string;
  result: SimulationResult;
  onGenerateReport?: () => void;
}

type AnimationPhase = 'idle' | 'initial' | 'propagating' | 'complete';

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
  const [visibleNodes, setVisibleNodes] = useState<Set<string>>(new Set());
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const severity = getSeverity(result.infrastructureImpact);
  const sevConfig = SEVERITY_CONFIG[severity];

  const totalAffected = result.affectedNodes.length;
  const estimatedUsers = result.impactedServices.reduce((acc, s) => acc + (s.impact !== 'none' ? 100 : 0), 0);
  const hourlyLoss = result.financialLoss / Math.max(result.estimatedDowntime / 60, 1);

  // Animation controller
  const startAnimation = useCallback(() => {
    setPhase('initial');
    setCurrentStep(0);
    setVisibleNodes(new Set());
    setIsPlaying(true);
    setElapsedSeconds(0);

    // Start timer
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    // Animate cascade steps
    let step = 0;
    const animateStep = () => {
      if (step >= result.cascadeSteps.length) {
        setPhase('complete');
        setIsPlaying(false);
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      setPhase('propagating');
      setCurrentStep(step);
      const cascadeStep = result.cascadeSteps[step];

      // Add nodes from this step
      setVisibleNodes((prev) => {
        const next = new Set(prev);
        cascadeStep.nodesAffected.forEach((id) => next.add(id));
        return next;
      });

      setTimelinePosition(((step + 1) / result.cascadeSteps.length) * 100);
      step++;
      animationRef.current = setTimeout(animateStep, 800);
    };

    // Start with initial flash
    setTimeout(animateStep, 500);
  }, [result]);

  const pauseAnimation = () => {
    setIsPlaying(false);
    if (animationRef.current) clearTimeout(animationRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const resetAnimation = () => {
    pauseAnimation();
    setPhase('idle');
    setCurrentStep(0);
    setVisibleNodes(new Set());
    setTimelinePosition(0);
    setElapsedSeconds(0);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) clearTimeout(animationRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Auto-start on open
  useEffect(() => {
    if (open) {
      const t = setTimeout(startAnimation, 600);
      return () => clearTimeout(t);
    }
    return () => resetAnimation();
  }, [open]);

  if (!open) return null;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="War Room — Simulation d'impact"
    >
      {/* Header */}
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

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Infrastructure Map */}
        <div className="flex-1 p-6 overflow-auto">
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {result.affectedNodes.map((node, i) => {
              const isVisible = visibleNodes.has(node.nodeId);
              const isDown = node.status === 'down';

              return (
                <div
                  key={node.nodeId}
                  className={cn(
                    'relative rounded-lg border p-3 transition-all duration-500',
                    isVisible
                      ? isDown
                        ? 'border-severity-critical bg-severity-critical/10 shadow-lg shadow-severity-critical/20'
                        : 'border-severity-medium bg-severity-medium/10'
                      : 'border-border bg-card opacity-60'
                  )}
                  style={{
                    transitionDelay: isVisible ? `${i * 50}ms` : '0ms',
                  }}
                >
                  {isVisible && isDown && (
                    <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-severity-critical animate-ping" />
                  )}
                  <div className="flex items-center gap-2">
                    <Server className={cn('h-4 w-4', isVisible ? (isDown ? 'text-severity-critical' : 'text-severity-medium') : 'text-muted-foreground')} />
                    <span className="text-xs font-medium truncate">{node.nodeName}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{node.nodeType}</p>
                  {isVisible && (
                    <Badge variant="outline" className={cn('mt-2 text-xs', isDown ? 'border-severity-critical text-severity-critical' : 'border-severity-medium text-severity-medium')}>
                      {isDown ? 'DOWN' : 'DEGRADED'}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>

          {result.affectedNodes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Activity className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Aucun noeud impacte dans cette simulation.</p>
            </div>
          )}
        </div>

        {/* Right: Impact Panel */}
        <div className="w-80 border-l bg-card p-4 space-y-4 overflow-y-auto">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Impact en temps reel
          </h3>

          {/* Counter Cards */}
          <div className="space-y-3">
            <ImpactCard
              icon={Server}
              label="Services impactes"
              value={visibleNodes.size}
              total={totalAffected}
              color="text-severity-critical"
              animated={phase === 'propagating'}
            />
            <ImpactCard
              icon={Users}
              label="Utilisateurs affectes"
              value={phase !== 'idle' ? estimatedUsers : 0}
              color="text-severity-high"
              animated={phase === 'propagating'}
            />
            <ImpactCard
              icon={DollarSign}
              label="Cout/heure"
              value={phase !== 'idle' ? hourlyLoss : 0}
              format="currency"
              color="text-severity-medium"
              animated={phase === 'propagating'}
            />
          </div>

          {/* RTO/RPO Indicators */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">RTO/RPO</h4>
            {result.impactedServices.slice(0, 5).map((svc) => {
              const rtoMinutes = svc.estimatedRTO;
              const rtoProgress = Math.min((elapsedSeconds / 60 / rtoMinutes) * 100, 100);
              const rtoBreach = rtoProgress >= 100;

              return (
                <div key={svc.serviceName} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{svc.serviceName}</span>
                    <span className={cn('font-mono', rtoBreach ? 'text-severity-critical' : 'text-muted-foreground')}>
                      RTO: {rtoMinutes}min
                    </span>
                  </div>
                  <Progress
                    value={rtoProgress}
                    className={cn('h-1.5', rtoBreach ? '[&>div]:bg-severity-critical' : rtoProgress > 75 ? '[&>div]:bg-severity-medium' : '[&>div]:bg-resilience-high')}
                  />
                </div>
              );
            })}
          </div>

          {/* Cascade Steps */}
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Propagation</h4>
            {result.cascadeSteps.map((step, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-md border p-2 text-xs transition-all duration-300',
                  i <= currentStep && phase !== 'idle'
                    ? 'border-severity-critical/50 bg-severity-critical/5'
                    : 'border-transparent opacity-50'
                )}
              >
                <p className="font-medium">Etape {step.step}</p>
                <p className="text-muted-foreground">{step.description}</p>
                <p className="text-severity-critical mt-1">{step.nodesAffected.length} noeud(s)</p>
              </div>
            ))}
          </div>

          {/* Recommendations */}
          {phase === 'complete' && result.recommendations.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommandations</h4>
              {result.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-severity-medium shrink-0 mt-0.5" />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="border-t bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={isPlaying ? pauseAnimation : startAnimation}
              aria-label={isPlaying ? 'Pause' : 'Lecture'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetAnimation} aria-label="Reinitialiser">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 relative">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-severity-critical transition-all duration-500 rounded-full"
                style={{ width: `${timelinePosition}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>T0 — Debut de l'incident</span>
              {result.cascadeSteps.length > 0 && (
                <span>T+{result.cascadeSteps.length} etapes — Propagation complete</span>
              )}
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {phase === 'complete' ? (
              <Badge variant="outline" className="text-resilience-high border-resilience-high">Simulation terminee</Badge>
            ) : phase === 'idle' ? (
              <span>Pret</span>
            ) : (
              <span className="animate-pulse">En cours...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Impact metric card */
function ImpactCard({
  icon: Icon,
  label,
  value,
  total,
  format,
  color,
  animated,
}: {
  icon: typeof Server;
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
        {format === 'currency' ? formatCurrency(value) : value}
        {total !== undefined && <span className="text-sm font-normal text-muted-foreground">/{total}</span>}
      </p>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Zap,
  Server,
  Clock,
  DollarSign,
  AlertTriangle,
  ArrowRight,
  Target,
  Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDuration } from '@/lib/formatters';
import type { SimulationResult } from '@/types/simulation.types';

interface BlastRadiusDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenWarRoom: () => void;
  scenarioName: string;
  result: SimulationResult;
}

export function BlastRadiusDrawer({
  open,
  onClose,
  onOpenWarRoom,
  scenarioName,
  result,
}: BlastRadiusDrawerProps) {
  const [revealedSteps, setRevealedSteps] = useState(0);
  const [revealedNodes, setRevealedNodes] = useState<Set<string>>(new Set());
  const [animationDone, setAnimationDone] = useState(false);
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalSteps = result.cascadeSteps.length;
  const totalAffected = result.affectedNodes.length;
  const downNodes = result.affectedNodes.filter((n) => n.status === 'down').length;
  const degradedNodes = result.affectedNodes.filter((n) => n.status === 'degraded').length;
  const avgRTO =
    result.impactedServices.length > 0
      ? Math.round(
          result.impactedServices.reduce((sum, s) => sum + s.estimatedRTO, 0) /
            result.impactedServices.length
        )
      : 0;
  const dependenciesAffected = result.impactedServices.filter(
    (s) => s.impact !== 'none'
  ).length;

  // Cascade reveal animation
  const startReveal = useCallback(() => {
    setRevealedSteps(0);
    setRevealedNodes(new Set());
    setAnimationDone(false);

    let step = 0;
    const reveal = () => {
      if (step >= totalSteps) {
        setAnimationDone(true);
        return;
      }

      const cascadeStep = result.cascadeSteps[step];
      setRevealedSteps(step + 1);
      setRevealedNodes((prev) => {
        const next = new Set(prev);
        cascadeStep.nodesAffected.forEach((id) => next.add(id));
        return next;
      });

      step++;
      animRef.current = setTimeout(reveal, 600);
    };

    animRef.current = setTimeout(reveal, 400);
  }, [result.cascadeSteps, totalSteps]);

  useEffect(() => {
    if (open) {
      startReveal();
    }
    return () => {
      if (animRef.current) clearTimeout(animRef.current);
    };
  }, [open, startReveal]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Blast Radius — Zone d'impact"
    >
      <div className="relative flex h-[90vh] w-[95vw] max-w-6xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-severity-critical/10">
              <Target className="h-5 w-5 text-severity-critical" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Blast Radius</h2>
              <p className="text-sm text-muted-foreground">{scenarioName}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Main: Cascade visualization */}
          <div className="flex-1 overflow-auto p-6">
            {/* Blast radius rings */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Propagation en cascade
              </h3>
              <div className="space-y-3">
                {result.cascadeSteps.map((step, i) => {
                  const isRevealed = i < revealedSteps;
                  const nodesInStep = result.affectedNodes.filter((n) =>
                    step.nodesAffected.includes(n.nodeId)
                  );

                  return (
                    <div
                      key={i}
                      className={cn(
                        'rounded-lg border p-4 transition-all duration-500',
                        isRevealed
                          ? 'border-severity-critical/40 bg-severity-critical/5 opacity-100 translate-y-0'
                          : 'border-transparent opacity-0 translate-y-2'
                      )}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs transition-colors duration-300',
                            isRevealed && 'border-severity-critical text-severity-critical'
                          )}
                        >
                          T+{step.step}
                        </Badge>
                        <span className="text-sm font-medium">{step.description}</span>
                      </div>

                      {isRevealed && (
                        <div className="flex flex-wrap gap-2">
                          {nodesInStep.map((node, nodeIdx) => (
                            <div
                              key={node.nodeId}
                              className={cn(
                                'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-all duration-300',
                                node.status === 'down'
                                  ? 'border-severity-critical/50 bg-severity-critical/10 text-severity-critical'
                                  : 'border-severity-medium/50 bg-severity-medium/10 text-severity-medium'
                              )}
                              style={{ animationDelay: `${nodeIdx * 80}ms` }}
                            >
                              <Server className="h-3 w-3" />
                              <span>{node.nodeName}</span>
                              {node.status === 'down' && (
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-severity-critical animate-pulse" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Impact summary after animation completes */}
            {animationDone && result.recommendations.length > 0 && (
              <div className="mt-4 rounded-lg border border-severity-medium/30 bg-severity-medium/5 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4 text-severity-medium" />
                  Recommandations immediates
                </h4>
                <ul className="space-y-1">
                  {result.recommendations.slice(0, 4).map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-1 shrink-0 text-severity-medium">•</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right panel: Metrics */}
          <div className="w-72 shrink-0 border-l bg-card p-5 space-y-5 overflow-y-auto">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Metriques d'impact
            </h3>

            <MetricCard
              icon={Zap}
              label="Impact infrastructure"
              value={`${Math.round(result.infrastructureImpact)}%`}
              color="text-severity-critical"
              revealed={revealedSteps > 0}
            />

            <MetricCard
              icon={Server}
              label="Noeuds affectes"
              value={`${revealedNodes.size}`}
              suffix={`/ ${totalAffected}`}
              detail={`${downNodes} down, ${degradedNodes} degrades`}
              color="text-severity-high"
              revealed={revealedSteps > 0}
            />

            <MetricCard
              icon={Clock}
              label="RTO moyen impacte"
              value={formatDuration(avgRTO)}
              color="text-severity-medium"
              revealed={revealedSteps > 0}
            />

            <MetricCard
              icon={DollarSign}
              label="Cout estime du downtime"
              value={formatCurrency(result.financialLoss)}
              color="text-severity-high"
              revealed={animationDone}
            />

            <MetricCard
              icon={Link2}
              label="Dependances impactees"
              value={`${dependenciesAffected}`}
              color="text-severity-medium"
              revealed={revealedSteps > 0}
            />

            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Score avant</span>
                <span className="font-mono font-bold">{result.resilienceScoreBefore}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Score apres</span>
                <span className="font-mono font-bold text-severity-critical">
                  {result.resilienceScoreAfter}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-severity-critical transition-all duration-1000 rounded-full"
                  style={{
                    width: animationDone
                      ? `${100 - result.resilienceScoreAfter}%`
                      : '0%',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          <div className="text-sm text-muted-foreground">
            {animationDone ? (
              <span>
                Propagation terminee — {totalSteps} etape(s), {totalAffected} noeud(s) impacte(s)
              </span>
            ) : (
              <span className="animate-pulse">
                Propagation en cours... etape {revealedSteps}/{totalSteps}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
            <Button onClick={onOpenWarRoom}>
              <Zap className="mr-2 h-4 w-4" />
              Ouvrir la War Room
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Metric card with reveal animation */
function MetricCard({
  icon: Icon,
  label,
  value,
  suffix,
  detail,
  color,
  revealed,
}: {
  icon: typeof Server;
  label: string;
  value: string;
  suffix?: string;
  detail?: string;
  color: string;
  revealed: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-background p-3 transition-all duration-500',
        revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className={cn('h-3.5 w-3.5', color)} />
        {label}
      </div>
      <p className={cn('text-lg font-bold tabular-nums', color)}>
        {value}
        {suffix && (
          <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
        )}
      </p>
      {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  );
}

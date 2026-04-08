import type { CoverageVerdict, Scenario } from '@stronghold-dr/core';
import {
  AlertTriangle,
  Database,
  Globe2,
  MapPinned,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

function resolveScenarioIcon(type: Scenario['type']): LucideIcon {
  switch (type) {
    case 'az_failure':
      return MapPinned;
    case 'region_failure':
      return Globe2;
    case 'data_corruption':
      return Database;
    case 'node_failure':
      return AlertTriangle;
    case 'service_outage':
    case 'custom':
    default:
      return ShieldAlert;
  }
}

function verdictClasses(verdict: CoverageVerdict | undefined): string {
  switch (verdict) {
    case 'covered':
      return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25';
    case 'partially_covered':
      return 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/25';
    case 'degraded':
      return 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25';
    case 'uncovered':
    default:
      return 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/25';
  }
}

function formatVerdict(verdict: CoverageVerdict | undefined): string {
  return verdict ? String(verdict).replace('_', ' ').toUpperCase() : 'UNKNOWN';
}

function formatScenarioType(type: Scenario['type']): string {
  switch (type) {
    case 'az_failure':
      return 'AZ failure';
    case 'region_failure':
      return 'Region failure';
    case 'node_failure':
      return 'SPOF failure';
    case 'data_corruption':
      return 'Data corruption';
    case 'service_outage':
      return 'Service outage';
    case 'custom':
    default:
      return 'Custom';
  }
}

export function ScenarioCard({
  scenario,
  selected,
  onClick,
}: {
  readonly scenario: Scenario;
  readonly selected: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  const Icon = resolveScenarioIcon(scenario.type);
  const affectedServices =
    scenario.impact?.serviceImpact.filter((impact) => impact.status !== 'unaffected').length ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-3xl border bg-card/80 p-5 text-left transition-all duration-150',
        selected
          ? 'border-accent/40 shadow-panel'
          : 'border-border hover:border-accent/25 hover:bg-card',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-accent-soft p-3 text-accent">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">
              {formatScenarioType(scenario.type)}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">{scenario.name}</h3>
          </div>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em]', verdictClasses(scenario.coverage?.verdict))}>
          {formatVerdict(scenario.coverage?.verdict)}
        </span>
      </div>
      <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">{scenario.description}</p>
      <div className="mt-5 flex items-center justify-between gap-4 text-sm">
        <span className="text-foreground">
          {affectedServices} affected service{affectedServices === 1 ? '' : 's'}
        </span>
        <span className="text-muted-foreground">
          {scenario.impact?.totalAffectedNodes ?? 0} affected node{(scenario.impact?.totalAffectedNodes ?? 0) === 1 ? '' : 's'}
        </span>
      </div>
    </button>
  );
}

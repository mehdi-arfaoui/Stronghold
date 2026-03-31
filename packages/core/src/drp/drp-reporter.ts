import type { DRPComponent, DRPlan, RTOEstimate } from './drp-types.js';

/** Formats a DR plan into a human-readable component report. */
export function formatDrPlanReport(plan: DRPlan): string {
  const lines = [`STRONGHOLD DR Plan Report`, `Generated: ${plan.generated}`, ''];

  for (const service of plan.services) {
    lines.push(`${service.name} [${service.criticality}]`);
    for (const component of service.components) {
      lines.push(...formatComponent(component));
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}

function formatComponent(component: DRPComponent): readonly string[] {
  const estimate = component.rtoEstimate;
  const descriptor = buildDescriptor(component);
  const lines = [`  ${component.name} (${descriptor})`];

  lines.push(`  |- Strategy: ${describeStrategy(component)}`);
  lines.push(`  |- RTO: ${describeRto(estimate)}`);

  if (estimate) {
    lines.push(`  |  |- Method: ${estimate.method}`);
    if (estimate.factors.length > 0) {
      lines.push(`  |  |- Observed factors:`);
      for (const factor of estimate.factors) {
        lines.push(`  |  |  |- ${humanizeFactorName(factor.name)}: ${factor.value}`);
      }
    }
    if (estimate.limitations.length > 0) {
      lines.push(`  |  |- Limitations:`);
      for (const limitation of estimate.limitations) {
        lines.push(`  |  |  |- ${limitation}`);
      }
    }
    if (estimate.rtoMaxMinutes === null || estimate.confidence === 'unverified') {
      lines.push(`  |  |- Recommendation: Run a restore test to establish baseline RTO`);
    }
  }

  lines.push(`  |- RPO: ${describeRpo(estimate)}`);
  lines.push(`  |- Chain RTO: ${describeChainRto(component)}`);
  return lines;
}

function buildDescriptor(component: DRPComponent): string {
  const parts = [component.resourceType];
  const dataVolume = component.rtoEstimate?.factors.find((factor) => factor.name === 'data_volume');
  const storageType = component.rtoEstimate?.factors.find((factor) => factor.name === 'storage_type');

  if (dataVolume) parts.push(dataVolume.value);
  if (storageType) parts.push(storageType.value);
  return parts.join(', ');
}

function describeStrategy(component: DRPComponent): string {
  const recoveryFactor = component.rtoEstimate?.factors.find(
    (factor) => factor.name === 'recovery_strategy',
  );
  if (recoveryFactor?.value === 'multi_az_failover') return 'hot_standby (Multi-AZ failover)';
  if (recoveryFactor?.value === 'aurora_replica_failover') {
    return 'aurora_failover (cluster replica failover)';
  }
  if (recoveryFactor?.value === 'aurora_global_failover') {
    return 'aurora_global_failover (cross-region promotion)';
  }
  if (recoveryFactor?.value === 'read_replica_promotion') {
    return 'warm_standby (Read replica promotion)';
  }
  if (component.recoveryStrategy === 'restore_from_backup') return 'backup_restore (snapshot)';
  if (component.recoveryStrategy === 'rebuild') return 'full_rebuild';
  return component.recoveryStrategy;
}

function describeRto(estimate: RTOEstimate | undefined): string {
  if (!estimate || estimate.rtoMaxMinutes === null || estimate.rtoMinMinutes === null) {
    return 'REQUIRES TESTING - no reliable estimate without restore test';
  }
  return `${formatRange(estimate.rtoMinMinutes, estimate.rtoMaxMinutes)} (${estimate.confidence})`;
}

function describeRpo(estimate: RTOEstimate | undefined): string {
  if (!estimate) return 'unknown';
  if (estimate.rpoMinMinutes === null || estimate.rpoMaxMinutes === null) {
    const noBackup = estimate.factors.find((factor) => factor.name === 'no_backup');
    if (noBackup) return 'unknown from scan - no backup detected';
    return 'unknown from scan';
  }
  return `${formatRange(estimate.rpoMinMinutes, estimate.rpoMaxMinutes)} (${estimate.confidence})`;
}

function describeChainRto(component: DRPComponent): string {
  const effective = component.effectiveRTO;
  if (!effective) return 'unknown';
  if (effective.chainRTOMin === null || effective.chainRTOMax === null) {
    return effective.chainContainsUnverified
      ? 'REQUIRES TESTING (unverified component in chain)'
      : 'unknown';
  }
  if (effective.bottleneck) {
    return `${formatRange(effective.chainRTOMin, effective.chainRTOMax)} (bottleneck: ${effective.bottleneck})`;
  }
  return `${formatRange(effective.chainRTOMin, effective.chainRTOMax)} (this component is the bottleneck)`;
}

function formatRange(minMinutes: number, maxMinutes: number): string {
  if (minMinutes === maxMinutes) return `${minMinutes} min`;
  return `${minMinutes}-${maxMinutes} min`;
}

function humanizeFactorName(name: string): string {
  return name.replace(/_/g, ' ');
}

import type { GraphInstance } from '../graph/index.js';
import type { InfraNodeAttrs } from '../types/index.js';
import type { DRPlan, DRPlanValidationIssue, DRPlanValidationReport } from './drp-types.js';
import { calculateInfrastructureHash } from './drp-generator.js';
import { determineRecoveryStrategy } from './recovery-strategies.js';

/** Validates a DRP against the current infrastructure graph. */
export function validateDrPlan(plan: DRPlan, graph: GraphInstance): DRPlanValidationReport {
  const currentInfrastructureHash = calculateInfrastructureHash(graph);
  const issues: DRPlanValidationIssue[] = [];
  const missingComponents = new Set<string>();
  const outdatedStrategies = new Set<string>();

  if (plan.infrastructureHash !== currentInfrastructureHash) {
    issues.push({
      code: 'infrastructure_hash_changed',
      severity: 'high',
      description: 'Infrastructure hash changed since the DR plan was generated.',
      expected: plan.infrastructureHash,
      actual: currentInfrastructureHash,
    });
  }

  for (const service of plan.services) {
    for (const component of service.components) {
      if (!graph.hasNode(component.resourceId)) {
        missingComponents.add(component.resourceId);
        issues.push({
          code: 'missing_component',
          severity: 'critical',
          resourceId: component.resourceId,
          description: `Component ${component.resourceId} no longer exists in the current infrastructure.`,
          expected: component.resourceType,
          actual: 'missing',
        });
        continue;
      }

      const currentNode = graph.getNodeAttributes(
        component.resourceId,
      ) as unknown as InfraNodeAttrs;
      const currentStrategy = determineRecoveryStrategy(currentNode);
      if (currentStrategy !== component.recoveryStrategy) {
        outdatedStrategies.add(component.resourceId);
        issues.push({
          code: 'strategy_changed',
          severity: 'high',
          resourceId: component.resourceId,
          description: `Recovery strategy for ${component.name} changed from ${component.recoveryStrategy} to ${currentStrategy}.`,
          expected: component.recoveryStrategy,
          actual: currentStrategy,
        });
      }
    }
  }

  const sortedIssues = issues.sort(compareIssues);
  return {
    isValid: sortedIssues.length === 0,
    valid: sortedIssues.length === 0,
    stale: sortedIssues.length > 0,
    planInfrastructureHash: plan.infrastructureHash,
    currentInfrastructureHash,
    missingComponents: Array.from(missingComponents).sort(),
    outdatedStrategies: Array.from(outdatedStrategies).sort(),
    issues: sortedIssues,
  };
}

/** Backward-compatible alias for DR plan validation. */
export function validateDRPlan(plan: DRPlan, graph: GraphInstance): DRPlanValidationReport {
  return validateDrPlan(plan, graph);
}

function compareIssues(left: DRPlanValidationIssue, right: DRPlanValidationIssue): number {
  return (
    severityRank(right.severity) - severityRank(left.severity) ||
    String(left.resourceId ?? '').localeCompare(String(right.resourceId ?? '')) ||
    left.code.localeCompare(right.code)
  );
}

function severityRank(severity: DRPlanValidationIssue['severity']): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

import type { DriftRule } from './drift-rules.js';
import { DEFAULT_DRIFT_RULES } from './drift-rules.js';
import type {
  DriftCategory,
  DriftChange,
  DriftReport,
  DriftSeverity,
  InfrastructureNode,
} from './drift-types.js';

export interface DetectDriftOptions {
  readonly scanIdBefore: string;
  readonly scanIdAfter: string;
  readonly timestamp?: Date;
  readonly rules?: readonly DriftRule[];
}

const SEVERITIES: readonly DriftSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const CATEGORIES: readonly DriftCategory[] = [
  'backup_changed',
  'redundancy_changed',
  'network_changed',
  'security_changed',
  'resource_added',
  'resource_removed',
  'config_changed',
  'dependency_changed',
];
const SEVERITY_ORDER: Record<DriftSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};
const EMPTY_AFFECTED_SERVICES: readonly string[] = [];

/**
 * Detects drift between two infrastructure snapshots using deterministic resource matching by ID.
 */
export function detectDrift(
  before: readonly InfrastructureNode[],
  after: readonly InfrastructureNode[],
  options: DetectDriftOptions,
): DriftReport {
  const beforeById = new Map(before.map((node) => [node.id, node]));
  const afterById = new Map(after.map((node) => [node.id, node]));
  const rules = options.rules ?? DEFAULT_DRIFT_RULES;
  const changes: DriftChange[] = [];

  for (const node of after) {
    if (!beforeById.has(node.id)) changes.push(createAddedChange(node));
  }

  for (const node of before) {
    if (!afterById.has(node.id)) changes.push(createRemovedChange(node));
  }

  for (const node of before) {
    const current = afterById.get(node.id);
    if (!current) continue;
    for (const rule of rules) {
      const change = rule.check(node, current);
      if (change) changes.push(change);
    }
  }

  const sortedChanges = changes
    .filter((change, index, all) => all.findIndex((entry) => entry.id === change.id) === index)
    .sort(compareChanges);

  return {
    scanIdBefore: options.scanIdBefore,
    scanIdAfter: options.scanIdAfter,
    timestamp: options.timestamp ?? new Date(),
    changes: sortedChanges,
    summary: {
      total: sortedChanges.length,
      bySeverity: countBySeverity(sortedChanges),
      byCategory: countByCategory(sortedChanges),
      drpStale: hasCriticalChange(sortedChanges),
    },
  };
}

function createAddedChange(node: InfrastructureNode): DriftChange {
  return {
    id: `resource_added:${node.id}`,
    category: 'resource_added',
    severity: 'info',
    resourceId: node.id,
    resourceType: node.type,
    field: 'resource',
    previousValue: null,
    currentValue: node.name,
    description: `New resource discovered: ${node.name}.`,
    drImpact: 'Recovery inventory and dependency mappings should include this new component.',
    affectedServices: EMPTY_AFFECTED_SERVICES,
  };
}

function createRemovedChange(node: InfrastructureNode): DriftChange {
  return {
    id: `resource_removed:${node.id}`,
    category: 'resource_removed',
    severity: 'critical',
    resourceId: node.id,
    resourceType: node.type,
    field: 'resource',
    previousValue: node.name,
    currentValue: null,
    description: `Resource removed from the snapshot: ${node.name}.`,
    drImpact: getRemovalImpact(node.type),
    affectedServices: EMPTY_AFFECTED_SERVICES,
  };
}

function getRemovalImpact(resourceType: string): string {
  switch (resourceType) {
    case 'DATABASE':
    case 'CACHE':
    case 'OBJECT_STORAGE':
    case 'MESSAGE_QUEUE':
      return 'Recovery order, data restoration steps, and failover assumptions should be reviewed.';
    case 'VPC':
    case 'SUBNET':
    case 'LOAD_BALANCER':
    case 'FIREWALL':
      return 'Network recovery paths and isolation assumptions may no longer match the environment.';
    default:
      return 'The DR plan may reference a component that no longer exists and should be regenerated.';
  }
}

function countBySeverity(changes: readonly DriftChange[]): Record<DriftSeverity, number> {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
    DriftSeverity,
    number
  >;
  for (const change of changes) counts[change.severity] += 1;
  return counts;
}

function countByCategory(changes: readonly DriftChange[]): Record<DriftCategory, number> {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<
    DriftCategory,
    number
  >;
  for (const change of changes) counts[change.category] += 1;
  return counts;
}

function compareChanges(left: DriftChange, right: DriftChange): number {
  return (
    SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity] ||
    left.resourceType.localeCompare(right.resourceType) ||
    left.resourceId.localeCompare(right.resourceId) ||
    left.field.localeCompare(right.field) ||
    left.id.localeCompare(right.id)
  );
}

function hasCriticalChange(changes: readonly DriftChange[]): boolean {
  return changes.some((change) => change.severity === 'critical');
}

import { readBoolean } from '../../graph/analysis-helpers.js';
import type { InfraNodeAttrs } from '../../types/infrastructure.js';
import { collectNodeKinds, normalizeType } from '../../validation/validation-node-utils.js';
import type { DRPlan, DRPComponent } from '../drp-types.js';
import type { ComponentRunbook, DRPRunbook } from './runbook-types.js';
import { getRunbookStrategy } from './strategy-registry.js';

import './strategies/rds-failover.js';
import './strategies/rds-restore.js';
import './strategies/aurora-failover.js';
import './strategies/aurora-global-failover.js';
import './strategies/s3-restore.js';
import './strategies/ec2-recover.js';
import './strategies/dynamodb-restore.js';
import './strategies/elasticache-failover.js';
import './strategies/efs-restore.js';
import './strategies/lambda-redeploy.js';
import './strategies/eks-recover.js';
import './strategies/route53-failover.js';
import './strategies/generic-rebuild.js';

const KIND_PRIORITY = [
  'aurora-cluster',
  'rds-instance',
  'rds',
  's3-bucket',
  's3',
  'ec2-instance',
  'ec2',
  'dynamodb-table',
  'dynamodb',
  'elasticache',
  'efs-filesystem',
  'efs',
  'lambda-function',
  'lambda',
  'eks-cluster',
  'eks',
  'route53-record',
  'route53-hosted-zone',
] as const;

const RUNBOOK_DISCLAIMER =
  'This runbook is auto-generated from your infrastructure scan. Commands use real resource identifiers where available. ALWAYS test in a non-production environment first. Steps marked [APPROVAL REQUIRED] need human confirmation before execution. Stronghold does not execute these commands.';

const RUNBOOK_CONFIDENTIALITY_WARNING =
  'This runbook contains real resource identifiers (ARNs, IDs, names) and executable AWS CLI commands. Treat it with the same confidentiality as your infrastructure access credentials. Do not share publicly.';

interface RunbookEntry {
  readonly componentId: string;
  readonly componentName: string;
  readonly componentType: string;
  readonly strategy: string;
  readonly metadata: Record<string, unknown>;
}

/** Generates an executable DR runbook from the current DR plan and scanned nodes. */
export function generateRunbook(
  drpPlan: DRPlan,
  nodes: readonly InfraNodeAttrs[],
): DRPRunbook {
  const entries = collectRunbookEntries(drpPlan, nodes);
  const componentRunbooks = entries
    .map((entry) => buildComponentRunbook(entry))
    .filter((entry): entry is ComponentRunbook => entry !== null);

  return {
    drpPlanId: drpPlan.id,
    generatedAt: new Date().toISOString(),
    componentRunbooks,
    disclaimer: RUNBOOK_DISCLAIMER,
    confidentialityWarning: RUNBOOK_CONFIDENTIALITY_WARNING,
  };
}

function buildComponentRunbook(entry: RunbookEntry): ComponentRunbook | null {
  const strategyFn =
    getRunbookStrategy(entry.componentType, entry.strategy) ?? getRunbookStrategy('*', '*');
  if (!strategyFn) return null;

  return strategyFn(
    entry.componentId,
    entry.componentName,
    entry.componentType,
    entry.strategy,
    entry.metadata,
  );
}

function collectRunbookEntries(
  drpPlan: DRPlan,
  nodes: readonly InfraNodeAttrs[],
): readonly RunbookEntry[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const seen = new Set<string>();
  const entries: RunbookEntry[] = [];

  for (const service of drpPlan.services) {
    for (const componentId of service.recoveryOrder) {
      if (seen.has(componentId)) continue;
      const component = findComponent(drpPlan, service.components, componentId);
      if (!component) continue;

      seen.add(componentId);
      const node = nodeById.get(componentId);
      const metadata = enrichMetadata(node);
      entries.push({
        componentId,
        componentName: component.name,
        componentType: resolveComponentType(node, component),
        strategy: resolveRunbookStrategyName(component, metadata),
        metadata,
      });
    }
  }

  return entries;
}

function findComponent(
  drpPlan: DRPlan,
  serviceComponents: readonly DRPComponent[],
  componentId: string,
): DRPComponent | null {
  const direct = serviceComponents.find((component) => component.resourceId === componentId);
  if (direct) return direct;

  for (const service of drpPlan.services) {
    const match = service.components.find((component) => component.resourceId === componentId);
    if (match) return match;
  }

  return null;
}

function enrichMetadata(node: InfraNodeAttrs | undefined): Record<string, unknown> {
  if (!node) return {};
  return {
    ...node.metadata,
    tags: Object.keys(node.tags).length > 0 ? node.tags : node.metadata.tags,
    region: node.region ?? node.metadata.region,
    availabilityZone: node.availabilityZone ?? node.metadata.availabilityZone,
  };
}

function resolveComponentType(
  node: InfraNodeAttrs | undefined,
  component: DRPComponent,
): string {
  if (!node) return normalizeType(component.resourceType);

  const kinds = new Set(collectNodeKinds(node));
  if (kinds.has('dynamodb') && typeof node.metadata.tableName === 'string') {
    kinds.add('dynamodb-table');
  }
  if (kinds.has('lambda') && typeof node.metadata.functionName === 'string') {
    kinds.add('lambda-function');
  }
  if (kinds.has('eks') && node.type.toLowerCase().includes('kubernetes')) {
    kinds.add('eks-cluster');
  }

  for (const candidate of KIND_PRIORITY) {
    if (kinds.has(candidate)) return candidate;
  }

  return Array.from(kinds).sort()[0] ?? normalizeType(component.resourceType);
}

function resolveRunbookStrategyName(
  component: DRPComponent,
  metadata: Record<string, unknown>,
): string {
  if (component.recoveryStrategy === 'restore_from_backup') return 'backup_restore';
  if (component.recoveryStrategy === 'rebuild') return 'full_rebuild';
  if (
    component.recoveryStrategy === 'failover' &&
    isRdsLike(component) &&
    isHotStandby(metadata)
  ) {
    return 'hot_standby';
  }

  return component.recoveryStrategy;
}

function isRdsLike(component: DRPComponent): boolean {
  const normalized = normalizeType(component.resourceType);
  return normalized.includes('rds') || normalized === 'database';
}

function isHotStandby(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.multiAZ) === true ||
    readBoolean(metadata.multiAz) === true ||
    readBoolean(metadata.multi_az) === true ||
    readBoolean(metadata.isMultiAZ) === true
  );
}

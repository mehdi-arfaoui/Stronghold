import type { ComponentRunbook, DRPRunbook, RunbookCommand } from '../drp/runbook/runbook-types.js';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import { collectNodeReferences } from '../validation/validation-node-utils.js';
import type { RunbookValidation, StaleReference } from './scenario-types.js';

interface ReferenceMatch {
  readonly identifier: string;
  readonly componentId: string;
  readonly componentName: string;
  readonly componentType: string;
}

const RESOURCE_REFERENCE_FLAGS = new Set([
  'backup-plan-id',
  'backup-vault-name',
  'cache-cluster-id',
  'cluster-name',
  'db-cluster-identifier',
  'db-instance-identifier',
  'db-snapshot-identifier',
  'file-system-id',
  'function-name',
  'group-id',
  'health-check-id',
  'hosted-zone-id',
  'load-balancer-arn',
  'load-balancer-name',
  'mount-target-id',
  'nodegroup-name',
  'queue-name',
  'queue-url',
  'recovery-point-arn',
  'replication-group-id',
  'resource-arn',
  'resource-id',
  'source-db-instance-identifier',
  'source-table-name',
  'subnet-id',
  'table-name',
  'topic-arn',
  'topic-name',
  'vpc-id',
]);

const RESOURCE_TOKEN_PATTERNS = [
  /arn:aws:[^\s"'`]+/gi,
  /https:\/\/sqs\.[^\s"'`]+/gi,
  /\broute53-record:[a-z0-9_.:-]+\b/gi,
  /\b(?:i|sg|subnet|vpc|rtb|igw|nat|eni|eipalloc|eipassoc|vol|snap|fs|fsap|vpce|acl|lt|ami)-[a-z0-9-]+\b/gi,
  /\bz[a-z0-9]{6,}\b/gi,
] as const;

export function validateRunbookLiveness(
  runbook: DRPRunbook,
  currentNodes: readonly InfraNodeAttrs[],
): RunbookValidation {
  const referencesByNode = new Map(
    currentNodes.map((node) => [node.id, collectNodeReferences(node)] as const),
  );
  const currentNodeByReference = new Map<string, InfraNodeAttrs>();

  for (const node of currentNodes) {
    for (const reference of referencesByNode.get(node.id) ?? []) {
      if (!currentNodeByReference.has(reference)) {
        currentNodeByReference.set(reference, node);
      }
    }
  }

  const staleReferences: StaleReference[] = [];

  for (const component of runbook.componentRunbooks) {
    const candidateReferences = extractComponentReferences(component);
    const currentNode = currentNodeByReference.get(normalizeReference(component.componentId));

    if (!currentNode) {
      const firstStep = component.steps[0];
      staleReferences.push({
        stepId: buildStepId(component, firstStep?.order ?? 0),
        stepDescription: firstStep?.description ?? `Runbook for ${component.componentName}`,
        referencedResourceId: component.componentId,
        issue: 'resource_deleted',
        detail: `${component.componentName} (${component.componentId}) no longer exists in the latest scan.`,
      });
      continue;
    }

    if (currentNode.type !== component.componentType || currentNode.name !== component.componentName) {
      const firstStep = component.steps[0];
      staleReferences.push({
        stepId: buildStepId(component, firstStep?.order ?? 0),
        stepDescription: firstStep?.description ?? `Runbook for ${component.componentName}`,
        referencedResourceId: component.componentId,
        issue: 'resource_changed',
        detail: `Current node is ${currentNode.name} (${currentNode.type}); runbook expects ${component.componentName} (${component.componentType}).`,
      });
    }

    for (const step of component.steps) {
      const stepReferences = Array.from(candidateReferences).filter((reference) =>
        stepMentionsReference(step.command, reference.identifier),
      );
      if (stepReferences.length === 0) {
        continue;
      }

      for (const reference of stepReferences) {
        const liveNode = currentNodeByReference.get(normalizeReference(reference.identifier));
        if (!liveNode) {
          staleReferences.push({
            stepId: buildStepId(component, step.order),
            stepDescription: step.description,
            referencedResourceId: reference.identifier,
            issue: 'resource_not_found',
            detail: `Runbook step still references ${reference.identifier}, but that resource is not present in the latest scan.`,
          });
          continue;
        }

        if (liveNode.type !== reference.componentType && liveNode.id === component.componentId) {
          staleReferences.push({
            stepId: buildStepId(component, step.order),
            stepDescription: step.description,
            referencedResourceId: reference.identifier,
            issue: 'resource_changed',
            detail: `Runbook expects ${reference.componentType}, but the current resource type is ${liveNode.type}.`,
          });
        }
      }
    }
  }

  return {
    isAlive: staleReferences.length === 0,
    staleReferences,
  };
}

function extractComponentReferences(component: ComponentRunbook): readonly ReferenceMatch[] {
  const candidates = new Map<string, ReferenceMatch>();
  const baseReferences = [component.componentId, component.componentName];
  for (const reference of baseReferences) {
    addReferenceCandidate(candidates, {
      identifier: reference,
      componentId: component.componentId,
      componentName: component.componentName,
      componentType: component.componentType,
    });
  }

  const stepPatterns = component.steps.flatMap((step) => extractCandidatesFromCommand(step.command));
  for (const identifier of stepPatterns) {
    addReferenceCandidate(candidates, {
      identifier,
      componentId: component.componentId,
      componentName: component.componentName,
      componentType: component.componentType,
    });
  }

  return Array.from(candidates.values());
}

function addReferenceCandidate(
  target: Map<string, ReferenceMatch>,
  reference: ReferenceMatch,
): void {
  const normalized = normalizeReference(reference.identifier);
  if (!normalized) {
    return;
  }
  if (!target.has(normalized)) {
    target.set(normalized, {
      ...reference,
      identifier: normalized,
    });
  }
}

function extractCandidatesFromCommand(command: RunbookCommand): readonly string[] {
  const value = commandValue(command);
  if (!value) {
    return [];
  }

  const candidates = new Set<string>();

  for (const match of value.matchAll(/--([a-z0-9-]+)\s+("[^"]*"|'[^']*'|[^\s]+)/gi)) {
    const flag = normalizeReference(match[1] ?? '');
    const rawValue = match[2] ?? '';
    if (!RESOURCE_REFERENCE_FLAGS.has(flag)) {
      continue;
    }
    addCandidate(candidates, rawValue);
  }

  for (const pattern of RESOURCE_TOKEN_PATTERNS) {
    for (const match of value.matchAll(pattern)) {
      addCandidate(candidates, match[0] ?? '');
    }
  }

  return Array.from(candidates);
}

function commandValue(command: RunbookCommand): string {
  switch (command.type) {
    case 'aws_cli':
    case 'aws_wait':
      return command.command;
    case 'aws_console':
      return command.consoleUrl;
    case 'script':
      return command.scriptContent;
    case 'manual':
    default:
      return command.description;
  }
}

function stepMentionsReference(command: RunbookCommand, reference: string): boolean {
  return normalizeReference(commandValue(command)).includes(reference);
}

function normalizeReference(value: string): string {
  return value
    .trim()
    .replace(/^[\s"'`([{<]+|[\s"'`,.;)\]}>]+$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function buildStepId(component: ComponentRunbook, order: number): string {
  return `${component.componentId}:${order}`;
}

function addCandidate(target: Set<string>, value: string): void {
  if (!shouldTrackReference(value)) {
    return;
  }
  const normalized = normalizeReference(value);
  target.add(normalized);
}

function shouldTrackReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^<[^>]+>$/.test(trimmed)) {
    return false;
  }
  const normalized = normalizeReference(trimmed);
  if (/^\d+$/.test(normalized)) {
    return false;
  }
  if (/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(normalized)) {
    return false;
  }
  return true;
}

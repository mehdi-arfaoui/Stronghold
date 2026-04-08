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

  const explicitFlags = Array.from(
    value.matchAll(/--[a-z0-9-]+\s+([A-Za-z0-9:/._-]+)/gi),
    (match) => match[1] ?? '',
  );
  const tokens = value.match(/[A-Za-z0-9:/._-]{3,}/g) ?? [];
  return Array.from(
    new Set(
      [...explicitFlags, ...tokens].filter((token) => {
        const normalized = normalizeReference(token);
        return (
          normalized.startsWith('arn:') ||
          normalized.includes('/') ||
          normalized.includes(':') ||
          /^[a-z0-9][a-z0-9._-]*-[a-z0-9._-]+$/i.test(normalized)
        );
      }),
    ),
  );
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
  return value.trim().replace(/^["']|["']$/g, '').toLowerCase();
}

function buildStepId(component: ComponentRunbook, order: number): string {
  return `${component.componentId}:${order}`;
}

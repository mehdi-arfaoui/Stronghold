import type { InfraNode } from '../../validation/validation-types.js';
import type { DetectionSource, Service } from '../service-types.js';
import {
  classifyResourceRole,
  cleanServiceName,
  deriveCriticality,
  isApplicationStackCandidate,
  isInfrastructureNode,
  resolveTagValue,
  slugifyServiceId,
} from '../service-utils.js';

const CLOUDFORMATION_STACK_TAG = 'aws:cloudformation:stack-name';
const CLOUDFORMATION_CONFIDENCE = 0.9;

export function detectCloudFormationServices(
  nodes: readonly InfraNode[],
  assignedNodeIds: ReadonlySet<string> = new Set<string>(),
  options: {
    readonly onLog?: (message: string) => void;
  } = {},
): readonly Service[] {
  const groupedByStack = new Map<string, InfraNode[]>();

  for (const node of nodes) {
    if (assignedNodeIds.has(node.id)) continue;
    const stackName = resolveTagValue(node, CLOUDFORMATION_STACK_TAG);
    if (!stackName) continue;

    const current = groupedByStack.get(stackName) ?? [];
    current.push(node);
    groupedByStack.set(stackName, current);
  }

  const services: Service[] = [];

  for (const [stackName, stackNodes] of groupedByStack.entries()) {
    const classification = classifyStack(stackNodes);
    options.onLog?.(
      classification.kind === 'application-stack'
        ? `[SERVICE] Stack ${stackName}: application-stack (${classification.compute} compute, ${classification.datastore} datastore, ${classification.queue} queue, ${classification.storage} storage)`
        : `[SERVICE] Stack ${stackName}: infrastructure-stack (${classification.infrastructure} infrastructure) - skipped`,
    );

    if (classification.kind !== 'application-stack') {
      continue;
    }

    const detectionSource: DetectionSource = {
      type: 'cloudformation',
      stackName,
      confidence: CLOUDFORMATION_CONFIDENCE,
    };
    const cleanedName = cleanServiceName(stackName);
    services.push({
      id: slugifyServiceId(cleanedName),
      name: cleanedName,
      detectionSource,
      resources: stackNodes.map((node) => ({
        nodeId: node.id,
        role: classifyResourceRole(node),
        detectionSource,
      })),
      criticality: deriveCriticality(stackNodes),
      metadata: {
        stackName,
      },
    });
  }

  return services.sort((left, right) => left.name.localeCompare(right.name));
}

function classifyStack(nodes: readonly InfraNode[]): {
  readonly kind: 'application-stack' | 'infrastructure-stack';
  readonly compute: number;
  readonly datastore: number;
  readonly queue: number;
  readonly storage: number;
  readonly infrastructure: number;
} {
  let compute = 0;
  let datastore = 0;
  let queue = 0;
  let storage = 0;
  let infrastructure = 0;

  for (const node of nodes) {
    const role = classifyResourceRole(node);
    if (role === 'compute') compute += 1;
    if (role === 'datastore') datastore += 1;
    if (role === 'queue') queue += 1;
    if (role === 'storage') storage += 1;
    if (isInfrastructureNode(node)) infrastructure += 1;
  }

  return {
    kind: nodes.some((node) => isApplicationStackCandidate(node))
      ? 'application-stack'
      : 'infrastructure-stack',
    compute,
    datastore,
    queue,
    storage,
    infrastructure,
  };
}

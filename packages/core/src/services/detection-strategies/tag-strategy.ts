import type { InfraNode } from '../../validation/validation-types.js';
import type { DetectionSource, Service } from '../service-types.js';
import {
  classifyResourceRole,
  cleanServiceName,
  deriveCriticality,
  extractPrefixCandidate,
  readNameTag,
  resolveNodeTags,
  slugifyServiceId,
} from '../service-utils.js';

const TAG_CONFIDENCE = 0.75;
const PREFIX_CONFIDENCE = 0.6;
const TAG_KEY_PRIORITY = [
  'service',
  'app',
  'application',
  'workload',
  'project',
  'microservice',
  'component',
] as const;

export function detectTagServices(
  nodes: readonly InfraNode[],
  assignedNodeIds: ReadonlySet<string> = new Set<string>(),
): readonly Service[] {
  const eligibleNodes = nodes.filter((node) => !assignedNodeIds.has(node.id));
  const services: Service[] = [];
  const assignedByTag = new Set<string>();

  const groupedByTag = new Map<
    string,
    { readonly key: string; readonly value: string; nodes: InfraNode[] }
  >();

  for (const node of eligibleNodes) {
    const tagMatch = resolvePriorityTag(node);
    if (!tagMatch) continue;

    const groupKey = `${tagMatch.key}:${tagMatch.value.toLowerCase()}`;
    const current = groupedByTag.get(groupKey) ?? {
      key: tagMatch.key,
      value: tagMatch.value,
      nodes: [],
    };
    current.nodes.push(node);
    groupedByTag.set(groupKey, current);
  }

  for (const group of groupedByTag.values()) {
    const detectionSource: DetectionSource = {
      type: 'tag',
      key: group.key,
      value: group.value,
      confidence: TAG_CONFIDENCE,
    };
    const cleanedName = cleanServiceName(group.value);
    services.push({
      id: slugifyServiceId(cleanedName),
      name: cleanedName,
      detectionSource,
      resources: group.nodes.map((node) => {
        assignedByTag.add(node.id);
        return {
          nodeId: node.id,
          role: classifyResourceRole(node),
          detectionSource,
        };
      }),
      criticality: deriveCriticality(group.nodes),
      metadata: {
        tagKey: group.key,
        tagValue: group.value,
      },
    });
  }

  const prefixGroups = new Map<string, InfraNode[]>();
  for (const node of eligibleNodes) {
    if (assignedByTag.has(node.id)) continue;
    const nameTag = readNameTag(node);
    if (!nameTag) continue;

    const prefix = extractPrefixCandidate(nameTag);
    if (!prefix) continue;

    const current = prefixGroups.get(prefix.toLowerCase()) ?? [];
    current.push(node);
    prefixGroups.set(prefix.toLowerCase(), current);
  }

  let fallbackIndex = 1;
  for (const [prefix, prefixNodes] of prefixGroups.entries()) {
    if (prefixNodes.length < 3) continue;

    const cleanedName = cleanServiceName(prefix);
    const serviceId = slugifyServiceId(cleanedName) || `prefix-${fallbackIndex}`;
    if (services.some((service) => service.id === serviceId)) {
      continue;
    }

    const detectionSource: DetectionSource = {
      type: 'tag',
      key: 'Name',
      value: prefix,
      confidence: PREFIX_CONFIDENCE,
    };
    services.push({
      id: serviceId,
      name: cleanedName || `cluster-${fallbackIndex}`,
      detectionSource,
      resources: prefixNodes.map((node) => ({
        nodeId: node.id,
        role: classifyResourceRole(node),
        detectionSource,
      })),
      criticality: deriveCriticality(prefixNodes),
      metadata: {
        tagKey: 'Name',
        tagValue: prefix,
      },
    });
    fallbackIndex += 1;
  }

  return deduplicateServices(services);
}

function resolvePriorityTag(node: InfraNode): { readonly key: string; readonly value: string } | null {
  const tags = resolveNodeTags(node);

  for (const preferredKey of TAG_KEY_PRIORITY) {
    for (const [tagKey, tagValue] of Object.entries(tags)) {
      if (tagKey.toLowerCase() === preferredKey && tagValue.trim().length > 0) {
        return {
          key: tagKey,
          value: tagValue.trim(),
        };
      }
    }
  }

  return null;
}

function deduplicateServices(services: readonly Service[]): readonly Service[] {
  const byId = new Map<string, Service>();

  for (const service of services) {
    const existing = byId.get(service.id);
    if (!existing) {
      byId.set(service.id, service);
      continue;
    }

    byId.set(service.id, {
      ...existing,
      resources: [...existing.resources, ...service.resources].filter(
        (resource, index, resources) =>
          resources.findIndex((candidate) => candidate.nodeId === resource.nodeId) === index,
      ),
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

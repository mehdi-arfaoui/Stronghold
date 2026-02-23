import type { InfraNode, Prisma, PrismaClient } from '@prisma/client';
import prisma from '../prismaClient.js';
import { appLogger } from '../utils/logger.js';
import { BusinessFlowFinancialEngineService } from './business-flow-financial-engine.service.js';

export type CloudFlowSuggestion = {
  flowId: string;
  flowName: string;
  tagKey: string;
  tagValue: string;
  nodeCount: number;
  status: 'created' | 'updated';
};

export type EnrichmentResult = {
  groupedSuggestions: number;
  createdSuggestions: number;
  updatedSuggestions: number;
  enrichedFlows: number;
  servicesAdded: number;
  ignoredEmptyFlows: number;
  cleanedEmptyFlows: number;
  skippedNodes: number;
  message?: string;
  suggestions: CloudFlowSuggestion[];
};

type TaggedNodeGroup = {
  tagKey: string;
  tagValue: string;
  nodes: InfraNode[];
};

type InfraEdgeRef = {
  sourceId: string;
  targetId: string;
};

const BUSINESS_TAG_KEYS: string[][] = [
  ['Application', 'app', 'application', 'Service', 'service-name'],
  ['BusinessUnit', 'business-unit', 'Business'],
  ['CostCenter', 'cost-center', 'cost_center'],
];

function normalizeTagKey(key: string): string {
  return key.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function titleCase(input: string): string {
  return input
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readTagMap(node: InfraNode): Record<string, string> {
  const tags: Record<string, string> = {};
  if (isPlainObject(node.tags)) {
    for (const [key, rawValue] of Object.entries(node.tags)) {
      if (rawValue == null) continue;
      tags[key] = String(rawValue);
    }
  }

  const metadata = node.metadata;
  if (isPlainObject(metadata) && isPlainObject(metadata.businessTags)) {
    for (const [key, rawValue] of Object.entries(metadata.businessTags)) {
      if (rawValue == null) continue;
      tags[key] = String(rawValue);
    }
  }

  return tags;
}

function findBusinessTag(node: InfraNode): { key: string; value: string } | null {
  const tags = readTagMap(node);
  const normalizedEntries = Object.entries(tags).map(([key, value]) => ({
    key,
    normalizedKey: normalizeTagKey(key),
    value: String(value).trim(),
  }));

  for (const keyGroup of BUSINESS_TAG_KEYS) {
    const normalizedGroup = keyGroup.map((entry) => normalizeTagKey(entry));
    const match = normalizedEntries.find(
      (entry) => normalizedGroup.includes(entry.normalizedKey) && entry.value.length > 0,
    );
    if (match) return { key: match.key, value: match.value };
  }
  return null;
}

function inferFlowCategory(tagValue: string): string {
  const lower = tagValue.toLowerCase();
  if (
    lower.includes('payment') ||
    lower.includes('billing') ||
    lower.includes('checkout') ||
    lower.includes('revenue')
  ) {
    return 'revenue';
  }
  if (lower.includes('compliance') || lower.includes('audit') || lower.includes('governance')) {
    return 'compliance';
  }
  if (lower.includes('internal') || lower.includes('support') || lower.includes('backoffice')) {
    return 'internal';
  }
  return 'operations';
}

function inferNodeRole(nodeType: string): string {
  const upper = String(nodeType || '').toUpperCase();
  if (upper.includes('LOAD_BALANCER') || upper.includes('API_GATEWAY') || upper.includes('INGRESS')) {
    return 'entry_point';
  }
  if (
    upper.includes('DATABASE') ||
    upper.includes('CACHE') ||
    upper.includes('OBJECT_STORAGE') ||
    upper.includes('FILE_STORAGE')
  ) {
    return 'data_store';
  }
  if (
    upper.includes('QUEUE') ||
    upper.includes('SNS') ||
    upper.includes('SQS') ||
    upper.includes('PUBSUB')
  ) {
    return 'external_dependency';
  }
  if (upper.includes('NOTIFICATION') || upper.includes('EMAIL')) {
    return 'notification';
  }
  return 'processing';
}

function inferNodeCriticality(node: InfraNode): boolean {
  if (node.isSPOF) return true;
  if (typeof node.criticalityScore === 'number' && node.criticalityScore >= 0.7) return true;
  return true;
}

function inferAlternativePath(node: InfraNode): boolean {
  if (node.isSPOF) return false;
  return typeof node.redundancyScore === 'number' && node.redundancyScore >= 0.5;
}

function buildFlowName(tagValue: string): string {
  const normalized = titleCase(tagValue);
  if (normalized.toLowerCase().includes('flow')) return normalized;
  if (normalized.toLowerCase().includes('service')) return normalized;
  return `${normalized} Flow`;
}

function extractMetricsHint(node: InfraNode): string | null {
  if (!isPlainObject(node.metadata) || !isPlainObject(node.metadata.metrics)) return null;
  const metrics = node.metadata.metrics as Record<string, unknown>;
  const requestsPerHour = Number(metrics.requestsPerHour);
  const peakRequestsPerHour = Number(metrics.peakRequestsPerHour);
  if (!Number.isFinite(requestsPerHour) && !Number.isFinite(peakRequestsPerHour)) return null;

  const avgText = Number.isFinite(requestsPerHour)
    ? `${Math.round(requestsPerHour)} req/h`
    : 'N/A';
  const peakText = Number.isFinite(peakRequestsPerHour)
    ? `${Math.round(peakRequestsPerHour)} req/h`
    : 'N/A';
  return `${node.name}: observed traffic avg=${avgText}, peak=${peakText}`;
}

function sortGroupNodesByGraph(nodes: InfraNode[], edges: InfraEdgeRef[]): InfraNode[] {
  if (nodes.length <= 1) return nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue;
    outgoing.get(edge.sourceId)?.push(edge.targetId);
    inDegree.set(edge.targetId, (inDegree.get(edge.targetId) || 0) + 1);
  }

  const queue = nodes
    .filter((node) => (inDegree.get(node.id) || 0) === 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const ordered: InfraNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    ordered.push(current);
    for (const targetId of outgoing.get(current.id) || []) {
      const nextDegree = (inDegree.get(targetId) || 0) - 1;
      inDegree.set(targetId, nextDegree);
      if (nextDegree === 0) {
        const next = nodes.find((node) => node.id === targetId);
        if (next && !ordered.some((existing) => existing.id === next.id)) {
          queue.push(next);
        }
      }
    }
    queue.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (ordered.length === nodes.length) return ordered;

  const orderedIds = new Set(ordered.map((node) => node.id));
  const tail = nodes
    .filter((node) => !orderedIds.has(node.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...ordered, ...tail];
}

function findLargestConnectedComponent(nodes: InfraNode[], edges: InfraEdgeRef[]): InfraNode[] {
  if (nodes.length <= 1) return nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, new Set<string>());
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue;
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
  }

  const unvisited = new Set(nodeIds);
  let bestIds: string[] = [];
  while (unvisited.size > 0) {
    const seed = unvisited.values().next().value as string | undefined;
    if (!seed) break;
    const queue = [seed];
    unvisited.delete(seed);
    const component: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (!unvisited.has(neighbor)) continue;
        unvisited.delete(neighbor);
        queue.push(neighbor);
      }
    }

    if (component.length > bestIds.length) {
      bestIds = component;
    }
  }

  const bestSet = new Set(bestIds);
  return nodes.filter((node) => bestSet.has(node.id));
}

export class CloudEnrichmentService {
  private readonly prismaClient: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prismaClient = prismaClient;
  }

  async enrichFromCloudData(tenantId: string): Promise<EnrichmentResult> {
    const flowFinancialEngine = new BusinessFlowFinancialEngineService(this.prismaClient);
    const [nodes, edges, existingCloudFlows] = await Promise.all([
      this.prismaClient.infraNode.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prismaClient.infraEdge.findMany({
        where: { tenantId },
        select: { sourceId: true, targetId: true },
      }),
      this.prismaClient.businessFlow.findMany({
        where: { tenantId, source: 'cloud_tags' },
        select: {
          id: true,
          flowNodes: {
            select: { id: true },
          },
        },
      }),
    ]);

    const staleCloudFlowIds = existingCloudFlows
      .filter((flow) => flow.flowNodes.length < 2)
      .map((flow) => flow.id);
    const cleanedEmptyFlows =
      staleCloudFlowIds.length > 0
        ? (
            await this.prismaClient.businessFlow.deleteMany({
              where: { tenantId, id: { in: staleCloudFlowIds } },
            })
          ).count
        : 0;

    const groupsByTag = new Map<string, TaggedNodeGroup>();
    let skippedNodes = 0;

    for (const node of nodes) {
      const businessTag = findBusinessTag(node);
      if (!businessTag) {
        skippedNodes += 1;
        continue;
      }
      const groupKey = `${normalizeTagKey(businessTag.key)}::${businessTag.value.toLowerCase()}`;
      const existingGroup = groupsByTag.get(groupKey);
      if (existingGroup) {
        existingGroup.nodes.push(node);
      } else {
        groupsByTag.set(groupKey, {
          tagKey: businessTag.key,
          tagValue: businessTag.value,
          nodes: [node],
        });
      }
    }

    const suggestions: CloudFlowSuggestion[] = [];
    let createdSuggestions = 0;
    let updatedSuggestions = 0;
    let ignoredEmptyFlows = 0;
    let servicesAdded = 0;

    for (const group of groupsByTag.values()) {
      const connectedComponent = findLargestConnectedComponent(group.nodes, edges);
      const sortedNodes = sortGroupNodesByGraph(connectedComponent, edges);
      if (sortedNodes.length < 2) {
        ignoredEmptyFlows += 1;
        continue;
      }

      const flowName = buildFlowName(group.tagValue);
      const metricsHints = sortedNodes
        .map((node) => extractMetricsHint(node))
        .filter((hint): hint is string => Boolean(hint));
      const descriptionParts = [
        `Suggested from cloud tag ${group.tagKey}:${group.tagValue}.`,
        metricsHints.length > 0
          ? `Observed metrics (raw request volume, validate request/transaction ratio): ${metricsHints.join('; ')}.`
          : null,
      ].filter((part): part is string => Boolean(part));

      const category = inferFlowCategory(group.tagValue);
      const existingFlow = await this.prismaClient.businessFlow.findFirst({
        where: {
          tenantId,
          source: 'cloud_tags',
          name: flowName,
        },
      });

      const flow = existingFlow
        ? await this.prismaClient.businessFlow.update({
            where: { id: existingFlow.id },
            data: {
              description: descriptionParts.join(' '),
              category,
              validatedByUser: false,
              validatedAt: null,
            },
          })
        : await this.prismaClient.businessFlow.create({
            data: {
              tenantId,
              name: flowName,
              description: descriptionParts.join(' '),
              category,
              source: 'cloud_tags',
              validatedByUser: false,
              validatedAt: null,
              aiConfidence: null,
            },
          });

      if (existingFlow) {
        updatedSuggestions += 1;
      } else {
        createdSuggestions += 1;
      }
      servicesAdded += sortedNodes.length;

      await this.prismaClient.$transaction([
        this.prismaClient.businessFlowNode.deleteMany({
          where: { tenantId, businessFlowId: flow.id },
        }),
        this.prismaClient.businessFlowNode.createMany({
          data: sortedNodes.map((node, orderIndex) => ({
            businessFlowId: flow.id,
            infraNodeId: node.id,
            tenantId,
            orderIndex,
            role: inferNodeRole(node.type),
            isCritical: inferNodeCriticality(node),
            hasAlternativePath: inferAlternativePath(node),
            alternativeNodeId: null,
          })),
        }),
      ]);
      try {
        await flowFinancialEngine.recalculateFlowComputedCost(tenantId, flow.id);
      } catch (error) {
        appLogger.warn('cloud.enrichment.financial_recalc_failed', {
          tenantId,
          flowId: flow.id,
          reason: error instanceof Error ? error.message : 'unknown_error',
        });
      }

      suggestions.push({
        flowId: flow.id,
        flowName: flow.name,
        tagKey: group.tagKey,
        tagValue: group.tagValue,
        nodeCount: sortedNodes.length,
        status: existingFlow ? 'updated' : 'created',
      });
    }

    const enrichedFlows = createdSuggestions + updatedSuggestions;
    const message =
      enrichedFlows === 0
        ? 'Aucun flux métier détecté automatiquement — créez-en un manuellement'
        : undefined;

    appLogger.info('cloud.enrichment.completed', {
      tenantId,
      groupedSuggestions: groupsByTag.size,
      createdSuggestions,
      updatedSuggestions,
      enrichedFlows,
      servicesAdded,
      ignoredEmptyFlows,
      cleanedEmptyFlows,
      skippedNodes,
    });

    return {
      groupedSuggestions: groupsByTag.size,
      createdSuggestions,
      updatedSuggestions,
      enrichedFlows,
      servicesAdded,
      ignoredEmptyFlows,
      cleanedEmptyFlows,
      skippedNodes,
      ...(message ? { message } : {}),
      suggestions,
    };
  }
}

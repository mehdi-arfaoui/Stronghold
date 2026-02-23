import type { InfraEdge, InfraNode, OrganizationProfile, PrismaClient } from '@prisma/client';
import prisma from '../prismaClient.js';
import { appLogger } from '../utils/logger.js';
import { BusinessFlowFinancialEngineService } from './business-flow-financial-engine.service.js';

export type FlowSuggestionNode = {
  nodeId: string;
  role: string | null;
  isCritical: boolean;
};

export type FlowSuggestion = {
  flowId: string;
  name: string;
  description: string | null;
  category: string | null;
  confidence: number;
  reasoning: string;
  nodes: FlowSuggestionNode[];
  estimatedCriticality: string | null;
  questionsForUser: string[];
};

type RawFlowSuggestion = {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  nodes?: unknown;
  estimatedCriticality?: unknown;
  estimatedCostPerHour?: unknown;
  questionsForUser?: unknown;
};

type AnthropicContentBlock = {
  type?: string;
  text?: string;
};

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
};

const FLOW_SUGGESTION_SYSTEM_PROMPT = `
You are an enterprise architecture and business impact analysis expert.
You will receive an organization's infrastructure graph with node metadata.

Task: identify BUSINESS FLOWS that run through this infrastructure.

A business flow is a concrete business process implemented by a connected chain of technical services.
Examples: "Customer Payment", "User Authentication", "Invoice Delivery", "Analytics Pipeline".

STRICT RULES:
1) Return ONLY valid JSON. No prose outside JSON.
2) Each flow name must be business-oriented, not a technical label.
3) Flow nodes must form a connected path in the provided graph.
4) Never invent or compute any financial amount. estimatedCostPerHour must always be null.
5) Include confidence as a 0-1 number.
6) Prioritize business tags (Application, BusinessUnit, CostCenter) as strong signals.
7) Use service names/types as secondary signals.
8) Use traffic metrics for relative criticality only, not for money.
9) Maximum 10 suggestions.
10) For each node in a flow, provide isCritical=true if the flow stops without it, false if degraded mode is possible.

JSON OUTPUT FORMAT:
{
  "suggestions": [
    {
      "name": "Customer Payment",
      "description": "Card payment processing flow",
      "category": "revenue",
      "confidence": 0.85,
      "reasoning": "Connected path with shared Application:payment tags and high traffic.",
      "nodes": [
        { "nodeId": "node-1", "role": "entry_point", "isCritical": true },
        { "nodeId": "node-2", "role": "processing", "isCritical": true },
        { "nodeId": "node-3", "role": "data_store", "isCritical": true }
      ],
      "estimatedCriticality": "high",
      "estimatedCostPerHour": null,
      "questionsForUser": [
        "What annual revenue depends on this flow?",
        "Do you have contractual SLA penalties for this flow?"
      ]
    }
  ]
}
`;

const BUSINESS_TAG_KEYS: string[][] = [
  ['Application', 'app', 'application', 'Service', 'service-name'],
  ['BusinessUnit', 'business-unit', 'Business'],
  ['CostCenter', 'cost-center', 'cost_center'],
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function extractTextFromAnthropicResponse(payload: AnthropicResponse): string {
  if (!Array.isArray(payload.content)) return '';
  const text = payload.content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text || '')
    .join('\n')
    .trim();
  return text;
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (['revenue', 'operations', 'compliance', 'internal'].includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeSuggestionNodes(raw: unknown): FlowSuggestionNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: FlowSuggestionNode[] = [];
  raw.forEach((entry) => {
    if (!isPlainObject(entry)) return;
    const nodeId = typeof entry.nodeId === 'string' ? entry.nodeId.trim() : '';
    if (!nodeId) return;
    const role = typeof entry.role === 'string' ? entry.role.trim() : null;
    const isCritical = typeof entry.isCritical === 'boolean' ? entry.isCritical : true;
    nodes.push({
      nodeId,
      role,
      isCritical,
    });
  });
  return nodes;
}

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

function readTagMap(node: InfraNode): Record<string, string> {
  const tags: Record<string, string> = {};
  if (isPlainObject(node.tags)) {
    for (const [key, rawValue] of Object.entries(node.tags)) {
      if (rawValue == null) continue;
      tags[key] = String(rawValue);
    }
  }

  if (isPlainObject(node.metadata) && isPlainObject(node.metadata.businessTags)) {
    for (const [key, rawValue] of Object.entries(node.metadata.businessTags)) {
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

function inferFlowCategory(text: string): string {
  const lower = text.toLowerCase();
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
  if (upper.includes('QUEUE') || upper.includes('SNS') || upper.includes('SQS') || upper.includes('PUBSUB')) {
    return 'external_dependency';
  }
  if (upper.includes('NOTIFICATION') || upper.includes('EMAIL')) {
    return 'notification';
  }
  return 'processing';
}

function estimateCriticality(nodes: InfraNode[]): string {
  const hasSpof = nodes.some((node) => node.isSPOF);
  if (hasSpof) return 'high';
  const maxCriticality = Math.max(0, ...nodes.map((node) => Number(node.criticalityScore || 0)));
  if (maxCriticality >= 0.8) return 'high';
  if (maxCriticality >= 0.5) return 'medium';
  return 'low';
}

function buildAdjacency(edges: InfraEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Set<string>());
    if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Set<string>());
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
  }
  return adjacency;
}

function findLargestConnectedComponent(nodeIds: string[], adjacency: Map<string, Set<string>>): string[] {
  const unvisited = new Set(nodeIds);
  let best: string[] = [];

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

    component.sort();
    if (component.length > best.length) {
      best = component;
    }
  }

  return best;
}

function orderNodesByGraph(nodes: InfraNode[], edges: InfraEdge[]): InfraNode[] {
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

function buildDeterministicSuggestions(nodes: InfraNode[], edges: InfraEdge[]): RawFlowSuggestion[] {
  const adjacency = buildAdjacency(edges);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const groupedByTag = new Map<string, { tagLabel: string; tagValue: string; nodeIds: string[] }>();

  for (const node of nodes) {
    const businessTag = findBusinessTag(node);
    if (!businessTag) continue;
    const groupKey = `${normalizeTagKey(businessTag.key)}::${businessTag.value.toLowerCase()}`;
    const existing = groupedByTag.get(groupKey);
    if (existing) {
      existing.nodeIds.push(node.id);
    } else {
      groupedByTag.set(groupKey, {
        tagLabel: businessTag.key,
        tagValue: businessTag.value,
        nodeIds: [node.id],
      });
    }
  }

  const suggestions: RawFlowSuggestion[] = [];
  const sortedGroups = Array.from(groupedByTag.values()).sort((a, b) =>
    a.tagValue.localeCompare(b.tagValue),
  );

  for (const group of sortedGroups) {
    if (group.nodeIds.length < 2) continue;
    const connectedNodeIds = findLargestConnectedComponent(group.nodeIds, adjacency);
    if (connectedNodeIds.length < 2) continue;

    const groupNodes = connectedNodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is InfraNode => Boolean(node));
    const orderedNodes = orderNodesByGraph(groupNodes, edges).slice(0, 8);
    if (orderedNodes.length < 2) continue;

    const flowName = titleCase(group.tagValue).toLowerCase().includes('flow')
      ? titleCase(group.tagValue)
      : `${titleCase(group.tagValue)} Flow`;
    const hasSpof = orderedNodes.some((node) => node.isSPOF);
    const confidence = hasSpof ? 0.66 : 0.72;
    const category = inferFlowCategory(group.tagValue);

    suggestions.push({
      name: flowName,
      description: `Flux detecte via tag ${group.tagLabel}:${group.tagValue}`,
      category,
      confidence,
      reasoning:
        `Noeuds relies detectes sur le graphe de dependances pour le tag ${group.tagLabel}:${group.tagValue}.` +
        (hasSpof ? ' SPOF detecte dans le chemin.' : ''),
      nodes: orderedNodes.map((node) => ({
        nodeId: node.id,
        role: inferNodeRole(node.type),
        isCritical: node.isSPOF || Number(node.criticalityScore || 0) >= 0.7,
      })),
      estimatedCriticality: estimateCriticality(orderedNodes),
      estimatedCostPerHour: null,
      questionsForUser: [
        'Faut-il ajouter un service critique manquant a ce flux ?',
        'Ce flux est-il couvert par un plan de reprise teste ?',
      ],
    });
  }

  if (suggestions.length > 0) return suggestions.slice(0, 10);

  const sortedNodes = [...nodes].sort(
    (left, right) => Number(right.criticalityScore || 0) - Number(left.criticalityScore || 0),
  );
  for (const pivot of sortedNodes) {
    const neighbors = Array.from(adjacency.get(pivot.id) || [])
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is InfraNode => Boolean(node))
      .sort((a, b) => Number(b.criticalityScore || 0) - Number(a.criticalityScore || 0))
      .slice(0, 3);
    const candidateNodes = [pivot, ...neighbors];
    if (candidateNodes.length < 2) continue;

    const orderedNodes = orderNodesByGraph(candidateNodes, edges);
    suggestions.push({
      name: `${titleCase(pivot.name)} Continuity`,
      description: 'Flux derive des dependances critiques du graphe',
      category: inferFlowCategory(pivot.name),
      confidence: 0.58,
      reasoning: 'Suggestion heuristique basee sur criticite et dependances immediates.',
      nodes: orderedNodes.map((node) => ({
        nodeId: node.id,
        role: inferNodeRole(node.type),
        isCritical: true,
      })),
      estimatedCriticality: estimateCriticality(orderedNodes),
      estimatedCostPerHour: null,
      questionsForUser: ['Ce flux doit-il etre formalise comme flux metier prioritaire ?'],
    });

    if (suggestions.length >= 5) break;
  }

  return suggestions.slice(0, 10);
}

function toRawSuggestions(payload: unknown): RawFlowSuggestion[] {
  if (!isPlainObject(payload)) return [];
  if (!Array.isArray(payload.suggestions)) return [];
  return payload.suggestions.filter((item): item is RawFlowSuggestion => isPlainObject(item));
}

function buildGraphSummary(
  nodes: InfraNode[],
  edges: InfraEdge[],
  orgProfile: OrganizationProfile | null,
) {
  const summaryNodes = nodes.map((node) => {
    const metadata = isPlainObject(node.metadata) ? node.metadata : {};
    const businessTags = isPlainObject(metadata.businessTags)
      ? metadata.businessTags
      : isPlainObject(node.tags)
        ? node.tags
        : {};
    const metrics = isPlainObject(metadata.metrics) ? metadata.metrics : null;
    const cloudCost = isPlainObject(metadata.cloudCost) ? metadata.cloudCost : null;

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      provider: node.provider,
      region: node.region,
      tags: businessTags,
      metrics:
        metrics != null
          ? {
              requestsPerHour: Number(metrics.requestsPerHour) || null,
              peakRequestsPerHour: Number(metrics.peakRequestsPerHour) || null,
            }
          : null,
      cloudCostMonthly: cloudCost != null ? Number(cloudCost.monthlyTotalUSD) || null : null,
      dependentsCount: node.blastRadius || 0,
      isSPOF: node.isSPOF,
      criticalityScore: node.criticalityScore,
    };
  });

  const summaryEdges = edges.map((edge) => ({
    source: edge.sourceId,
    target: edge.targetId,
    type: edge.type,
  }));

  return {
    nodes: summaryNodes,
    edges: summaryEdges,
    orgProfile: {
      sector: orgProfile?.verticalSector || null,
      size: orgProfile?.sizeCategory || null,
    },
  };
}

export class AIFlowSuggesterService {
  private readonly prismaClient: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prismaClient = prismaClient;
  }

  async suggestBusinessFlows(tenantId: string): Promise<FlowSuggestion[]> {
    const [nodes, edges, orgProfile] = await Promise.all([
      this.prismaClient.infraNode.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prismaClient.infraEdge.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaClient.organizationProfile.findUnique({
        where: { tenantId },
      }),
    ]);

    if (nodes.length === 0) return [];

    let rawSuggestions: RawFlowSuggestion[] = [];
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const graphSummary = buildGraphSummary(nodes, edges, orgProfile);
        const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 4000,
            temperature: 0,
            system: FLOW_SUGGESTION_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: JSON.stringify(graphSummary) }],
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Anthropic request failed (${response.status}): ${body.slice(0, 400)}`);
        }

        const payload = (await response.json()) as AnthropicResponse;
        const outputText = extractTextFromAnthropicResponse(payload);
        const jsonCandidate = extractJsonCandidate(outputText);
        const parsed = JSON.parse(jsonCandidate) as unknown;
        rawSuggestions = toRawSuggestions(parsed).slice(0, 10);
      } catch (error) {
        appLogger.warn('business_flow.ai_suggestion_provider_failed', {
          tenantId,
          reason: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }

    if (rawSuggestions.length === 0) {
      rawSuggestions = buildDeterministicSuggestions(nodes, edges);
    }

    const validNodeIds = new Set(nodes.map((node) => node.id));
    const graphAdjacency = buildAdjacency(edges);
    const suggestions: FlowSuggestion[] = [];
    const flowFinancialEngine = new BusinessFlowFinancialEngineService(this.prismaClient);

    for (const rawSuggestion of rawSuggestions) {
      const name = typeof rawSuggestion.name === 'string' ? rawSuggestion.name.trim() : '';
      if (!name) continue;

      const normalizedNodes = normalizeSuggestionNodes(rawSuggestion.nodes).filter((node) =>
        validNodeIds.has(node.nodeId),
      );
      if (normalizedNodes.length < 2) continue;
      const connectedNodeIds = findLargestConnectedComponent(
        normalizedNodes.map((node) => node.nodeId),
        graphAdjacency,
      );
      if (connectedNodeIds.length < 2) continue;
      const connectedNodeIdSet = new Set(connectedNodeIds);
      const connectedNodes = normalizedNodes.filter((node) => connectedNodeIdSet.has(node.nodeId));
      if (connectedNodes.length < 2) continue;

      const confidenceRaw = Number(rawSuggestion.confidence);
      const confidence = clamp(
        Number.isFinite(confidenceRaw) ? confidenceRaw : 0.5,
        0,
        1,
      );
      const description = typeof rawSuggestion.description === 'string'
        ? rawSuggestion.description.trim()
        : null;
      const reasoning = typeof rawSuggestion.reasoning === 'string'
        ? rawSuggestion.reasoning.trim()
        : '';
      const category = normalizeCategory(rawSuggestion.category);
      const estimatedCriticality = typeof rawSuggestion.estimatedCriticality === 'string'
        ? rawSuggestion.estimatedCriticality.trim().toLowerCase()
        : null;
      const questionsForUser = normalizeStringList(rawSuggestion.questionsForUser);

      const existing = await this.prismaClient.businessFlow.findFirst({
        where: {
          tenantId,
          source: 'ai_suggested',
          name,
        },
      });

      const flowDescriptionParts = [
        description,
        reasoning ? `AI reasoning: ${reasoning}` : null,
      ].filter((part): part is string => Boolean(part && part.trim().length > 0));

      const flow = existing
        ? await this.prismaClient.businessFlow.update({
            where: { id: existing.id },
            data: {
              description: flowDescriptionParts.join(' '),
              category,
              source: 'ai_suggested',
              aiConfidence: confidence,
              validatedByUser: false,
              validatedAt: null,
              estimatedCostPerHour: null,
              calculatedCostPerHour: null,
              costCalculationMethod: null,
            },
          })
        : await this.prismaClient.businessFlow.create({
            data: {
              tenantId,
              name,
              description: flowDescriptionParts.join(' '),
              category,
              source: 'ai_suggested',
              aiConfidence: confidence,
              validatedByUser: false,
              validatedAt: null,
              estimatedCostPerHour: null,
              calculatedCostPerHour: null,
              costCalculationMethod: null,
            },
          });

      await this.prismaClient.$transaction([
        this.prismaClient.businessFlowNode.deleteMany({
          where: { tenantId, businessFlowId: flow.id },
        }),
        this.prismaClient.businessFlowNode.createMany({
          data: connectedNodes.map((node, orderIndex) => ({
            tenantId,
            businessFlowId: flow.id,
            infraNodeId: node.nodeId,
            orderIndex,
            role: node.role,
            isCritical: node.isCritical,
            hasAlternativePath: !node.isCritical,
            alternativeNodeId: null,
          })),
        }),
      ]);
      try {
        await flowFinancialEngine.recalculateFlowComputedCost(tenantId, flow.id);
      } catch (error) {
        appLogger.warn('business_flow.ai_suggestion_financial_recalc_failed', {
          tenantId,
          flowId: flow.id,
          reason: error instanceof Error ? error.message : 'unknown_error',
        });
      }

      suggestions.push({
        flowId: flow.id,
        name: flow.name,
        description: flow.description,
        category: flow.category,
        confidence,
        reasoning,
        nodes: connectedNodes,
        estimatedCriticality,
        questionsForUser,
      });
    }

    return suggestions;
  }
}

export { FLOW_SUGGESTION_SYSTEM_PROMPT };

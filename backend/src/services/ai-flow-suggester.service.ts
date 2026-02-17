import type { InfraEdge, InfraNode, OrganizationProfile, PrismaClient } from '@prisma/client';
import prisma from '../prismaClient.js';

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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

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

    const rawSuggestions = toRawSuggestions(parsed).slice(0, 10);
    const validNodeIds = new Set(nodes.map((node) => node.id));
    const suggestions: FlowSuggestion[] = [];

    for (const rawSuggestion of rawSuggestions) {
      const name = typeof rawSuggestion.name === 'string' ? rawSuggestion.name.trim() : '';
      if (!name) continue;

      const normalizedNodes = normalizeSuggestionNodes(rawSuggestion.nodes).filter((node) =>
        validNodeIds.has(node.nodeId),
      );
      if (normalizedNodes.length === 0) continue;

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
          data: normalizedNodes.map((node, orderIndex) => ({
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

      suggestions.push({
        flowId: flow.id,
        name: flow.name,
        description: flow.description,
        category: flow.category,
        confidence,
        reasoning,
        nodes: normalizedNodes,
        estimatedCriticality,
        questionsForUser,
      });
    }

    return suggestions;
  }
}

export { FLOW_SUGGESTION_SYSTEM_PROMPT };

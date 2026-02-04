import type { ElementDefinition } from "cytoscape";
import type { GraphApiResponse, GraphNode } from "../types";
import type {
  InfrastructureGraphData,
  InfrastructureGraphEdge,
  InfrastructureGraphNode,
  InfrastructureNodeType,
} from "../types/infrastructureGraph";

const DEFAULT_CRITICALITY = "low";

const CRITICALITY_LABELS: Record<string, string> = {
  critical: "Critique",
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
};

function normalizeCriticality(value?: string | null) {
  if (!value) return DEFAULT_CRITICALITY;
  return value.toLowerCase();
}

export function inferNodeType(node: GraphNode): InfrastructureNodeType {
  if (node.nodeKind === "application") return "application";
  if (node.type?.toLowerCase().includes("infra")) return "infra";
  if (node.category?.toLowerCase().includes("infra")) return "infra";
  return "service";
}

export function normalizeGraphResponse(response: GraphApiResponse): InfrastructureGraphData {
  const nodes: InfrastructureGraphNode[] = response.nodes.map((node) => ({
    id: node.id,
    label: node.summaryLabel || node.label || node.id,
    type: inferNodeType(node),
    criticality: normalizeCriticality(node.criticality),
    category: node.category ?? null,
    metadata: node.detailPayload ?? null,
    dependsOnCount: node.dependsOnCount,
    usedByCount: node.usedByCount,
  }));

  const edges: InfrastructureGraphEdge[] = response.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: edge.edgeLabelShort || edge.type,
    weight: edge.edgeWeight ?? null,
  }));

  return { nodes, edges };
}

export function computeNodeDegrees(edges: InfrastructureGraphEdge[]) {
  const counts = new Map<string, number>();
  edges.forEach((edge) => {
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  });
  return counts;
}

export function buildCytoscapeElements(data: InfrastructureGraphData): ElementDefinition[] {
  const degreeMap = computeNodeDegrees(data.edges);
  const nodes: ElementDefinition[] = data.nodes.map((node) => ({
    data: {
      id: node.id,
      label: node.label,
      type: node.type,
      criticality: normalizeCriticality(node.criticality),
      category: node.category ?? null,
      metadata: node.metadata ?? null,
      degree: degreeMap.get(node.id) ?? 0,
      dependsOnCount: node.dependsOnCount ?? 0,
      usedByCount: node.usedByCount ?? 0,
    },
  }));

  const edges: ElementDefinition[] = data.edges.map((edge) => ({
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type ?? "dépendance",
      weight: edge.weight ?? 1,
    },
  }));

  return [...nodes, ...edges];
}

export function buildNodeTooltip(node: InfrastructureGraphNode) {
  const criticality = normalizeCriticality(node.criticality);
  const criticalityLabel = CRITICALITY_LABELS[criticality] ?? node.criticality;
  const details = [
    `<strong>${node.label}</strong>`,
    `Type: ${node.type}`,
    `Criticité: ${criticalityLabel}`,
  ];

  if (node.category) details.push(`Catégorie: ${node.category}`);
  if (node.dependsOnCount !== undefined || node.usedByCount !== undefined) {
    details.push(
      `Dépend de: ${node.dependsOnCount ?? 0} • Utilisé par: ${node.usedByCount ?? 0}`
    );
  }

  if (node.metadata) {
    Object.entries(node.metadata).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") return;
      details.push(`${key}: ${String(value)}`);
    });
  }

  return details.join("<br/>");
}

export function filterGraphByTypes(
  data: InfrastructureGraphData,
  allowedTypes: Set<InfrastructureNodeType>
) {
  const nodes = data.nodes.filter((node) => allowedTypes.has(node.type));
  const allowedIds = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter((edge) => allowedIds.has(edge.source) && allowedIds.has(edge.target));
  return { nodes, edges };
}

export function filterGraphByCriticality(data: InfrastructureGraphData, criticality: string | null) {
  if (!criticality) return data;
  const nodes = data.nodes.filter((node) => normalizeCriticality(node.criticality) === criticality);
  const allowedIds = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter((edge) => allowedIds.has(edge.source) && allowedIds.has(edge.target));
  return { nodes, edges };
}

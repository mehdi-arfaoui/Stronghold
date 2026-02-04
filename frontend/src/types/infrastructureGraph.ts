export type InfrastructureNodeType = "service" | "application" | "infra";

export type InfrastructureGraphNode = {
  id: string;
  label: string;
  type: InfrastructureNodeType;
  criticality: string;
  category?: string | null;
  metadata?: Record<string, unknown> | null;
  dependsOnCount?: number;
  usedByCount?: number;
};

export type InfrastructureGraphEdge = {
  id: string;
  source: string;
  target: string;
  type?: string | null;
  weight?: number | null;
};

export type InfrastructureGraphData = {
  nodes: InfrastructureGraphNode[];
  edges: InfrastructureGraphEdge[];
};

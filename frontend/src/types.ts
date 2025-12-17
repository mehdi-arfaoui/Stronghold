export type ApiConfig = {
  backendUrl: string;
  apiKey: string;
};

export type Continuity = {
  rtoHours: number;
  rpoMinutes: number;
  mtpdHours: number;
  notes: string | null;
};

export type InfraLink = {
  infra: {
    name: string;
    type: string;
    provider: string | null;
    location: string | null;
  };
};

export type Service = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  criticality: string;
  recoveryPriority: number | null;
  domain?: string | null;
  continuity: Continuity | null;
  infraLinks: InfraLink[];
};

export type AppWarning = {
  type: string;
  service: string;
  dependsOn: string;
  message: string;
};

export type InfraFinding = {
  type: string;
  infra: string;
  infraType: string;
  location?: string | null;
  message: string;
};

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  criticality: string;
  rtoHours: number | null;
  rpoMinutes: number | null;
  mtpdHours: number | null;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: string;
};

export type GraphApiResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type InfraComponent = {
  id: string;
  name: string;
  type: string;
  provider: string | null;
  location: string | null;
  criticality: string | null;
  isSingleAz: boolean;
  notes: string | null;
  services?: {
    service: {
      id: string;
      name: string;
      criticality: string;
    };
  }[];
};

export type ScenarioServiceLinkFront = {
  service: {
    id: string;
    name: string;
    criticality: string;
  };
};

export type RunbookStepFront = {
  id: string;
  order: number;
  title: string;
  description: string | null;
  estimatedDurationMinutes: number | null;
  role: string | null;
  blocking: boolean;
};

export type ScenarioFront = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  impactLevel: string | null;
  rtoTargetHours: number | null;
  services: ScenarioServiceLinkFront[];
  steps: RunbookStepFront[];
};

export type TabId = "services" | "analysis" | "graph" | "landing" | "scenarios";

export type TabDefinition = {
  id: TabId;
  label: string;
  description: string;
};

export type ServiceDomain = {
  value: string;
  label: string;
  icon: string;
};

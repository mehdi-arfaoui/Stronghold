import { api } from "./client";

export interface RunbookStep {
  id?: string;
  order: number;
  phase?: 'detection' | 'containment' | 'recovery' | 'validation' | 'communication';
  title: string;
  description: string;
  serviceId?: string;
  serviceName?: string;
  type: "manual" | "automated" | "decision" | "notification";
  estimatedDurationMinutes: number;
  prerequisites?: string[];
  validationCriteria?: string;
  assignee?: string;
  assignedRole: string;
  commands?: string[];
  verificationCheck?: string;
  rollbackInstructions?: string;
}

export interface RunbookContextNode {
  id: string;
  name: string;
  type: string;
  provider?: string;
  region?: string;
  availabilityZone?: string;
  tier?: number;
  impactedAtMinutes: number;
  impactedAtSeconds: number;
}

export interface RunbookPropagationEvent {
  timestampMinutes: number;
  delaySeconds: number;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  impactType: string;
  impactSeverity: string;
  edgeType: string;
  parentNodeId: string | null;
  parentNodeName: string | null;
  description: string;
}

export interface RunbookContext {
  simulationId: string;
  scenarioType: string;
  impactedNodes: RunbookContextNode[];
  propagationTimeline: RunbookPropagationEvent[];
  predictedRTO: number;
  predictedRPO: number;
}

export interface RunbookRecord {
  id: string;
  title: string;
  description?: string | null;
  summary?: string | null;
  status: string;
  simulationId?: string | null;
  recommendationId?: string | null;
  steps?: RunbookStep[] | null;
  context?: RunbookContext | null;
  responsible?: string | null;
  accountable?: string | null;
  consulted?: string | null;
  informed?: string | null;
  lastTestedAt?: string | null;
  testResult?: string | null;
  generatedAt: string;
  updatedAt: string;
}

export interface GenerateRunbookResponse {
  runbook: RunbookRecord;
  predictedRTO?: number;
  predictedRPO?: number;
  generationMode?: "simulation" | string;
}

export const runbooksApi = {
  getAll: () => api.get<RunbookRecord[]>("/runbooks"),

  getById: (id: string) => api.get<RunbookRecord>(`/runbooks/${id}`),

  generate: (payload: {
    simulationId?: string;
    scenarioId?: string;
    recommendationId?: string;
    title?: string;
    summary?: string;
    description?: string;
    responsible?: string;
    accountable?: string;
    consulted?: string;
    informed?: string;
  }) => api.post<GenerateRunbookResponse>("/runbooks/generate", payload),

  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<RunbookRecord>(`/runbooks/${id}`, payload),

  validate: (id: string, payload?: { testResult?: string; lastTestedAt?: string }) =>
    api.put<RunbookRecord>(`/runbooks/${id}/validate`, payload ?? {}),
};

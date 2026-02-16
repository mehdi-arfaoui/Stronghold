import { api } from "./client";

export interface RunbookStep {
  order: number;
  title: string;
  description: string;
  type: "manual" | "automated" | "decision" | "notification";
  estimatedDurationMinutes: number;
  assignedRole: string;
  commands?: string[];
  verificationCheck?: string;
  rollbackInstructions?: string;
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


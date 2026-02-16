import { api } from "./client";

export type RemediationStatus =
  | "todo"
  | "in_progress"
  | "done"
  | "blocked"
  | "cancelled";
export type RemediationPriority = "critical" | "high" | "medium" | "low";

export interface RemediationTask {
  id: string;
  title: string;
  description?: string | null;
  recommendationId: string;
  status: RemediationStatus;
  priority: RemediationPriority;
  assignee?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  riskReduction?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RemediationSummary {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  doneCount: number;
  completionRate: number;
  estimatedCostTotal: number;
  actualCostTotal: number;
}

export const remediationApi = {
  create: (payload: Partial<RemediationTask> & { title: string; recommendationId: string }) =>
    api.post<RemediationTask>("/remediation-tasks", payload),

  getAll: (params?: { status?: string; priority?: string }) =>
    api.get<RemediationTask[]>("/remediation-tasks", { params }),

  update: (id: string, payload: Partial<RemediationTask>) =>
    api.patch<RemediationTask>(`/remediation-tasks/${id}`, payload),

  getSummary: () => api.get<RemediationSummary>("/remediation-tasks/summary"),
};


import { api } from "./client";

export type PRAExerciseStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled";
export type PRAExerciseOutcome = "success" | "partial" | "failure";

export interface PRAExercise {
  id: string;
  title: string;
  description?: string | null;
  runbookId?: string | null;
  simulationId?: string | null;
  scheduledAt: string;
  executedAt?: string | null;
  duration?: number | null;
  status: PRAExerciseStatus;
  outcome?: PRAExerciseOutcome | null;
  actualRTO?: number | null;
  actualRPO?: number | null;
  findings?: Record<string, unknown> | null;
  predictedRTO?: number | null;
  predictedRPO?: number | null;
  deviationRTO?: number | null;
  deviationRPO?: number | null;
  runbook?: { id: string; title: string; status: string } | null;
  simulation?: {
    id: string;
    name: string | null;
    scenarioType: string;
    createdAt?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PRAExerciseComparison {
  id: string;
  title: string;
  status: PRAExerciseStatus;
  scheduledAt: string;
  executedAt?: string | null;
  duration?: number | null;
  outcome?: PRAExerciseOutcome | null;
  predicted: { rto: number | null; rpo: number | null };
  actual: { rto: number | null; rpo: number | null };
  deviation: { rto: number | null; rpo: number | null };
  findings?: Record<string, unknown> | null;
  runbook?: { id: string; title: string; status: string } | null;
  simulation?: { id: string; name: string | null; scenarioType: string } | null;
}

export const praExercisesApi = {
  create: (payload: {
    title: string;
    description?: string;
    runbookId?: string;
    simulationId?: string;
    scheduledAt: string;
    status?: PRAExerciseStatus;
    predictedRTO?: number;
    predictedRPO?: number;
  }) => api.post<PRAExercise>("/pra-exercises", payload),

  getAll: (params?: { status?: string }) =>
    api.get<PRAExercise[]>("/pra-exercises", { params }),

  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<PRAExercise>(`/pra-exercises/${id}`, payload),

  getComparison: (id: string) =>
    api.get<PRAExerciseComparison>(`/pra-exercises/${id}/comparison`),
};


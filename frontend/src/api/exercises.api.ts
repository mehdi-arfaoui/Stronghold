import { api } from './client';

export interface Exercise {
  id: string;
  name: string;
  type: 'tabletop' | 'walkthrough' | 'simulation' | 'full';
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  scheduledDate: string;
  completedDate?: string;
  participants: string[];
  scenario?: string;
  results?: ExerciseResult;
}

export interface ExerciseResult {
  rtoAchieved: number;
  rpoAchieved: number;
  score: number;
  findings: string[];
  improvements: string[];
}

export const exercisesApi = {
  getAll: () =>
    api.get<Exercise[]>('/exercises'),

  getById: (id: string) =>
    api.get<Exercise>(`/exercises/${id}`),

  create: (data: Partial<Exercise>) =>
    api.post<Exercise>('/exercises', data),

  update: (id: string, data: Partial<Exercise>) =>
    api.patch<Exercise>(`/exercises/${id}`, data),
};

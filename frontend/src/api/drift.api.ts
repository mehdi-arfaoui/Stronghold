import { api } from './client';

export interface DriftEvent {
  id: string;
  type: string;
  severity: string;
  category: string;
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  description: string;
  details: Record<string, unknown>;
  affectsBIA: boolean;
  affectsRTO: boolean;
  affectsSPOF: boolean;
  status: string;
  createdAt: string;
  snapshot?: { id: string; capturedAt: string; nodeCount: number; edgeCount: number };
}

export interface DriftScore {
  score: number;
  previousScore: number;
  delta: number;
  trend: 'improving' | 'stable' | 'degrading';
  lastScanAt: string | null;
  nextScanAt: string | null;
  scheduleEnabled: boolean;
}

export interface DriftSnapshot {
  id: string;
  capturedAt: string;
  nodeCount: number;
  edgeCount: number;
  nodesHash: string;
  driftCount: number;
  openDriftCount: number;
}

export interface DriftSchedule {
  id: string;
  cronExpr: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  alertEmail: string | null;
  alertWebhook: string | null;
  alertOnCritical: boolean;
  alertOnHigh: boolean;
}

export const driftApi = {
  runCheck: () =>
    api.post('/drift/check'),

  getEvents: (params?: { status?: string; severity?: string; limit?: number }) =>
    api.get<{ events: DriftEvent[]; summary: { byStatus: Record<string, number>; bySeverity: Record<string, number> } }>('/drift/events', { params }),

  getEvent: (id: string) =>
    api.get<DriftEvent>(`/drift/events/${id}`),

  updateEvent: (id: string, data: { status: string; resolvedBy?: string }) =>
    api.patch<DriftEvent>(`/drift/events/${id}`, data),

  getSnapshots: (limit?: number) =>
    api.get<DriftSnapshot[]>('/drift/snapshots', { params: { limit } }),

  getScore: () =>
    api.get<DriftScore>('/drift/score'),

  getScoreHistory: (days?: number) =>
    api.get('/drift/score/history', { params: { days } }),

  getSchedule: () =>
    api.get<DriftSchedule>('/drift/schedule'),

  updateSchedule: (data: Partial<DriftSchedule>) =>
    api.put<DriftSchedule>('/drift/schedule', data),
};

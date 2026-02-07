import { api } from './client';

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'investigating' | 'mitigating' | 'resolved' | 'closed';
  affectedNodes: string[];
  createdAt: string;
  resolvedAt?: string;
  timeline: IncidentEvent[];
}

export interface IncidentEvent {
  timestamp: string;
  description: string;
  author: string;
}

export const incidentsApi = {
  getAll: () =>
    api.get<Incident[]>('/incidents'),

  getById: (id: string) =>
    api.get<Incident>(`/incidents/${id}`),

  create: (data: Partial<Incident>) =>
    api.post<Incident>('/incidents', data),

  update: (id: string, data: Partial<Incident>) =>
    api.patch<Incident>(`/incidents/${id}`, data),

  addEvent: (id: string, event: Omit<IncidentEvent, 'timestamp'>) =>
    api.post(`/incidents/${id}/events`, event),
};

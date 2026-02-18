import type { AxiosResponse } from 'axios';
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

interface IncidentActionPayload {
  createdAt?: string | null;
  description?: string | null;
  actionType?: string | null;
  metadata?: unknown;
}

interface IncidentServicePayload {
  serviceId?: string | null;
  service?: { id?: string | null } | null;
}

interface IncidentPayload {
  id: string;
  title?: string | null;
  description?: string | null;
  severity?: string | null;
  status?: string | null;
  affectedNodes?: unknown;
  detectedAt?: string | null;
  createdAt?: string | null;
  resolvedAt?: string | null;
  actions?: IncidentActionPayload[] | null;
  services?: IncidentServicePayload[] | null;
}

const STATUS_MAP: Record<string, Incident['status']> = {
  OPEN: 'open',
  IN_PROGRESS: 'investigating',
  INVESTIGATING: 'investigating',
  MITIGATING: 'mitigating',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

const SEVERITY_MAP: Record<string, Incident['severity']> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

function normalizeStatus(value: unknown): Incident['status'] {
  if (typeof value !== 'string') return 'open';
  return STATUS_MAP[value.trim().toUpperCase()] ?? 'open';
}

function normalizeSeverity(value: unknown): Incident['severity'] {
  if (typeof value !== 'string') return 'medium';
  return SEVERITY_MAP[value.trim().toUpperCase()] ?? 'medium';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry === null || entry === undefined ? '' : String(entry).trim()))
    .filter((entry) => entry.length > 0);
}

function extractNodesFromActions(actions: IncidentActionPayload[] | null | undefined): string[] {
  if (!Array.isArray(actions)) return [];
  const nodeIds: string[] = [];

  for (const action of actions) {
    const metadata = action.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;

    const affectedNodeIds = (metadata as Record<string, unknown>).affectedNodeIds;
    nodeIds.push(...toStringArray(affectedNodeIds));
  }

  return nodeIds;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeTimeline(actions: IncidentActionPayload[] | null | undefined): IncidentEvent[] {
  if (!Array.isArray(actions)) return [];

  return actions.map((action) => ({
    timestamp: action.createdAt ? String(action.createdAt) : new Date().toISOString(),
    description: action.description?.trim() || action.actionType?.trim() || 'Action incident',
    author: 'system',
  }));
}

function normalizeIncident(payload: IncidentPayload): Incident {
  const rawAffectedNodes = toStringArray(payload.affectedNodes);
  const affectedNodesFromActions = extractNodesFromActions(payload.actions);
  const affectedNodesFromServices = (payload.services ?? [])
    .map((entry) => entry.service?.id ?? entry.serviceId ?? '')
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);

  const affectedNodes = dedupe([
    ...rawAffectedNodes,
    ...affectedNodesFromActions,
    ...affectedNodesFromServices,
  ]);

  const status = normalizeStatus(payload.status);
  const createdAt = payload.detectedAt || payload.createdAt || new Date().toISOString();

  return {
    id: payload.id,
    title: payload.title?.trim() || 'Incident sans titre',
    description: payload.description?.trim() || '',
    severity: normalizeSeverity(payload.severity),
    status,
    affectedNodes,
    createdAt,
    resolvedAt:
      payload.resolvedAt || (status === 'resolved' || status === 'closed' ? payload.createdAt || undefined : undefined),
    timeline: normalizeTimeline(payload.actions),
  };
}

function mapIncidentResponse(
  response: AxiosResponse<IncidentPayload>,
): AxiosResponse<Incident> {
  return {
    ...response,
    data: normalizeIncident(response.data),
  };
}

function mapIncidentListResponse(
  response: AxiosResponse<IncidentPayload[]>,
): AxiosResponse<Incident[]> {
  return {
    ...response,
    data: (response.data ?? []).map(normalizeIncident),
  };
}

function toIncidentWritePayload(data: Partial<Incident>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data };
  if (typeof data.status === 'string') {
    payload.status = data.status.toUpperCase();
  }
  return payload;
}

export const incidentsApi = {
  getAll: () =>
    api.get<IncidentPayload[]>('/incidents').then(mapIncidentListResponse),

  getById: (id: string) =>
    api.get<IncidentPayload>(`/incidents/${id}`).then(mapIncidentResponse),

  create: (data: Partial<Incident>) =>
    api.post<IncidentPayload>('/incidents', toIncidentWritePayload(data)).then(mapIncidentResponse),

  update: (id: string, data: Partial<Incident>) =>
    api.patch<IncidentPayload>(`/incidents/${id}`, toIncidentWritePayload(data)).then(mapIncidentResponse),

  addEvent: (id: string, event: Omit<IncidentEvent, 'timestamp'>) =>
    api.post(`/incidents/${id}/actions`, event),
};

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  message: string;
  code: string;
  details?: Record<string, unknown>;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface TimeRange {
  start: string;
  end: string;
}

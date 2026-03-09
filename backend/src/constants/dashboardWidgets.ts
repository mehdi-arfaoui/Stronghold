export type DashboardWidgetId =
  | 'resilience-score'
  | 'spof-count'
  | 'budget-dr'
  | 'top-critical-services'
  | 'recommendations-status'
  | 'compliance-iso22301'
  | 'compliance-nis2'
  | 'last-scans'
  | 'drifts-detected'
  | 'cost-dr-by-strategy'
  | 'roi-global'
  | 'services-by-provider'
  | 'services-by-tier'
  | 'rto-vs-target';

export interface DashboardLayoutItem {
  widgetId: DashboardWidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const KNOWN_DASHBOARD_WIDGET_IDS: ReadonlySet<DashboardWidgetId> = new Set([
  'resilience-score',
  'spof-count',
  'budget-dr',
  'top-critical-services',
  'recommendations-status',
  'compliance-iso22301',
  'compliance-nis2',
  'last-scans',
  'drifts-detected',
  'cost-dr-by-strategy',
  'roi-global',
  'services-by-provider',
  'services-by-tier',
  'rto-vs-target',
]);

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutItem[] = [
  { widgetId: 'resilience-score', x: 0, y: 0, w: 4, h: 2 },
  { widgetId: 'spof-count', x: 4, y: 0, w: 4, h: 2 },
  { widgetId: 'budget-dr', x: 8, y: 0, w: 4, h: 2 },
  { widgetId: 'top-critical-services', x: 0, y: 2, w: 6, h: 3 },
  { widgetId: 'recommendations-status', x: 6, y: 2, w: 6, h: 3 },
  { widgetId: 'compliance-iso22301', x: 0, y: 5, w: 4, h: 2 },
  { widgetId: 'compliance-nis2', x: 4, y: 5, w: 4, h: 2 },
  { widgetId: 'last-scans', x: 8, y: 5, w: 4, h: 2 },
];

function toNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < 0) return null;
  return value;
}

function toBoundedInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeDashboardLayout(input: unknown): DashboardLayoutItem[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const sanitized: DashboardLayoutItem[] = [];

  for (const rawItem of input) {
    if (!isRecord(rawItem)) continue;

    const rawWidgetId = rawItem.widgetId;
    if (typeof rawWidgetId !== 'string') continue;
    if (!KNOWN_DASHBOARD_WIDGET_IDS.has(rawWidgetId as DashboardWidgetId)) continue;
    if (seen.has(rawWidgetId)) continue;

    const x = toNonNegativeInteger(rawItem.x);
    const y = toNonNegativeInteger(rawItem.y);
    const w = toBoundedInteger(rawItem.w, 1, 12);
    const h = toBoundedInteger(rawItem.h, 1, 10);
    if (x == null || y == null || w == null || h == null) continue;

    seen.add(rawWidgetId);
    sanitized.push({
      widgetId: rawWidgetId as DashboardWidgetId,
      x,
      y,
      w,
      h,
    });
  }

  return sanitized;
}

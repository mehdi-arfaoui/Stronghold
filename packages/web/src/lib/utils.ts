import { GRADE_COLORS, STATUS_COLORS } from './constants';

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatRelativeScore(score: number | null): string {
  return score == null ? 'N/A' : `${Math.round(score)}`;
}

export function formatRegions(regions: readonly string[]): string {
  return regions.length === 0 ? 'No regions' : regions.join(', ');
}

export function getGradeColor(grade: string | null): string {
  return grade ? GRADE_COLORS[grade] ?? '#9ca3af' : '#9ca3af';
}

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#9ca3af';
}

export function themeColor(token: string, alpha?: number): string {
  return alpha == null ? `hsl(var(--${token}))` : `hsl(var(--${token}) / ${alpha})`;
}

export function humanBlastRadius(count: number): string {
  if (count <= 0) {
    return 'No direct service dependencies detected.';
  }

  const noun = count === 1 ? 'service depends on this resource' : 'services depend on this resource';
  return `${count} ${noun}.`;
}

export function formatMinutesRange(min: number | null, max: number | null): string {
  if (min == null || max == null) {
    return 'Requires testing';
  }
  if (min === max) {
    return `${min} min`;
  }
  return `${min}-${max} min`;
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function kebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

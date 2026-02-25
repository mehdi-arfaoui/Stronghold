export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

export function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readPositiveNumber(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed == null || parsed <= 0) return null;
  return parsed;
}

export function readStringFromKeys(
  metadata: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = readString(metadata[key]);
    if (value) return value;
  }
  return null;
}

export function readPositiveNumberFromKeys(
  metadata: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = readPositiveNumber(metadata[key]);
    if (value != null) return value;
  }
  return null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => item.toLowerCase());
}

export function includesAnyToken(values: string[], tokens: readonly string[]): boolean {
  return values.some((value) => tokens.some((token) => value.includes(token.toLowerCase())));
}

export function countDistinctNonEmpty(values: Array<string | null | undefined>): number {
  return new Set(values.filter((value): value is string => Boolean(value && value.trim()))).size;
}

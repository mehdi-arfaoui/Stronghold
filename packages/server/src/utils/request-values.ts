export function getSingleValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (typeof value === 'string' || value === undefined) {
    return value;
  }

  return value[0];
}

const REGEX_SPECIAL_CHARS_RE = /[.+?^${}()|[\]\\]/gu;

/**
 * Checks whether a service name matches a contract service pattern.
 */
export function matchesServicePattern(serviceName: string, pattern: string): boolean {
  if (pattern.length === 0) {
    return false;
  }

  return globToRegex(pattern).test(serviceName);
}

/**
 * Filters service names by a contract service pattern.
 */
export function filterServicesByPattern(
  serviceNames: readonly string[],
  pattern: string,
): string[] {
  return serviceNames.filter((serviceName) => matchesServicePattern(serviceName, pattern));
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(REGEX_SPECIAL_CHARS_RE, '\\$&');
  const withWildcard = escaped.replace(/\*/gu, '.*');
  return new RegExp(`^${withWildcard}$`, 'u');
}

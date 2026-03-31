import type { RunbookStrategyFn } from './runbook-types.js';

type RegistryKey = string;

const registry = new Map<RegistryKey, RunbookStrategyFn>();

/** Registers a runbook strategy function for a node type and recovery strategy pair. */
export function registerRunbookStrategy(
  nodeType: string,
  strategy: string,
  fn: RunbookStrategyFn,
): void {
  registry.set(`${nodeType}:${strategy}`, fn);
}

/** Returns the most specific registered runbook strategy for the given inputs. */
export function getRunbookStrategy(
  nodeType: string,
  strategy: string,
): RunbookStrategyFn | null {
  const exact = registry.get(`${nodeType}:${strategy}`);
  if (exact) return exact;

  const typeWildcard = registry.get(`${nodeType}:*`);
  if (typeWildcard) return typeWildcard;

  const strategyWildcard = registry.get(`*:${strategy}`);
  if (strategyWildcard) return strategyWildcard;

  return null;
}

/** Lists all registered runbook strategy keys. */
export function listRegisteredStrategies(): readonly string[] {
  return [...registry.keys()];
}

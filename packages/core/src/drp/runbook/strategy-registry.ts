import type {
  RunbookStrategyDefinition,
  RunbookStrategyFn,
} from './runbook-types.js';

type RegistryKey = string;

const registry = new Map<RegistryKey, RunbookStrategyDefinition>();

const DEFAULT_RISK: RunbookStrategyDefinition = {
  generate: () => {
    throw new Error('Runbook strategy generate() should never be called on the default risk stub.');
  },
  executionRisk: 'caution',
  riskReason: 'Execution risk was not declared for this strategy.',
};

/** Registers a runbook strategy function for a node type and recovery strategy pair. */
export function registerRunbookStrategy(
  nodeType: string,
  strategy: string,
  definition: RunbookStrategyDefinition | RunbookStrategyFn,
): void {
  registry.set(`${nodeType}:${strategy}`, toStrategyDefinition(definition));
}

/** Returns the most specific registered runbook strategy for the given inputs. */
export function getRunbookStrategy(
  nodeType: string,
  strategy: string,
): RunbookStrategyFn | null {
  return getRunbookStrategyDefinition(nodeType, strategy)?.generate ?? null;
}

/** Returns the most specific registered runbook strategy definition for the given inputs. */
export function getRunbookStrategyDefinition(
  nodeType: string,
  strategy: string,
): RunbookStrategyDefinition | null {
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

/** Lists all registered runbook strategy definitions keyed by registry lookup. */
export function listRegisteredStrategyDefinitions(): Readonly<Record<string, RunbookStrategyDefinition>> {
  return Object.freeze(Object.fromEntries(registry.entries()));
}

function toStrategyDefinition(
  definition: RunbookStrategyDefinition | RunbookStrategyFn,
): RunbookStrategyDefinition {
  if (typeof definition === 'function') {
    return {
      ...DEFAULT_RISK,
      generate: definition,
    };
  }

  return definition;
}

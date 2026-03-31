import { describe, expect, it } from 'vitest';

import type { ComponentRunbook, RunbookStrategyFn } from './runbook-types.js';
import {
  getRunbookStrategy,
  listRegisteredStrategies,
  registerRunbookStrategy,
} from './strategy-registry.js';

function createDummyRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
): ComponentRunbook {
  return {
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: [],
    steps: [],
    rollback: { description: 'noop', steps: [] },
    finalValidation: null,
    warnings: [],
  };
}

function createStrategy(label: string): RunbookStrategyFn {
  return (componentId, componentName, componentType, strategy) =>
    createDummyRunbook(componentId, `${componentName}-${label}`, componentType, strategy);
}

describe('runbook strategy registry', () => {
  it('registerRunbookStrategy stores a retrievable strategy', () => {
    const strategy = createStrategy('register');
    registerRunbookStrategy('unit-test-node-a', 'exact-a', strategy);

    expect(getRunbookStrategy('unit-test-node-a', 'exact-a')).toBe(strategy);
  });

  it('getRunbookStrategy returns an exact node type and exact strategy match', () => {
    const exact = createStrategy('exact');
    registerRunbookStrategy('unit-test-node-b', 'exact-b', exact);

    expect(getRunbookStrategy('unit-test-node-b', 'exact-b')).toBe(exact);
  });

  it('getRunbookStrategy falls back to nodeType:* when needed', () => {
    const wildcard = createStrategy('type-wildcard');
    registerRunbookStrategy('unit-test-node-c', '*', wildcard);

    expect(getRunbookStrategy('unit-test-node-c', 'missing-strategy')).toBe(wildcard);
  });

  it('getRunbookStrategy returns null when nothing matches', () => {
    expect(getRunbookStrategy('unit-test-node-missing', 'missing-strategy')).toBeNull();
  });

  it('listRegisteredStrategies includes registered keys', () => {
    registerRunbookStrategy('unit-test-node-d', 'exact-d', createStrategy('listed'));

    expect(listRegisteredStrategies()).toContain('unit-test-node-d:exact-d');
  });
});

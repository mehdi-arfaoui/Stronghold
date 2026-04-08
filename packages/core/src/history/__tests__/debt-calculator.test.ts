import { describe, expect, it } from 'vitest';

import { calculateServiceDebt } from '../debt-calculator.js';
import type { FindingLifecycle, TrackedFinding } from '../finding-lifecycle-types.js';
import type { ServicePosture } from '../../services/index.js';

describe('calculateServiceDebt', () => {
  it('calculates critical debt with the highest factors', () => {
    const debt = calculateServiceDebt({
      servicePosture: createPosture('critical'),
      trackedFindings: [trackedFinding('rule-a::node-1', 'critical')],
      findingLifecycles: [lifecycle('rule-a::node-1', 10)],
    });

    expect(debt[0]?.findingDebts[0]?.debt).toBe(160);
  });

  it('calculates low debt with fractional factors', () => {
    const debt = calculateServiceDebt({
      servicePosture: createPosture('low'),
      trackedFindings: [trackedFinding('rule-a::node-1', 'low')],
      findingLifecycles: [lifecycle('rule-a::node-1', 10)],
    });

    expect(debt[0]?.findingDebts[0]?.debt).toBe(2.5);
  });

  it('applies a recurrence multiplier to recurrent findings', () => {
    const debt = calculateServiceDebt({
      servicePosture: createPosture('critical'),
      trackedFindings: [trackedFinding('rule-a::node-1', 'critical')],
      findingLifecycles: [lifecycle('rule-a::node-1', 10, { isRecurrent: true, recurrenceCount: 1 })],
    });

    expect(debt[0]?.findingDebts[0]?.debt).toBe(240);
  });

  it('sums finding debt per service and detects a decreasing trend', () => {
    const debt = calculateServiceDebt({
      servicePosture: createPosture('high'),
      trackedFindings: [
        trackedFinding('rule-a::node-1', 'critical'),
        trackedFinding('rule-b::node-2', 'high'),
      ],
      findingLifecycles: [lifecycle('rule-a::node-1', 10), lifecycle('rule-b::node-2', 5)],
      previousDebt: [
        {
          serviceId: 'payment',
          serviceName: 'Payment',
          totalDebt: 200,
          criticalDebt: 100,
          findingDebts: [],
          trend: 'stable',
        },
      ],
    });

    expect(debt[0]?.totalDebt).toBe(100);
    expect(debt[0]?.trend).toBe('decreasing');
  });

  it('marks debt as increasing when it grows by more than ten percent', () => {
    const debt = calculateServiceDebt({
      servicePosture: createPosture('medium'),
      trackedFindings: [trackedFinding('rule-a::node-1', 'medium')],
      findingLifecycles: [lifecycle('rule-a::node-1', 20)],
      previousDebt: [
        {
          serviceId: 'payment',
          serviceName: 'Payment',
          totalDebt: 10,
          criticalDebt: 0,
          findingDebts: [],
          trend: 'stable',
        },
      ],
    });

    expect(debt[0]?.trend).toBe('increasing');
  });

  it('gives new findings zero debt on day one', () => {
    const debt = calculateServiceDebt({
      servicePosture: createPosture('critical'),
      trackedFindings: [trackedFinding('rule-a::node-1', 'critical')],
      findingLifecycles: [lifecycle('rule-a::node-1', 0)],
    });

    expect(debt[0]?.findingDebts[0]?.debt).toBe(0);
  });

  it('returns zero debt for services with no active findings', () => {
    const debt = calculateServiceDebt({
      servicePosture: createPosture('medium'),
      trackedFindings: [],
      findingLifecycles: [],
    });

    expect(debt[0]?.totalDebt).toBe(0);
    expect(debt[0]?.findingDebts).toEqual([]);
  });
});

function createPosture(criticality: 'critical' | 'high' | 'medium' | 'low'): ServicePosture {
  return {
    detection: {
      services: [
        {
          id: 'payment',
          name: 'Payment',
          criticality,
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
          resources: [{ nodeId: 'node-1', detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 } }],
          metadata: {},
        },
      ],
      unassignedResources: [],
      detectionSummary: {
        cloudformation: 0,
        tag: 0,
        topology: 0,
        manual: 1,
        totalResources: 1,
        assignedResources: 1,
        unassignedResources: 0,
      },
    },
    scoring: {
      services: [],
      unassigned: null,
    },
    contextualFindings: [],
    recommendations: [],
    services: [
      {
        service: {
          id: 'payment',
          name: 'Payment',
          criticality,
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
          resources: [{ nodeId: 'node-1', detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 } }],
          metadata: {},
        },
        score: {
          serviceId: 'payment',
          serviceName: 'Payment',
          resourceCount: 1,
          criticality,
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
          score: 34,
          grade: 'D',
          findingsCount: { critical: 0, high: 0, medium: 0, low: 0 },
          findings: [],
          coverageGaps: [],
        },
        contextualFindings: [],
        recommendations: [],
      },
    ],
    unassigned: {
      score: null,
      resourceCount: 0,
      contextualFindings: [],
      recommendations: [],
    },
  };
}

function trackedFinding(
  findingKey: string,
  severity: 'critical' | 'high' | 'medium' | 'low',
): TrackedFinding {
  const [ruleId, nodeId] = findingKey.split('::');
  return {
    findingKey,
    ruleId: ruleId ?? findingKey,
    nodeId: nodeId ?? findingKey,
    severity,
    serviceId: 'payment',
    serviceName: 'Payment',
  };
}

function lifecycle(
  findingKey: string,
  ageInDays: number,
  overrides: Partial<FindingLifecycle> = {},
): FindingLifecycle {
  const [ruleId, nodeId] = findingKey.split('::');
  const firstSeenAt = new Date(Date.UTC(2026, 3, 20 - ageInDays)).toISOString();
  return {
    findingKey,
    ruleId: ruleId ?? findingKey,
    nodeId: nodeId ?? findingKey,
    severity: 'critical',
    status: overrides.isRecurrent ? 'recurrent' : 'active',
    firstSeenAt,
    lastSeenAt: '2026-04-20T00:00:00.000Z',
    recurrenceCount: overrides.recurrenceCount ?? 0,
    isRecurrent: overrides.isRecurrent ?? false,
    ageInDays,
    serviceId: 'payment',
    serviceName: 'Payment',
    ...overrides,
  };
}

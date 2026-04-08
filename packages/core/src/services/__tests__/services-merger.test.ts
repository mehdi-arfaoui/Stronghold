import { describe, expect, it } from 'vitest';

import { mergeServices } from '../services-merger.js';
import type { Service, ServiceDetectionResult } from '../service-types.js';

describe('mergeServices', () => {
  it('lets manual services win over auto-detected services', () => {
    const result = mergeServices(
      createAutoDetectedResult([
        createService('payment-auto', 'Payment Auto', 'tag', ['db-1', 'lambda-1']),
        createService('auth', 'Auth', 'cloudformation', ['lambda-2']),
      ]),
      [createService('payment', 'Payment Service', 'manual', ['db-1'])],
    );

    expect(result.services.map((service) => service.id)).toEqual(['payment', 'payment-auto', 'auth']);
    expect(result.services.find((service) => service.id === 'payment-auto')?.resources).toEqual([
      {
        nodeId: 'lambda-1',
        detectionSource: {
          type: 'tag',
          key: 'service',
          value: 'Payment Auto',
          confidence: 0.75,
        },
      },
    ]);
  });

  it('drops empty auto services and removes manual resources from unassigned', () => {
    const result = mergeServices(
      {
        services: [createService('payment', 'Payment', 'topology', ['db-1'])],
        unassignedResources: ['db-1', 'orphan'],
        detectionSummary: {
          cloudformation: 0,
          tag: 0,
          topology: 1,
          manual: 0,
          totalResources: 2,
          assignedResources: 1,
          unassignedResources: 1,
        },
      },
      [createService('payment', 'Payment', 'manual', ['db-1'])],
    );

    expect(result.services).toHaveLength(1);
    expect(result.unassignedResources).toEqual(['orphan']);
  });

  it('is idempotent when there are no manual services', () => {
    const autoDetected = createAutoDetectedResult([
      createService('auth', 'Auth', 'tag', ['lambda-1']),
    ]);

    expect(mergeServices(autoDetected, [])).toEqual(autoDetected);
  });
});

function createAutoDetectedResult(services: readonly Service[]): ServiceDetectionResult {
  return {
    services,
    unassignedResources: [],
    detectionSummary: {
      cloudformation: services.filter((service) => service.detectionSource.type === 'cloudformation')
        .length,
      tag: services.filter((service) => service.detectionSource.type === 'tag').length,
      topology: services.filter((service) => service.detectionSource.type === 'topology').length,
      manual: 0,
      totalResources: services.flatMap((service) => service.resources).length,
      assignedResources: services.flatMap((service) => service.resources).length,
      unassignedResources: 0,
    },
  };
}

function createService(
  id: string,
  name: string,
  detectionType: 'cloudformation' | 'tag' | 'topology' | 'manual',
  resourceIds: readonly string[],
): Service {
  const detectionSource =
    detectionType === 'cloudformation'
      ? { type: 'cloudformation', stackName: name, confidence: 0.9 as const }
      : detectionType === 'tag'
        ? { type: 'tag', key: 'service', value: name, confidence: 0.75 as const }
        : detectionType === 'topology'
          ? { type: 'topology', algorithm: 'connected-components', confidence: 0.45 as const }
          : { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 as const };

  return {
    id,
    name,
    criticality: 'medium',
    detectionSource,
    resources: resourceIds.map((resourceId) => ({
      nodeId: resourceId,
      detectionSource,
    })),
    metadata: {},
  };
}

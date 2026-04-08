import { describe, expect, it } from 'vitest';

import type { InfraNode, ValidationEdge } from '../../validation/validation-types.js';
import { detectServices } from '../service-detector.js';

describe('detectServices', () => {
  it('prefers CloudFormation over lower-confidence strategies and tracks unassigned resources', () => {
    const nodes = [
      createNode('payment-api', 'SERVERLESS', {
        tags: {
          'aws:cloudformation:stack-name': 'payment-stack',
          service: 'payment',
          Name: 'payment-api',
        },
        sourceType: 'lambda',
      }),
      createNode('payment-db', 'DATABASE', {
        tags: {
          'aws:cloudformation:stack-name': 'payment-stack',
          service: 'payment',
          Name: 'payment-db',
        },
        sourceType: 'rds',
      }),
      createNode('analytics-api', 'SERVERLESS', {
        tags: { service: 'analytics', Name: 'analytics-api' },
        sourceType: 'lambda',
      }),
      createNode('analytics-db', 'DATABASE', {
        tags: { Name: 'analytics-db' },
        sourceType: 'rds',
      }),
      createNode('analytics-queue', 'MESSAGE_QUEUE', {
        tags: { Name: 'analytics-queue' },
        sourceType: 'sqs',
      }),
      createNode('billing-api', 'SERVERLESS', {
        tags: { Name: 'billing-api' },
        sourceType: 'lambda',
      }),
      createNode('billing-db', 'DATABASE', {
        tags: { Name: 'billing-db' },
        sourceType: 'rds',
      }),
      createNode('lonely', 'SERVERLESS', {
        tags: {},
        sourceType: 'lambda',
      }),
    ];
    const edges: ValidationEdge[] = [
      { source: 'analytics-api', target: 'analytics-db', type: 'DEPENDS_ON' },
      { source: 'analytics-api', target: 'analytics-queue', type: 'PUBLISHES_TO' },
      { source: 'billing-api', target: 'billing-db', type: 'DEPENDS_ON' },
    ];

    const result = detectServices(nodes, edges);

    expect(result.detectionSummary.cloudformation).toBe(1);
    expect(result.detectionSummary.tag).toBe(1);
    expect(result.detectionSummary.topology).toBe(1);
    expect(result.services).toHaveLength(3);
    expect(result.unassignedResources).toContain('lonely');
    expect(result.services.find((service) => service.id === 'payment')?.detectionSource.type).toBe(
      'cloudformation',
    );
  });

  it('returns an empty detection result when the scan is empty', () => {
    const result = detectServices([], []);

    expect(result.services).toEqual([]);
    expect(result.unassignedResources).toEqual([]);
    expect(result.detectionSummary).toEqual({
      cloudformation: 0,
      tag: 0,
      topology: 0,
      manual: 0,
      totalResources: 0,
      assignedResources: 0,
      unassignedResources: 0,
    });
  });
});

function createNode(
  id: string,
  type: string,
  metadata: Record<string, unknown> & { readonly tags?: Record<string, string> },
): InfraNode {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: 'eu-west-1a',
    tags: metadata.tags ?? {},
    metadata,
  };
}

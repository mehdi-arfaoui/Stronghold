import { describe, expect, it } from 'vitest';

import type { InfraNode } from '../../validation/validation-types.js';
import { detectTagServices } from '../detection-strategies/tag-strategy.js';

describe('detectTagServices', () => {
  it('groups resources by the highest-priority application tag', () => {
    const services = detectTagServices([
      createNode('payment-api', 'SERVERLESS', {
        tags: { Service: 'payment', project: 'shared-project' },
        sourceType: 'lambda',
      }),
      createNode('payment-db', 'DATABASE', {
        tags: { service: 'payment' },
        sourceType: 'rds',
      }),
      createNode('auth-api', 'SERVERLESS', {
        tags: { application: 'auth' },
        sourceType: 'lambda',
      }),
    ]);

    expect(services).toHaveLength(2);
    expect(services.find((service) => service.id === 'payment')?.resources).toHaveLength(2);
    expect(
      services.find((service) => service.id === 'payment')?.metadata.tagKey?.toLowerCase(),
    ).toBe('service');
  });

  it('does not reuse already assigned resources during prefix detection', () => {
    const services = detectTagServices([
      createNode('payment-api', 'SERVERLESS', {
        tags: { service: 'payment', Name: 'payment-api' },
        sourceType: 'lambda',
      }),
      createNode('payment-worker', 'SERVERLESS', {
        tags: { service: 'payment', Name: 'payment-worker' },
        sourceType: 'lambda',
      }),
      createNode('payment-db', 'DATABASE', {
        tags: { Name: 'payment-db' },
        sourceType: 'rds',
      }),
      createNode('payment-queue', 'MESSAGE_QUEUE', {
        tags: { Name: 'payment-queue' },
        sourceType: 'sqs',
      }),
      createNode('payment-cron', 'SERVERLESS', {
        tags: { Name: 'payment-cron' },
        sourceType: 'lambda',
      }),
    ]);

    expect(services.find((service) => service.id === 'payment')?.resources).toHaveLength(2);
    expect(
      services.some(
        (service) =>
          service.resources.some((resource) => resource.nodeId === 'payment-api') &&
          service.detectionSource.confidence === 0.6,
      ),
    ).toBe(false);
  });

  it('proposes a prefix-based service when three or more Name tags share a prefix', () => {
    const services = detectTagServices([
      createNode('payment-api', 'SERVERLESS', {
        tags: { Name: 'payment-api' },
        sourceType: 'lambda',
      }),
      createNode('payment-worker', 'SERVERLESS', {
        tags: { Name: 'payment-worker' },
        sourceType: 'lambda',
      }),
      createNode('payment-db', 'DATABASE', {
        tags: { Name: 'payment-db' },
        sourceType: 'rds',
      }),
    ]);

    expect(services).toHaveLength(1);
    expect(services[0]?.id).toBe('payment');
    expect(services[0]?.detectionSource.confidence).toBe(0.6);
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
    availabilityZone: null,
    tags: metadata.tags ?? {},
    metadata,
  };
}

import { describe, expect, it } from 'vitest';

import type { InfraNode } from '../../validation/validation-types.js';
import { detectCloudFormationServices } from '../detection-strategies/cloudformation-strategy.js';

describe('detectCloudFormationServices', () => {
  it('groups resources that share the same CloudFormation stack tag', () => {
    const services = detectCloudFormationServices([
      createNode('payment-api', 'SERVERLESS', {
        tags: { 'aws:cloudformation:stack-name': 'payment-api-prod' },
        sourceType: 'lambda',
      }),
      createNode('payment-db', 'DATABASE', {
        tags: { 'aws:cloudformation:stack-name': 'payment-api-prod' },
        sourceType: 'rds',
      }),
      createNode('auth-api', 'SERVERLESS', {
        tags: { 'aws:cloudformation:stack-name': 'auth-stack' },
        sourceType: 'lambda',
      }),
    ]);

    expect(services).toHaveLength(2);
    expect(services.find((service) => service.id === 'payment-api')?.resources).toHaveLength(2);
    expect(services.find((service) => service.id === 'auth')?.resources).toHaveLength(1);
  });

  it('skips infrastructure-only stacks', () => {
    const services = detectCloudFormationServices([
      createNode('vpc-1', 'VPC', {
        tags: { 'aws:cloudformation:stack-name': 'core-networking' },
        sourceType: 'vpc',
      }),
      createNode('subnet-a', 'SUBNET', {
        tags: { 'aws:cloudformation:stack-name': 'core-networking' },
        sourceType: 'subnet',
      }),
      createNode('sg-1', 'FIREWALL', {
        tags: { 'aws:cloudformation:stack-name': 'core-networking' },
        sourceType: 'security-group',
      }),
    ]);

    expect(services).toEqual([]);
  });

  it('keeps mixed stacks that include workload resources', () => {
    const services = detectCloudFormationServices([
      createNode('network-vpc', 'VPC', {
        tags: { 'aws:cloudformation:stack-name': 'payment-stack' },
        sourceType: 'vpc',
      }),
      createNode('payment-db', 'DATABASE', {
        tags: { 'aws:cloudformation:stack-name': 'payment-stack' },
        sourceType: 'rds',
      }),
      createNode('payment-worker', 'SERVERLESS', {
        tags: { 'aws:cloudformation:stack-name': 'payment-stack' },
        sourceType: 'lambda',
      }),
    ]);

    expect(services).toHaveLength(1);
    expect(services[0]?.resources).toHaveLength(3);
  });

  it('ignores resources that do not have a CloudFormation stack tag', () => {
    const services = detectCloudFormationServices([
      createNode('payment-api', 'SERVERLESS', { sourceType: 'lambda' }),
      createNode('payment-db', 'DATABASE', { sourceType: 'rds' }),
    ]);

    expect(services).toEqual([]);
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

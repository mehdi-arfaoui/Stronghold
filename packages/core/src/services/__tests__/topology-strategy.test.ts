import { describe, expect, it } from 'vitest';

import type { InfraNode } from '../../validation/validation-types.js';
import { detectTopologyServices } from '../detection-strategies/topology-strategy.js';

describe('detectTopologyServices', () => {
  it('clusters only on application-level edges', () => {
    const nodes = [
      createNode('api', 'SERVERLESS', 'lambda'),
      createNode('db', 'DATABASE', 'rds'),
      createNode('vpc', 'VPC', 'vpc'),
      createNode('subnet', 'SUBNET', 'subnet'),
    ];
    const services = detectTopologyServices(nodes, [
      { source: 'api', target: 'db', type: 'DEPENDS_ON' },
      { source: 'vpc', target: 'subnet', type: 'CONTAINS' },
      { source: 'api', target: 'subnet', type: 'SECURED_BY' },
    ]);

    expect(services).toHaveLength(1);
    expect(services[0]?.resources.map((resource) => resource.nodeId).sort()).toEqual([
      'api',
      'db',
    ]);
  });

  it('requires the confidence threshold and ignores isolated nodes', () => {
    const nodes = [
      createNode('api', 'SERVERLESS', 'lambda'),
      createNode('db', 'DATABASE', 'rds'),
      createNode('worker', 'SERVERLESS', 'lambda'),
      createNode('orphan', 'SERVERLESS', 'lambda'),
    ];
    const services = detectTopologyServices(nodes, [
      { source: 'api', target: 'db', type: 'DEPENDS_ON' },
      { source: 'worker', target: 'db', type: 'TRIGGERS' },
    ]);

    expect(services).toHaveLength(1);
    expect(services[0]?.resources).toHaveLength(3);
    expect(services[0]?.resources.some((resource) => resource.nodeId === 'orphan')).toBe(false);
  });
});

function createNode(id: string, type: string, sourceType: string): InfraNode {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: 'eu-west-1a',
    tags: { Name: id },
    metadata: { sourceType },
  };
}

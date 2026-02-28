import { describe, expect, it } from 'vitest';
import {
  computeBlastRadius,
  filterServiceNodes,
  getEdgeStyle,
  getNetworkGroup,
  getNodeCategory,
  getNodeLayer,
} from './graph-visuals';
import type { InfraNode } from '@/types/graph.types';

function node(partial: Partial<InfraNode>): InfraNode {
  return {
    id: partial.id || 'n1',
    name: partial.name || 'node',
    type: partial.type || 'VM',
    provider: partial.provider,
    region: partial.region,
    metadata: partial.metadata,
    criticality: partial.criticality,
    blastRadius: partial.blastRadius,
    isSPOF: partial.isSPOF,
  };
}

describe('graph-visuals', () => {
  it('filters infrastructure nodes in services mode', () => {
    const input = [
      node({ id: 'app', type: 'VM', name: 'app-server' }),
      node({ id: 'db', type: 'DATABASE', name: 'primary-db' }),
      node({ id: 'vpc', type: 'VPC', name: 'main-vpc' }),
      node({ id: 'subnet', type: 'SUBNET', name: 'private-subnet' }),
    ];

    const servicesOnly = filterServiceNodes(input, false);
    expect(servicesOnly.map((item) => item.id)).toEqual(['app', 'db']);

    const withInfra = filterServiceNodes(input, true);
    expect(withInfra).toHaveLength(4);
  });

  it('classifies architectural layers and categories', () => {
    expect(getNodeLayer(node({ type: 'LOAD_BALANCER' }))).toBe(0);
    expect(getNodeLayer(node({ type: 'VM' }))).toBe(1);
    expect(getNodeLayer(node({ type: 'SERVERLESS' }))).toBe(2);
    expect(getNodeLayer(node({ type: 'DATABASE' }))).toBe(3);
    expect(getNodeLayer(node({ type: 'MESSAGE_QUEUE' }))).toBe(4);
    expect(getNodeLayer(node({ type: 'SUBNET' }))).toBe(5);

    expect(getNodeCategory(node({ type: 'LOAD_BALANCER' }))).toBe('loadbalancer');
    expect(getNodeCategory(node({ type: 'DATABASE' }))).toBe('database');
    expect(getNodeCategory(node({ type: 'VM' }))).toBe('compute');
  });

  it('returns edge styles by dependency type', () => {
    expect(getEdgeStyle('network_access')).toMatchObject({
      stroke: '#4299E1',
      strokeWidth: 2,
    });
    expect(getEdgeStyle('triggers')).toMatchObject({
      stroke: '#48BB78',
      strokeDasharray: '5,5',
    });
    expect(getEdgeStyle('placed_in')).toMatchObject({
      stroke: '#718096',
      opacity: 0.4,
    });
  });

  it('computes blast radius through graph traversal', () => {
    const { nodeIds, edgeIds } = computeBlastRadius('a', [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'x', target: 'y' },
    ]);

    expect(Array.from(nodeIds).sort()).toEqual(['a', 'b', 'c']);
    expect(Array.from(edgeIds).sort()).toEqual(['e1', 'e2']);
  });

  it('extracts network group keys from metadata', () => {
    expect(
      getNetworkGroup(
        node({
          metadata: { vpcId: 'vpc-0abc1234' },
        }),
      ),
    ).toMatchObject({ key: 'vpc:vpc-0abc1234' });

    expect(
      getNetworkGroup(
        node({
          metadata: { subnetId: 'subnet-0abc1234' },
        }),
      ),
    ).toMatchObject({ key: 'subnet:subnet-0abc1234' });
  });
});


import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';

import { applyHierarchicalGrouping, augmentEdgesForGrouping, extractGroupPath } from './graph-grouping';

function flowNode(partial: Partial<Node>): Node {
  return {
    id: partial.id || 'n1',
    type: partial.type || 'infraNode',
    position: partial.position || { x: 0, y: 0 },
    data: partial.data || {},
    style: partial.style,
    ...partial,
  } as Node;
}

describe('graph-grouping', () => {
  it('extracts a hierarchical region-vpc-subnet path from metadata', () => {
    const path = extractGroupPath(
      flowNode({
        id: 'app-1',
        data: {
          label: 'payment-api',
          nodeType: 'APPLICATION',
          region: 'eu-west-1',
          metadata: { vpcId: 'vpc-prod', subnetId: 'subnet-a', cidrBlock: '10.0.1.0/24' },
        },
      }),
    );

    expect(path.map((part) => part.kind)).toEqual(['region', 'vpc', 'subnet']);
    expect(path.at(-1)?.label).toContain('10.0.1.0/24');
  });

  it('adds synthetic affinity edges to keep grouped nodes close in layout', () => {
    const nodes = [
      flowNode({ id: 'a', data: { label: 'a', nodeType: 'APPLICATION', region: 'eu-west-1', metadata: { vpcId: 'vpc-1' } } }),
      flowNode({ id: 'b', data: { label: 'b', nodeType: 'APPLICATION', region: 'eu-west-1', metadata: { vpcId: 'vpc-1' } } }),
    ];

    const edges = augmentEdgesForGrouping(nodes, [] as Edge[]);
    expect(edges.some((edge) => String(edge.id).startsWith('layout-affinity:'))).toBe(true);
  });

  it('creates nested group nodes and assigns leaf parentId to the deepest group', () => {
    const grouped = applyHierarchicalGrouping([
      flowNode({
        id: 'db',
        position: { x: 100, y: 100 },
        data: { label: 'db', nodeType: 'DATABASE', region: 'eu-west-1', metadata: { vpcId: 'vpc-1', subnetId: 'subnet-a' } },
        style: { width: 180, height: 60 },
      }),
      flowNode({
        id: 'api',
        position: { x: 360, y: 120 },
        data: { label: 'api', nodeType: 'APPLICATION', region: 'eu-west-1', metadata: { vpcId: 'vpc-1', subnetId: 'subnet-a' } },
        style: { width: 180, height: 60 },
      }),
    ]);

    const subnetGroup = grouped.find((node) => node.id === 'group:subnet:subnet-a');
    const vpcGroup = grouped.find((node) => node.id === 'group:vpc:vpc-1');
    const apiNode = grouped.find((node) => node.id === 'api');

    expect(subnetGroup?.parentId).toBe('group:vpc:vpc-1');
    expect(vpcGroup?.parentId).toBe('group:region:eu-west-1');
    expect(apiNode?.parentId).toBe('group:subnet:subnet-a');
  });
});

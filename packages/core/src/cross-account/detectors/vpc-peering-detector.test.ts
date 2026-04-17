import { describe, expect, it } from 'vitest';

import { VpcPeeringDetector } from './vpc-peering-detector.js';
import {
  addTestNode,
  createAccountResults,
  createTestGraph,
} from '../test-helpers.js';

describe('VpcPeeringDetector', () => {
  it('returns a bidirectional critical edge for an active cross-account peering in use', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addVpc(graph, '444455556666', 'vpc-b');
    addPeering(graph, {
      peeringConnectionId: 'pcx-1',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '444455556666',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'active',
      routeTableIds: ['rtb-1'],
    });

    const result = new VpcPeeringDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'vpc_peering',
      direction: 'bidirectional',
      drImpact: 'critical',
      completeness: 'complete',
      sourceAccountId: '111122223333',
      targetAccountId: '444455556666',
    });
  });

  it('returns an informational edge when the peering has no route-table usage', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addVpc(graph, '444455556666', 'vpc-b');
    addPeering(graph, {
      peeringConnectionId: 'pcx-2',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '444455556666',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'active',
    });

    const result = new VpcPeeringDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.drImpact).toBe('informational');
  });

  it('ignores intra-account peering connections', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addVpc(graph, '111122223333', 'vpc-b');
    addPeering(graph, {
      peeringConnectionId: 'pcx-3',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '111122223333',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'active',
    });

    const result = new VpcPeeringDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('ignores pending peering connections', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addVpc(graph, '444455556666', 'vpc-b');
    addPeering(graph, {
      peeringConnectionId: 'pcx-4',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '444455556666',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'pending-acceptance',
    });

    const result = new VpcPeeringDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toEqual([]);
  });

  it('returns a partial edge when the peer account was not merged into the graph', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addPeering(graph, {
      peeringConnectionId: 'pcx-5',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '444455556666',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'active',
    });

    const result = new VpcPeeringDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      completeness: 'partial',
      missingAccountId: '444455556666',
      targetArn: 'arn:aws:ec2:eu-west-1:444455556666:vpc/vpc-b',
    });
  });

  it('keeps distinct peerings separate even between the same two accounts', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addVpc(graph, '444455556666', 'vpc-b');
    addPeering(graph, {
      peeringConnectionId: 'pcx-6',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '444455556666',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'active',
    });
    addPeering(graph, {
      peeringConnectionId: 'pcx-7',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '444455556666',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'active',
    });

    const result = new VpcPeeringDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(2);
    expect(result.map((edge) => edge.metadata.kind === 'vpc_peering' && edge.metadata.peeringConnectionId)).toEqual([
      'pcx-6',
      'pcx-7',
    ]);
  });
});

function addVpc(graph: ReturnType<typeof createTestGraph>, accountId: string, vpcId: string): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${accountId}:vpc/${vpcId}`,
    accountId,
    name: vpcId,
    type: 'VPC',
    sourceType: 'VPC',
    metadata: { vpcId },
  });
}

function addPeering(
  graph: ReturnType<typeof createTestGraph>,
  metadata: {
    readonly peeringConnectionId: string;
    readonly requesterOwnerId: string;
    readonly accepterOwnerId: string;
    readonly requesterVpcId: string;
    readonly accepterVpcId: string;
    readonly status: string;
    readonly routeTableIds?: readonly string[];
  },
): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${metadata.requesterOwnerId}:vpc-peering-connection/${metadata.peeringConnectionId}`,
    accountId: metadata.requesterOwnerId,
    name: metadata.peeringConnectionId,
    sourceType: 'VPC_PEERING_CONNECTION',
    metadata: {
      ...metadata,
      ...(metadata.routeTableIds ? { routeTableIds: metadata.routeTableIds } : {}),
    },
  });
}

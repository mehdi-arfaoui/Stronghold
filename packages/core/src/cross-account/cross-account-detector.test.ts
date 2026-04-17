import { describe, expect, it } from 'vitest';

import {
  CrossAccountDetector,
  createEmptyCrossAccountDetectionResult,
} from './cross-account-detector.js';
import {
  addTestNode,
  createMultiAccountScanResult,
  createTestGraph,
} from './test-helpers.js';

describe('CrossAccountDetector', () => {
  it('combines edges from all enabled detectors and materializes complete ones into the graph', () => {
    const graph = createGraphWithAllDependencyKinds();
    const scanResult = createMultiAccountScanResult(graph, [
      '111122223333',
      '444455556666',
      '777788889999',
    ]);

    const result = new CrossAccountDetector().detect(graph, scanResult);

    expect(result.edges).toHaveLength(4);
    expect(result.summary.total).toBe(4);
    expect(result.summary.byKind.get('vpc_peering')).toBe(1);
    expect(result.summary.byKind.get('transit_gateway')).toBe(1);
    expect(result.summary.byKind.get('route53_shared_zone')).toBe(1);
    expect(result.summary.byKind.get('vpc_endpoint_shared')).toBe(1);
    expect(graph.size).toBe(4);

    const edgeAttrs = graph.getEdgeAttributes(graph.edges()[0] ?? '');
    expect(edgeAttrs.type).toBe('cross_account');
  });

  it('omits edges from disabled detectors', () => {
    const graph = createGraphWithAllDependencyKinds();
    const scanResult = createMultiAccountScanResult(graph, [
      '111122223333',
      '444455556666',
      '777788889999',
    ]);

    const result = new CrossAccountDetector({
      enabledKinds: ['vpc_peering', 'transit_gateway', 'route53_shared_zone'],
    }).detect(graph, scanResult);

    expect(result.edges).toHaveLength(3);
    expect(result.summary.byKind.get('vpc_endpoint_shared')).toBe(0);
    expect(result.edges.some((edge) => edge.kind === 'vpc_endpoint_shared')).toBe(false);
  });

  it('returns zeroed summary values for an empty graph', () => {
    const graph = createTestGraph();
    const scanResult = createMultiAccountScanResult(graph, []);

    const result = new CrossAccountDetector().detect(graph, scanResult);

    expect(result).toEqual(createEmptyCrossAccountDetectionResult());
  });

  it('counts complete, partial, and impact categories correctly', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addVpc(graph, '444455556666', 'vpc-b');
    addPeering(graph);
    addTransitAttachmentWithoutTarget(graph);
    addHostedZonePartial(graph);
    const scanResult = createMultiAccountScanResult(graph, ['111122223333', '444455556666']);

    const result = new CrossAccountDetector({
      enabledKinds: ['vpc_peering', 'transit_gateway', 'route53_shared_zone'],
    }).detect(graph, scanResult);

    expect(result.summary.total).toBe(3);
    expect(result.summary.complete).toBe(1);
    expect(result.summary.partial).toBe(2);
    expect(result.summary.critical).toBe(1);
    expect(result.summary.degraded).toBe(1);
    expect(result.summary.informational).toBe(1);
  });
});

function createGraphWithAllDependencyKinds() {
  const graph = createTestGraph();
  addVpc(graph, '111122223333', 'vpc-a');
  addVpc(graph, '444455556666', 'vpc-b');
  addTestNode(graph, {
    arn: 'arn:aws:ec2:eu-west-1:111122223333:vpc-peering-connection/pcx-1',
    accountId: '111122223333',
    sourceType: 'VPC_PEERING_CONNECTION',
    metadata: {
      peeringConnectionId: 'pcx-1',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '444455556666',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'active',
      routeTableIds: ['rtb-1'],
    },
  });
  addTestNode(graph, {
    arn: 'arn:aws:ec2:eu-west-1:444455556666:transit-gateway/tgw-1',
    accountId: '444455556666',
    sourceType: 'TRANSIT_GATEWAY',
    metadata: { tgwId: 'tgw-1' },
  });
  addTestNode(graph, {
    arn: 'arn:aws:ec2:eu-west-1:111122223333:transit-gateway-attachment/tgw-attach-1',
    accountId: '111122223333',
    sourceType: 'TRANSIT_GATEWAY_ATTACHMENT',
    metadata: {
      attachmentId: 'tgw-attach-1',
      tgwId: 'tgw-1',
      tgwOwnerId: '444455556666',
      attachmentType: 'vpc',
      routeTableId: 'tgw-rtb-1',
    },
  });
  addTestNode(graph, {
    arn: 'arn:aws:route53:::hostedzone/Z1',
    accountId: '111122223333',
    sourceType: 'ROUTE53_HOSTED_ZONE',
    metadata: {
      hostedZoneId: 'Z1',
      name: 'corp.internal',
      isPrivate: true,
      recordCount: 2,
      vpcAssociations: [
        {
          vpcId: 'vpc-b',
          vpcOwnerId: '444455556666',
          vpcRegion: 'eu-west-1',
          vpcAssociationId: 'assoc-1',
        },
      ],
    },
  });
  addTestNode(graph, {
    arn: 'arn:aws:ec2:eu-west-1:444455556666:vpc-endpoint-service/vpce-svc-data-db',
    accountId: '444455556666',
    sourceType: 'VPC_ENDPOINT_SERVICE',
    metadata: { serviceId: 'vpce-svc-data-db' },
  });
  addTestNode(graph, {
    arn: 'arn:aws:ec2:eu-west-1:111122223333:vpc-endpoint/vpce-1',
    accountId: '111122223333',
    sourceType: 'VPC_ENDPOINT',
    metadata: {
      endpointId: 'vpce-1',
      vpcId: 'vpc-a',
      endpointType: 'Interface',
      serviceOwnerId: '444455556666',
      serviceName: 'com.amazonaws.vpce.eu-west-1.vpce-svc-data-db.database',
    },
  });

  return graph;
}

function addVpc(graph: ReturnType<typeof createTestGraph>, accountId: string, vpcId: string): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${accountId}:vpc/${vpcId}`,
    accountId,
    type: 'VPC',
    sourceType: 'VPC',
    metadata: { vpcId },
  });
}

function addPeering(graph: ReturnType<typeof createTestGraph>): void {
  addTestNode(graph, {
    arn: 'arn:aws:ec2:eu-west-1:111122223333:vpc-peering-connection/pcx-summary',
    accountId: '111122223333',
    sourceType: 'VPC_PEERING_CONNECTION',
    metadata: {
      peeringConnectionId: 'pcx-summary',
      requesterOwnerId: '111122223333',
      accepterOwnerId: '444455556666',
      requesterVpcId: 'vpc-a',
      accepterVpcId: 'vpc-b',
      status: 'active',
      routeTableIds: ['rtb-summary'],
    },
  });
}

function addTransitAttachmentWithoutTarget(graph: ReturnType<typeof createTestGraph>): void {
  addTestNode(graph, {
    arn: 'arn:aws:ec2:eu-west-1:111122223333:transit-gateway-attachment/tgw-attach-summary',
    accountId: '111122223333',
    sourceType: 'TRANSIT_GATEWAY_ATTACHMENT',
    metadata: {
      attachmentId: 'tgw-attach-summary',
      tgwId: 'tgw-summary',
      tgwOwnerId: '999900001111',
      attachmentType: 'vpc',
    },
  });
}

function addHostedZonePartial(graph: ReturnType<typeof createTestGraph>): void {
  addTestNode(graph, {
    arn: 'arn:aws:route53:::hostedzone/ZSUMMARY',
    accountId: '111122223333',
    sourceType: 'ROUTE53_HOSTED_ZONE',
    metadata: {
      hostedZoneId: 'ZSUMMARY',
      name: 'summary.internal',
      isPrivate: true,
      recordCount: 1,
      vpcAssociations: [
        {
          vpcId: 'vpc-missing',
          vpcOwnerId: '888899990000',
          vpcRegion: 'eu-west-1',
          vpcAssociationId: 'assoc-summary',
        },
      ],
    },
  });
}

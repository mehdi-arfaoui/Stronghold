import { describe, expect, it } from 'vitest';

import { CrossAccountDetector } from '../cross-account-detector.js';
import { RamShareDetector } from './ram-share-detector.js';
import {
  addTestNode,
  createAccountResults,
  createMultiAccountScanResult,
  createTestGraph,
} from '../test-helpers.js';

describe('RamShareDetector', () => {
  it('creates an edge for an associated cross-account RAM share', () => {
    const graph = createTestGraph();
    addAccountRoot(graph, '444455556666');
    addSubnet(graph, '111122223333', 'subnet-shared');
    addRamShare(graph, '111122223333', 'share-1', {
      principals: [
        {
          principalAccountId: '444455556666',
          status: 'ASSOCIATED',
        },
      ],
      resources: [
        {
          resourceArn: 'arn:aws:ec2:eu-west-1:111122223333:subnet/subnet-shared',
          resourceType: 'subnet',
          status: 'ASSOCIATED',
        },
      ],
    });

    const result = new RamShareDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'ram_share',
      completeness: 'complete',
      drImpact: 'critical',
      sourceArn: 'arn:aws:iam::444455556666:root',
      targetArn: 'arn:aws:ec2:eu-west-1:111122223333:subnet/subnet-shared',
    });
  });

  it('ignores disassociated shares', () => {
    const graph = createTestGraph();
    addAccountRoot(graph, '444455556666');
    addSubnet(graph, '111122223333', 'subnet-old');
    addRamShare(graph, '111122223333', 'share-2', {
      principals: [
        {
          principalAccountId: '444455556666',
          status: 'DISASSOCIATED',
        },
      ],
      resources: [
        {
          resourceArn: 'arn:aws:ec2:eu-west-1:111122223333:subnet/subnet-old',
          resourceType: 'subnet',
          status: 'DISASSOCIATED',
        },
      ],
    });

    const result = new RamShareDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toEqual([]);
  });

  it('returns a partial edge when the recipient account is not part of the merged graph', () => {
    const graph = createTestGraph();
    addSubnet(graph, '111122223333', 'subnet-partial');
    addRamShare(graph, '111122223333', 'share-3', {
      principals: [
        {
          principalAccountId: '999900001111',
          status: 'ASSOCIATED',
        },
      ],
      resources: [
        {
          resourceArn: 'arn:aws:ec2:eu-west-1:111122223333:subnet/subnet-partial',
          resourceType: 'subnet',
          status: 'ASSOCIATED',
        },
      ],
    });

    const result = new RamShareDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      completeness: 'partial',
      missingAccountId: '999900001111',
      sourceArn: 'arn:aws:iam::999900001111:root',
    });
  });

  it('returns zero edges when RAM data is absent', () => {
    const graph = createTestGraph();

    const result = new RamShareDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('deduplicates TGW dependencies detected through both attachment and RAM share', () => {
    const graph = createTestGraph();
    addTransitGateway(graph, '444455556666', 'tgw-1');
    addTransitAttachment(graph, '111122223333', 'tgw-attach-1', 'tgw-1', '444455556666');
    addRamShare(graph, '444455556666', 'share-4', {
      principals: [
        {
          principalAccountId: '111122223333',
          status: 'ASSOCIATED',
        },
      ],
      resources: [
        {
          resourceArn: 'arn:aws:ec2:eu-west-1:444455556666:transit-gateway/tgw-1',
          resourceType: 'transit-gateway',
          status: 'ASSOCIATED',
        },
      ],
    });

    const scanResult = createMultiAccountScanResult(graph, [
      '111122223333',
      '444455556666',
    ]);
    const result = new CrossAccountDetector({
      enabledKinds: ['transit_gateway', 'ram_share'],
    }).detect(graph, scanResult);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      kind: 'transit_gateway',
      sourceArn: 'arn:aws:ec2:eu-west-1:111122223333:transit-gateway-attachment/tgw-attach-1',
      targetArn: 'arn:aws:ec2:eu-west-1:444455556666:transit-gateway/tgw-1',
    });
    expect(result.edges[0]?.metadata.detectedByKinds).toEqual([
      'transit_gateway',
      'ram_share',
    ]);
    expect(result.summary.byKind.get('transit_gateway')).toBe(1);
    expect(result.summary.byKind.get('ram_share')).toBe(0);
  });
});

function addAccountRoot(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
): void {
  addTestNode(graph, {
    arn: `arn:aws:iam::${accountId}:root`,
    accountId,
    name: `root-${accountId}`,
    sourceType: 'ACCOUNT_PRINCIPAL',
    metadata: {},
  });
}

function addSubnet(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  subnetId: string,
): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${accountId}:subnet/${subnetId}`,
    accountId,
    name: subnetId,
    type: 'SUBNET',
    sourceType: 'SUBNET',
    metadata: {
      subnetId,
    },
  });
}

function addTransitGateway(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  tgwId: string,
): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${accountId}:transit-gateway/${tgwId}`,
    accountId,
    name: tgwId,
    sourceType: 'TRANSIT_GATEWAY',
    metadata: { tgwId },
  });
}

function addTransitAttachment(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  attachmentId: string,
  tgwId: string,
  tgwOwnerId: string,
): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${accountId}:transit-gateway-attachment/${attachmentId}`,
    accountId,
    name: attachmentId,
    sourceType: 'TRANSIT_GATEWAY_ATTACHMENT',
    metadata: {
      attachmentId,
      tgwId,
      tgwOwnerId,
      attachmentType: 'vpc',
      routeTableId: 'tgw-rtb-1',
    },
  });
}

function addRamShare(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  shareId: string,
  input: {
    readonly principals: readonly Record<string, unknown>[];
    readonly resources: readonly Record<string, unknown>[];
  },
): void {
  addTestNode(graph, {
    arn: `arn:aws:ram:eu-west-1:${accountId}:resource-share/${shareId}`,
    accountId,
    name: shareId,
    sourceType: 'RAM_RESOURCE_SHARE',
    metadata: {
      resourceShareArn: `arn:aws:ram:eu-west-1:${accountId}:resource-share/${shareId}`,
      principals: input.principals,
      resources: input.resources,
      status: 'ASSOCIATED',
    },
  });
}

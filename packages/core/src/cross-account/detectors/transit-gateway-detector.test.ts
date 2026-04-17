import { describe, expect, it } from 'vitest';

import { TransitGatewayDetector } from './transit-gateway-detector.js';
import {
  addTestNode,
  createAccountResults,
  createTestGraph,
} from '../test-helpers.js';

describe('TransitGatewayDetector', () => {
  it('creates a unidirectional edge from the attachment to the shared TGW', () => {
    const graph = createTestGraph();
    addTransitGateway(graph, '444455556666', 'tgw-1');
    addAttachment(graph, {
      accountId: '111122223333',
      attachmentId: 'tgw-attach-1',
      tgwId: 'tgw-1',
      tgwOwnerId: '444455556666',
      attachmentType: 'vpc',
      routeTableId: 'tgw-rtb-1',
    });

    const result = new TransitGatewayDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'transit_gateway',
      direction: 'unidirectional',
      completeness: 'complete',
      sourceArn:
        'arn:aws:ec2:eu-west-1:111122223333:transit-gateway-attachment/tgw-attach-1',
      targetArn: 'arn:aws:ec2:eu-west-1:444455556666:transit-gateway/tgw-1',
    });
  });

  it('ignores intra-account TGW attachments', () => {
    const graph = createTestGraph();
    addTransitGateway(graph, '111122223333', 'tgw-1');
    addAttachment(graph, {
      accountId: '111122223333',
      attachmentId: 'tgw-attach-2',
      tgwId: 'tgw-1',
      tgwOwnerId: '111122223333',
      attachmentType: 'vpc',
      routeTableId: 'tgw-rtb-1',
    });

    const result = new TransitGatewayDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('returns one edge per cross-account attachment', () => {
    const graph = createTestGraph();
    addTransitGateway(graph, '444455556666', 'tgw-1');
    addAttachment(graph, {
      accountId: '111122223333',
      attachmentId: 'tgw-attach-3',
      tgwId: 'tgw-1',
      tgwOwnerId: '444455556666',
      attachmentType: 'vpc',
      routeTableId: 'tgw-rtb-1',
    });
    addAttachment(graph, {
      accountId: '777788889999',
      attachmentId: 'tgw-attach-4',
      tgwId: 'tgw-1',
      tgwOwnerId: '444455556666',
      attachmentType: 'vpc',
      routeTableId: 'tgw-rtb-1',
    });

    const result = new TransitGatewayDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666', '777788889999']),
    );

    expect(result).toHaveLength(2);
  });

  it('returns a partial edge when the TGW account is missing from the merged graph', () => {
    const graph = createTestGraph();
    addAttachment(graph, {
      accountId: '111122223333',
      attachmentId: 'tgw-attach-5',
      tgwId: 'tgw-1',
      tgwOwnerId: '444455556666',
      attachmentType: 'vpc',
      routeTableId: 'tgw-rtb-1',
    });

    const result = new TransitGatewayDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      completeness: 'partial',
      missingAccountId: '444455556666',
      targetArn: 'arn:aws:ec2:eu-west-1:444455556666:transit-gateway/tgw-1',
    });
  });

  it('downgrades the impact to informational when no route table is active', () => {
    const graph = createTestGraph();
    addTransitGateway(graph, '444455556666', 'tgw-1');
    addAttachment(graph, {
      accountId: '111122223333',
      attachmentId: 'tgw-attach-6',
      tgwId: 'tgw-1',
      tgwOwnerId: '444455556666',
      attachmentType: 'vpc',
    });

    const result = new TransitGatewayDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.drImpact).toBe('informational');
  });
});

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

function addAttachment(
  graph: ReturnType<typeof createTestGraph>,
  input: {
    readonly accountId: string;
    readonly attachmentId: string;
    readonly tgwId: string;
    readonly tgwOwnerId: string;
    readonly attachmentType: string;
    readonly routeTableId?: string;
  },
): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${input.accountId}:transit-gateway-attachment/${input.attachmentId}`,
    accountId: input.accountId,
    name: input.attachmentId,
    sourceType: 'TRANSIT_GATEWAY_ATTACHMENT',
    metadata: {
      attachmentId: input.attachmentId,
      tgwId: input.tgwId,
      tgwOwnerId: input.tgwOwnerId,
      attachmentType: input.attachmentType,
      ...(input.routeTableId ? { routeTableId: input.routeTableId } : {}),
    },
  });
}

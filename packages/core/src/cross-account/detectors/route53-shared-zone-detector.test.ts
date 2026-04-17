import { describe, expect, it } from 'vitest';

import { Route53SharedZoneDetector } from './route53-shared-zone-detector.js';
import {
  addTestNode,
  createAccountResults,
  createTestGraph,
} from '../test-helpers.js';

describe('Route53SharedZoneDetector', () => {
  it('creates a unidirectional edge from the VPC to the shared private hosted zone', () => {
    const graph = createTestGraph();
    addVpc(graph, '444455556666', 'vpc-b');
    addHostedZone(graph, {
      accountId: '111122223333',
      hostedZoneId: 'ZSHARED1',
      recordCount: 2,
      associations: [
        {
          vpcId: 'vpc-b',
          vpcOwnerId: '444455556666',
          vpcRegion: 'eu-west-1',
          vpcAssociationId: 'assoc-1',
        },
      ],
    });

    const result = new Route53SharedZoneDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'route53_shared_zone',
      direction: 'unidirectional',
      completeness: 'complete',
      sourceArn: 'arn:aws:ec2:eu-west-1:444455556666:vpc/vpc-b',
      targetArn: 'arn:aws:route53:::hostedzone/ZSHARED1',
    });
  });

  it('ignores private zones that are only associated within the same account', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addHostedZone(graph, {
      accountId: '111122223333',
      hostedZoneId: 'ZSHARED2',
      recordCount: 2,
      associations: [
        {
          vpcId: 'vpc-a',
          vpcOwnerId: '111122223333',
          vpcRegion: 'eu-west-1',
          vpcAssociationId: 'assoc-2',
        },
      ],
    });

    const result = new Route53SharedZoneDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('marks zones with more than ten records as critical', () => {
    const graph = createTestGraph();
    addVpc(graph, '444455556666', 'vpc-b');
    addHostedZone(graph, {
      accountId: '111122223333',
      hostedZoneId: 'ZSHARED3',
      recordCount: 11,
      associations: [
        {
          vpcId: 'vpc-b',
          vpcOwnerId: '444455556666',
          vpcRegion: 'eu-west-1',
          vpcAssociationId: 'assoc-3',
        },
      ],
    });

    const result = new Route53SharedZoneDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.drImpact).toBe('critical');
  });

  it('marks small private zones as degraded by default', () => {
    const graph = createTestGraph();
    addVpc(graph, '444455556666', 'vpc-b');
    addHostedZone(graph, {
      accountId: '111122223333',
      hostedZoneId: 'ZSHARED4',
      recordCount: 1,
      associations: [
        {
          vpcId: 'vpc-b',
          vpcOwnerId: '444455556666',
          vpcRegion: 'eu-west-1',
          vpcAssociationId: 'assoc-4',
        },
      ],
    });

    const result = new Route53SharedZoneDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.drImpact).toBe('degraded');
  });

  it('returns a partial edge when the associated VPC account is missing', () => {
    const graph = createTestGraph();
    addHostedZone(graph, {
      accountId: '111122223333',
      hostedZoneId: 'ZSHARED5',
      recordCount: 2,
      associations: [
        {
          vpcId: 'vpc-b',
          vpcOwnerId: '444455556666',
          vpcRegion: 'eu-west-1',
          vpcAssociationId: 'assoc-5',
        },
      ],
    });

    const result = new Route53SharedZoneDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      completeness: 'partial',
      missingAccountId: '444455556666',
      sourceArn: 'arn:aws:ec2:eu-west-1:444455556666:vpc/vpc-b',
    });
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

function addHostedZone(
  graph: ReturnType<typeof createTestGraph>,
  input: {
    readonly accountId: string;
    readonly hostedZoneId: string;
    readonly recordCount: number;
    readonly associations: readonly Record<string, unknown>[];
  },
): void {
  addTestNode(graph, {
    arn: `arn:aws:route53:::hostedzone/${input.hostedZoneId}`,
    accountId: input.accountId,
    name: `${input.hostedZoneId}.internal`,
    type: 'DNS',
    sourceType: 'ROUTE53_HOSTED_ZONE',
    metadata: {
      hostedZoneId: input.hostedZoneId,
      name: `${input.hostedZoneId}.internal`,
      isPrivate: true,
      recordCount: input.recordCount,
      vpcAssociations: input.associations,
    },
  });
}

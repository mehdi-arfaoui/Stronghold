import { describe, expect, it } from 'vitest';

import { VpcEndpointSharedDetector } from './vpc-endpoint-shared-detector.js';
import {
  addTestNode,
  createAccountResults,
  createTestGraph,
} from '../test-helpers.js';

describe('VpcEndpointSharedDetector', () => {
  it('marks data-oriented PrivateLink dependencies as critical', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addEndpointService(graph, '444455556666', 'vpce-svc-data-db');
    addEndpoint(graph, {
      accountId: '111122223333',
      endpointId: 'vpce-1',
      vpcId: 'vpc-a',
      endpointType: 'Interface',
      serviceOwnerId: '444455556666',
      serviceName: 'com.amazonaws.vpce.eu-west-1.vpce-svc-data-db.database',
    });

    const result = new VpcEndpointSharedDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'vpc_endpoint_shared',
      drImpact: 'critical',
      completeness: 'complete',
      sourceArn: 'arn:aws:ec2:eu-west-1:111122223333:vpc/vpc-a',
      targetArn:
        'arn:aws:ec2:eu-west-1:444455556666:vpc-endpoint-service/vpce-svc-data-db',
    });
  });

  it('marks observability-oriented PrivateLink dependencies as degraded', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addEndpointService(graph, '444455556666', 'vpce-svc-monitoring');
    addEndpoint(graph, {
      accountId: '111122223333',
      endpointId: 'vpce-2',
      vpcId: 'vpc-a',
      endpointType: 'Interface',
      serviceOwnerId: '444455556666',
      serviceName: 'com.amazonaws.vpce.eu-west-1.vpce-svc-monitoring.logging',
    });

    const result = new VpcEndpointSharedDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.drImpact).toBe('degraded');
  });

  it('ignores endpoints whose provider account matches the consumer account', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addEndpoint(graph, {
      accountId: '111122223333',
      endpointId: 'vpce-3',
      vpcId: 'vpc-a',
      endpointType: 'Interface',
      serviceOwnerId: '111122223333',
      serviceName: 'com.amazonaws.vpce.eu-west-1.vpce-svc-local',
    });

    const result = new VpcEndpointSharedDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('ignores gateway endpoints', () => {
    const graph = createTestGraph();
    addVpc(graph, '111122223333', 'vpc-a');
    addEndpoint(graph, {
      accountId: '111122223333',
      endpointId: 'vpce-4',
      vpcId: 'vpc-a',
      endpointType: 'Gateway',
      serviceOwnerId: '444455556666',
      serviceName: 'com.amazonaws.vpce.eu-west-1.vpce-svc-storage',
    });

    const result = new VpcEndpointSharedDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
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

function addEndpointService(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  serviceId: string,
): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${accountId}:vpc-endpoint-service/${serviceId}`,
    accountId,
    name: serviceId,
    sourceType: 'VPC_ENDPOINT_SERVICE',
    metadata: {
      serviceId,
      vpcEndpointServiceId: serviceId,
    },
  });
}

function addEndpoint(
  graph: ReturnType<typeof createTestGraph>,
  input: {
    readonly accountId: string;
    readonly endpointId: string;
    readonly vpcId: string;
    readonly endpointType: string;
    readonly serviceOwnerId: string;
    readonly serviceName: string;
  },
): void {
  addTestNode(graph, {
    arn: `arn:aws:ec2:eu-west-1:${input.accountId}:vpc-endpoint/${input.endpointId}`,
    accountId: input.accountId,
    name: input.endpointId,
    sourceType: 'VPC_ENDPOINT',
    metadata: {
      endpointId: input.endpointId,
      vpcId: input.vpcId,
      endpointType: input.endpointType,
      serviceOwnerId: input.serviceOwnerId,
      serviceName: input.serviceName,
    },
  });
}

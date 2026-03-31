import { describe, expect, it } from 'vitest';
import { EdgeType, NodeType, type InfraNodeAttrs } from '../types/index.js';
import { inferDependencies } from './dependency-inference-engine.js';

function makeNode(
  overrides: Partial<InfraNodeAttrs> & Pick<InfraNodeAttrs, 'id' | 'name' | 'type'>,
): InfraNodeAttrs {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    provider: 'aws',
    region: 'eu-west-1',
    tags: {},
    metadata: {},
    ...overrides,
  };
}

describe('inferDependencies', () => {
  it('infers a network access edge from an EC2 instance to an RDS instance through security groups', () => {
    const edges = inferDependencies(
      [
        makeNode({
          id: 'ec2-app',
          name: 'ec2-app',
          type: NodeType.VM,
          metadata: {
            sourceType: 'ec2_instance',
            securityGroups: ['sg-app'],
          },
        }),
        makeNode({
          id: 'orders-db',
          name: 'orders-db',
          type: NodeType.DATABASE,
          metadata: {
            sourceType: 'aws_rds_instance',
            securityGroups: ['sg-db'],
          },
        }),
        makeNode({
          id: 'sg-db',
          name: 'sg-db',
          type: NodeType.FIREWALL,
          metadata: {
            sourceType: 'security_group',
            inboundRules: [
              {
                sources: ['sg-app'],
                protocol: 'tcp',
                fromPort: 5432,
                toPort: 5432,
              },
            ],
          },
        }),
      ],
      [],
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'ec2-app',
          target: 'orders-db',
          type: EdgeType.NETWORK_ACCESS,
          inferenceMethod: 'security_group_chain',
        }),
      ]),
    );
  });

  it('infers event source mappings from SQS queues to Lambda functions', () => {
    const queueArn = 'arn:aws:sqs:eu-west-1:123456789012:jobs';
    const edges = inferDependencies(
      [
        makeNode({
          id: queueArn,
          name: 'jobs',
          type: NodeType.MESSAGE_QUEUE,
          metadata: {
            sourceType: 'sqs_queue',
            queueArn,
            queueName: 'jobs',
          },
        }),
        makeNode({
          id: 'arn:aws:lambda:eu-west-1:123456789012:function:worker',
          name: 'worker',
          type: NodeType.SERVERLESS,
          metadata: {
            sourceType: 'lambda',
            eventSourceMappings: [{ eventSourceArn: queueArn, enabled: true }],
          },
        }),
      ],
      [],
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: queueArn,
          target: 'arn:aws:lambda:eu-west-1:123456789012:function:worker',
          type: EdgeType.TRIGGERS,
          inferenceMethod: 'event_source_mapping',
        }),
      ]),
    );
  });

  it('infers resource usage from Lambda environment variables', () => {
    const queueUrl = 'https://sqs.eu-west-1.amazonaws.com/123456789012/jobs';
    const edges = inferDependencies(
      [
        makeNode({
          id: 'arn:aws:lambda:eu-west-1:123456789012:function:worker',
          name: 'worker',
          type: NodeType.SERVERLESS,
          metadata: {
            sourceType: 'lambda',
            environmentVariables: {
              JOB_QUEUE_URL: queueUrl,
            },
          },
        }),
        makeNode({
          id: 'arn:aws:sqs:eu-west-1:123456789012:jobs',
          name: 'jobs',
          type: NodeType.MESSAGE_QUEUE,
          metadata: {
            sourceType: 'sqs_queue',
            queueUrl,
            queueName: 'jobs',
          },
        }),
      ],
      [],
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'arn:aws:lambda:eu-west-1:123456789012:function:worker',
          target: 'arn:aws:sqs:eu-west-1:123456789012:jobs',
          type: EdgeType.USES,
          inferenceMethod: 'environment_reference',
        }),
      ]),
    );
  });

  it('returns no inferred edges for unrelated infrastructure-only nodes', () => {
    const edges = inferDependencies(
      [
        makeNode({
          id: 'sg-123',
          name: 'sg-123',
          type: NodeType.FIREWALL,
          metadata: { sourceType: 'security_group' },
        }),
        makeNode({
          id: 'subnet-123',
          name: 'subnet-123',
          type: NodeType.SUBNET,
          metadata: { sourceType: 'subnet' },
        }),
      ],
      [],
    );

    expect(edges).toEqual([]);
  });
});

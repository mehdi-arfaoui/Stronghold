import { describe, expect, it } from 'vitest';
import {
  createResource as createDiscoveredResource,
  type DiscoveredResource,
} from '../../types/discovery.js';
import { EdgeType, type InfraNodeAttrs } from '../../types/infrastructure.js';
import { transformToScanResult } from './graph-bridge.js';

const TEST_ACCOUNT = {
  accountId: '123456789012',
  partition: 'aws',
} as const;

function createResource(
  overrides: Partial<DiscoveredResource> & {
    readonly externalId: string;
    readonly type: string;
  },
): DiscoveredResource {
  const arn = overrides.externalId.startsWith('arn:')
    ? overrides.externalId
    : toTestArn(overrides.type, overrides.externalId);

  return createDiscoveredResource({
    source: 'aws',
    arn,
    name: overrides.name ?? overrides.externalId,
    kind: overrides.kind ?? 'infra',
    type: overrides.type,
    metadata: overrides.metadata ?? {},
    tags: overrides.tags ?? {},
    ip: overrides.ip ?? null,
    hostname: overrides.hostname ?? null,
    openPorts: overrides.openPorts ?? null,
    ...(arn.includes(':::') ? { account: TEST_ACCOUNT } : {}),
  });
}

function findEdge(
  result: ReturnType<typeof transformToScanResult>,
  source: string,
  target: string,
  type: string,
) {
  const sourceId = findNodeId(result, source);
  const targetId = findNodeId(result, target);
  return result.edges.find(
    (edge) => edge.source === sourceId && edge.target === targetId && edge.type === type,
  );
}

function findNode(result: ReturnType<typeof transformToScanResult>, nodeId: string): InfraNodeAttrs {
  const resolvedId = findNodeId(result, nodeId);
  const node = result.nodes.find((entry) => entry.id === resolvedId);
  expect(node).toBeDefined();
  return node!;
}

function findNodeId(result: ReturnType<typeof transformToScanResult>, value: string): string {
  const exact = result.nodes.find((entry) => entry.id === value);
  if (exact) return exact.id;

  const byResourceId = result.nodes.find((entry) => entry.resourceId === value);
  if (byResourceId) return byResourceId.id;

  const byMetadata = result.nodes.find(
    (entry) =>
      entry.metadata.dbIdentifier === value ||
      entry.metadata.dbClusterIdentifier === value ||
      entry.metadata.dbInstanceIdentifier === value ||
      entry.metadata.fileSystemId === value ||
      entry.metadata.mountTargetId === value ||
      entry.metadata.hostedZoneId === value,
  );
  if (byMetadata) return byMetadata.id;

  if (value.startsWith('route53-record:')) {
    const [, hostedZoneId = '', recordName = '', recordType = '', identifier = ''] = value.split(':');
    const route53Record = result.nodes.find(
      (entry) =>
        entry.metadata.hostedZoneId === hostedZoneId &&
        typeof entry.resourceId === 'string' &&
        entry.resourceId.endsWith(`/${recordName}/${recordType}/${identifier}`),
    );
    if (route53Record) return route53Record.id;
  }

  return value;
}

function toTestArn(type: string, id: string): string {
  switch (type) {
    case 'RDS':
      return `arn:aws:rds:eu-west-1:${TEST_ACCOUNT.accountId}:db:${id}`;
    case 'AURORA_CLUSTER':
      return `arn:aws:rds:eu-west-1:${TEST_ACCOUNT.accountId}:cluster:${id}`;
    case 'AURORA_INSTANCE':
      return `arn:aws:rds:eu-west-1:${TEST_ACCOUNT.accountId}:db:${id}`;
    case 'EFS_FILESYSTEM':
      return `arn:aws:elasticfilesystem:eu-west-1:${TEST_ACCOUNT.accountId}:file-system/${id}`;
    case 'EFS_MOUNT_TARGET':
      return `arn:aws:elasticfilesystem:eu-west-1:${TEST_ACCOUNT.accountId}:mount-target/${id}`;
    case 'EC2':
      return `arn:aws:ec2:eu-west-1:${TEST_ACCOUNT.accountId}:instance/${id}`;
    case 'SECURITY_GROUP':
      return `arn:aws:ec2:eu-west-1:${TEST_ACCOUNT.accountId}:security-group/${id}`;
    case 'ROUTE53_HOSTED_ZONE':
      return `arn:aws:route53:::hostedzone/${id}`;
    case 'ROUTE53_RECORD':
      return `arn:aws:route53:::recordset/Z123ZONE/api.example.com/A/simple`;
    case 'BACKUP_PLAN':
      return `arn:aws:backup:eu-west-1:${TEST_ACCOUNT.accountId}:backup-plan:${id}`;
    case 'BACKUP_VAULT':
      return `arn:aws:backup:eu-west-1:${TEST_ACCOUNT.accountId}:backup-vault:${id}`;
    default:
      return `arn:aws:ec2:eu-west-1:${TEST_ACCOUNT.accountId}:instance/${id}`;
  }
}

describe('transformToScanResult', () => {
  it('creates a replication edge from an RDS primary to its scanned read replica', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'db-primary',
          type: 'RDS',
          metadata: {
            region: 'eu-west-1',
            dbIdentifier: 'db-primary',
            readReplicaDBInstanceIdentifiers: ['db-replica'],
          },
        }),
        createResource({
          externalId: 'db-replica',
          type: 'RDS',
          metadata: {
            region: 'us-east-1',
            dbIdentifier: 'db-replica',
            readReplicaSourceDBInstanceIdentifier: 'db-primary',
          },
        }),
      ],
      [],
      'aws',
    );

    expect(findEdge(result, 'db-primary', 'db-replica', EdgeType.REPLICATES_TO)).toBeDefined();
  });

  it('ignores missing read replica references without crashing', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'db-primary',
          type: 'RDS',
          metadata: {
            region: 'eu-west-1',
            dbIdentifier: 'db-primary',
            readReplicaDBInstanceIdentifiers: ['db-replica-missing'],
          },
        }),
      ],
      [],
      'aws',
    );

    expect(result.edges.some((edge) => edge.type === EdgeType.REPLICATES_TO)).toBe(false);
  });

  it('creates contains edges from an Aurora cluster to its member instances', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'aurora-orders',
          type: 'AURORA_CLUSTER',
          metadata: {
            region: 'eu-west-1',
            memberInstanceIds: ['aurora-orders-1', 'aurora-orders-2'],
          },
        }),
        createResource({
          externalId: 'aurora-orders-1',
          type: 'AURORA_INSTANCE',
          metadata: { region: 'eu-west-1', dbInstanceIdentifier: 'aurora-orders-1' },
        }),
        createResource({
          externalId: 'aurora-orders-2',
          type: 'AURORA_INSTANCE',
          metadata: { region: 'eu-west-1', dbInstanceIdentifier: 'aurora-orders-2' },
        }),
      ],
      [],
      'aws',
    );

    expect(findEdge(result, 'aurora-orders', 'aurora-orders-1', EdgeType.CONTAINS)).toBeDefined();
    expect(findEdge(result, 'aurora-orders', 'aurora-orders-2', EdgeType.CONTAINS)).toBeDefined();
  });

  it('creates contains edges from an EFS filesystem to its mount targets', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'fs-123',
          type: 'EFS_FILESYSTEM',
          metadata: { region: 'eu-west-1', mountTargetIds: ['mt-1', 'mt-2'] },
        }),
        createResource({
          externalId: 'mt-1',
          type: 'EFS_MOUNT_TARGET',
          metadata: { region: 'eu-west-1', mountTargetId: 'mt-1' },
        }),
        createResource({
          externalId: 'mt-2',
          type: 'EFS_MOUNT_TARGET',
          metadata: { region: 'eu-west-1', mountTargetId: 'mt-2' },
        }),
      ],
      [],
      'aws',
    );

    expect(findEdge(result, 'fs-123', 'mt-1', EdgeType.CONTAINS)).toBeDefined();
    expect(findEdge(result, 'fs-123', 'mt-2', EdgeType.CONTAINS)).toBeDefined();
  });

  it('copies region and availability zone into node metadata', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'i-123',
          type: 'EC2',
          metadata: {
            zone: 'eu-west-1a',
          },
        }),
      ],
      [],
      'aws',
    );
    const node = findNode(result, 'i-123');

    expect(node.region).toBe('eu-west-1');
    expect(node.availabilityZone).toBe('eu-west-1a');
    expect(node.metadata.region).toBe('eu-west-1');
    expect(node.metadata.availabilityZone).toBe('eu-west-1a');
  });

  it('accepts object tags from scanners and preserves the Name tag for display', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'arn:aws:rds:eu-west-1:123456789012:db:orders-db',
          type: 'RDS',
          name: 'orders-db',
          tags: {
            service: 'orders',
            Name: 'orders-primary',
          },
          metadata: {
            region: 'eu-west-1',
            dbIdentifier: 'orders-db',
          },
        }),
      ],
      [],
      'aws',
    );
    const node = findNode(result, 'arn:aws:rds:eu-west-1:123456789012:db:orders-db');

    expect(node.name).toBe('orders-primary');
    expect(node.tags).toEqual({
      service: 'orders',
      Name: 'orders-primary',
    });
  });

  it('creates secured_by edges between compute nodes and their security groups', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'i-123',
          type: 'EC2',
          metadata: {
            region: 'eu-west-1',
            securityGroups: ['sg-123'],
          },
        }),
        createResource({
          externalId: 'sg-123',
          type: 'SECURITY_GROUP',
          metadata: { region: 'eu-west-1' },
        }),
      ],
      [],
      'aws',
    );

    expect(findEdge(result, 'i-123', 'sg-123', EdgeType.SECURED_BY)).toBeDefined();
  });

  it('links Route53 records to their hosted zone and alias targets', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'Z123ZONE',
          type: 'ROUTE53_HOSTED_ZONE',
          metadata: {
            region: 'global',
            hostedZoneId: 'Z123ZONE',
          },
        }),
        createResource({
          externalId: 'route53-record:Z123ZONE:api.example.com:A:simple',
          type: 'ROUTE53_RECORD',
          metadata: {
            region: 'global',
            hostedZoneId: 'Z123ZONE',
            aliasTargetDnsName: 'dualstack.orders-alb.eu-west-1.elb.amazonaws.com.',
          },
        }),
        createResource({
          externalId:
            'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/orders-alb/123456',
          type: 'ELB',
          metadata: {
            region: 'eu-west-1',
            dnsName: 'orders-alb.eu-west-1.elb.amazonaws.com',
          },
        }),
      ],
      [],
      'aws',
    );

    expect(
      findEdge(
        result,
        'Z123ZONE',
        'route53-record:Z123ZONE:api.example.com:A:simple',
        EdgeType.CONTAINS,
      ),
    ).toBeDefined();
    expect(
      findEdge(
        result,
        'route53-record:Z123ZONE:api.example.com:A:simple',
        'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/orders-alb/123456',
        EdgeType.ROUTES_TO,
      ),
    ).toBeDefined();
  });

  it('links backup plans to their protected resources', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'backup-plan-1',
          type: 'BACKUP_PLAN',
          metadata: {
            region: 'eu-west-1',
            protectedResources: [
              {
                resourceArn: 'arn:aws:rds:eu-west-1:123456789012:db:orders-db',
              },
            ],
          },
        }),
        createResource({
          externalId: 'arn:aws:rds:eu-west-1:123456789012:db:orders-db',
          type: 'RDS',
          metadata: {
            region: 'eu-west-1',
            dbArn: 'arn:aws:rds:eu-west-1:123456789012:db:orders-db',
            dbIdentifier: 'orders-db',
          },
        }),
      ],
      [],
      'aws',
    );

    expect(
      findEdge(
        result,
        'backup-plan-1',
        'arn:aws:rds:eu-west-1:123456789012:db:orders-db',
        EdgeType.BACKS_UP_TO,
      ),
    ).toBeDefined();
  });

  it('links backup plans to their target vaults', () => {
    const result = transformToScanResult(
      [
        createResource({
          externalId: 'backup-plan-1',
          type: 'BACKUP_PLAN',
          metadata: {
            region: 'eu-west-1',
            rules: [{ targetVault: 'vault-main' }],
          },
        }),
        createResource({
          externalId: 'vault-1',
          type: 'BACKUP_VAULT',
          metadata: {
            region: 'eu-west-1',
            backupVaultName: 'vault-main',
          },
        }),
      ],
      [],
      'aws',
    );

    expect(findEdge(result, 'backup-plan-1', 'vault-1', EdgeType.BACKS_UP_TO)).toBeDefined();
  });

  it('links Lambda event sources, DLQs, and async destinations', () => {
    const lambdaArn = 'arn:aws:lambda:eu-west-1:123456789012:function:worker';
    const queueArn = 'arn:aws:sqs:eu-west-1:123456789012:jobs';
    const dlqArn = 'arn:aws:sqs:eu-west-1:123456789012:worker-dlq';
    const topicArn = 'arn:aws:sns:eu-west-1:123456789012:worker-success';
    const result = transformToScanResult(
      [
        createResource({
          externalId: lambdaArn,
          type: 'LAMBDA',
          metadata: {
            region: 'eu-west-1',
            functionArn: lambdaArn,
            functionName: 'worker',
            deadLetterConfig: { targetArn: dlqArn },
            eventSourceMappings: [
              {
                uuid: 'esm-sqs',
                eventSourceArn: queueArn,
                state: 'Enabled',
              },
            ],
            asyncInvokeConfig: {
              maximumRetryAttempts: 2,
              maximumEventAgeInSeconds: 21_600,
              destinationConfig: {
                onSuccess: { destination: topicArn },
                onFailure: { destination: dlqArn },
              },
            },
          },
        }),
        createResource({
          externalId: queueArn,
          type: 'SQS_QUEUE',
          metadata: { region: 'eu-west-1', queueArn, queueName: 'jobs' },
        }),
        createResource({
          externalId: dlqArn,
          type: 'SQS_QUEUE',
          metadata: { region: 'eu-west-1', queueArn: dlqArn, queueName: 'worker-dlq' },
        }),
        createResource({
          externalId: topicArn,
          type: 'SNS_TOPIC',
          metadata: { region: 'eu-west-1', topicArn, topicName: 'worker-success' },
        }),
      ],
      [],
      'aws',
    );

    expect(findEdge(result, queueArn, lambdaArn, EdgeType.TRIGGERS)).toBeDefined();
    expect(findEdge(result, lambdaArn, dlqArn, EdgeType.DEAD_LETTER)).toBeDefined();
    expect(findEdge(result, lambdaArn, topicArn, EdgeType.PUBLISHES_TO_APPLICATIVE)).toBeDefined();
  });

  it('normalizes DynamoDB stream event sources to their table dependency', () => {
    const lambdaArn = 'arn:aws:lambda:eu-west-1:123456789012:function:stream-worker';
    const tableArn = 'arn:aws:dynamodb:eu-west-1:123456789012:table/orders';
    const streamArn = `${tableArn}/stream/2026-04-01T00:00:00.000`;
    const result = transformToScanResult(
      [
        createResource({
          externalId: lambdaArn,
          type: 'LAMBDA',
          metadata: {
            region: 'eu-west-1',
            functionArn: lambdaArn,
            functionName: 'stream-worker',
            eventSourceMappings: [
              {
                uuid: 'esm-ddb',
                eventSourceArn: streamArn,
                state: 'Enabled',
              },
            ],
          },
        }),
        createResource({
          externalId: tableArn,
          type: 'DYNAMODB',
          metadata: { region: 'eu-west-1', tableArn, tableName: 'orders' },
        }),
      ],
      [],
      'aws',
    );

    expect(findEdge(result, tableArn, lambdaArn, EdgeType.TRIGGERS)).toBeDefined();
  });
});

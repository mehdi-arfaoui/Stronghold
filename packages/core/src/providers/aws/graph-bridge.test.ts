import { describe, expect, it } from 'vitest';
import type { DiscoveredResource } from '../../types/discovery.js';
import { EdgeType, type InfraNodeAttrs } from '../../types/infrastructure.js';
import { transformToScanResult } from './graph-bridge.js';

function createResource(
  overrides: Partial<DiscoveredResource> &
    Pick<DiscoveredResource, 'externalId' | 'type'>,
): DiscoveredResource {
  return {
    source: 'aws',
    externalId: overrides.externalId,
    name: overrides.name ?? overrides.externalId,
    kind: overrides.kind ?? 'infra',
    type: overrides.type,
    metadata: overrides.metadata ?? {},
    tags: overrides.tags ?? {},
    ip: overrides.ip ?? null,
    hostname: overrides.hostname ?? null,
    openPorts: overrides.openPorts ?? null,
    ...overrides,
  };
}

function findEdge(
  result: ReturnType<typeof transformToScanResult>,
  source: string,
  target: string,
  type: string,
) {
  return result.edges.find(
    (edge) => edge.source === source && edge.target === target && edge.type === type,
  );
}

function findNode(result: ReturnType<typeof transformToScanResult>, nodeId: string): InfraNodeAttrs {
  const node = result.nodes.find((entry) => entry.id === nodeId);
  expect(node).toBeDefined();
  return node!;
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
});

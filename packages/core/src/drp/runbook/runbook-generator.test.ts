import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import type { DRPComponent, DRPlan } from '../drp-types.js';
import { NodeType, type InfraNodeAttrs } from '../../types/infrastructure.js';
import { generateRunbook } from './runbook-generator.js';
import { serializeRunbook } from './runbook-serializer.js';
import type { ComponentRunbook, DRPRunbook } from './runbook-types.js';

interface TestNodeOptions {
  readonly id: string;
  readonly name?: string;
  readonly type: NodeType;
  readonly sourceType: string;
  readonly region?: string;
  readonly metadata?: Record<string, unknown>;
}

function createNode(options: TestNodeOptions): InfraNodeAttrs {
  return {
    id: options.id,
    name: options.name ?? options.id,
    type: options.type,
    provider: 'aws',
    region: options.region ?? 'eu-west-1',
    tags: {},
    metadata: {
      sourceType: options.sourceType,
      region: options.region ?? 'eu-west-1',
      ...(options.metadata ?? {}),
    },
  };
}

function createPlan(
  components: readonly DRPComponent[],
  recoveryOrder?: readonly string[],
): DRPlan {
  return {
    id: 'drp-runbook-test',
    version: '1.0.0',
    generated: '2026-03-28T00:00:00.000Z',
    infrastructureHash: 'hash',
    provider: 'aws',
    regions: ['eu-west-1'],
    services: [
      {
        name: 'orders',
        criticality: 'critical',
        rtoTarget: '15m',
        rpoTarget: '5m',
        components,
        validationTests: [],
        estimatedRTO: '15m',
        estimatedRPO: '5m',
        recoveryOrder: recoveryOrder ?? components.map((component) => component.resourceId),
      },
    ],
    metadata: {
      totalResources: components.length,
      coveredResources: components.length,
      uncoveredResources: [],
      worstCaseRTO: '15m',
      averageRPO: '5m',
      stale: false,
    },
  };
}

function createComponent(
  node: InfraNodeAttrs,
  recoveryStrategy: DRPComponent['recoveryStrategy'],
  resourceType = node.type,
): DRPComponent {
  return {
    resourceId: node.id,
    resourceType,
    name: node.name,
    region: node.region ?? 'eu-west-1',
    recoveryStrategy,
    recoverySteps: [],
    estimatedRTO: '15m',
    estimatedRPO: '5m',
    dependencies: [],
    risks: [],
  };
}

function singleRunbook(
  node: InfraNodeAttrs,
  recoveryStrategy: DRPComponent['recoveryStrategy'],
  resourceType = node.type,
): ComponentRunbook {
  const plan = createPlan([createComponent(node, recoveryStrategy, resourceType)]);
  const runbook = generateRunbook(plan, [node]);
  return runbook.componentRunbooks[0]!;
}

function createSampleRunbook(): DRPRunbook {
  const nodes = [
    createNode({
      id: 'prod-db',
      type: NodeType.DATABASE,
      sourceType: 'RDS',
      metadata: {
        dbIdentifier: 'prod-db',
        dbInstanceClass: 'db.t3.large',
        dbSubnetGroupName: 'prod-db-subnets',
        securityGroups: ['sg-db'],
        multiAZ: true,
      },
    }),
    createNode({
      id: 'orders-bucket',
      type: NodeType.OBJECT_STORAGE,
      sourceType: 'S3_BUCKET',
      metadata: { bucketName: 'orders-bucket', versioningStatus: 'Enabled' },
    }),
    createNode({
      id: 'record-primary',
      name: 'app.example.com',
      type: NodeType.DNS,
      sourceType: 'ROUTE53_RECORD',
      region: 'global',
      metadata: {
        hostedZoneId: 'Z123ZONE',
        name: 'app.example.com',
        type: 'A',
        healthCheckId: 'hc-123',
      },
    }),
  ];
  const components = [
    createComponent(nodes[0]!, 'failover', 'rds'),
    createComponent(nodes[1]!, 'restore_from_backup', 's3'),
    createComponent(nodes[2]!, 'dns_failover', 'route53-record'),
  ];

  return generateRunbook(createPlan(components, ['record-primary', 'prod-db', 'orders-bucket']), nodes);
}

function allCommandStrings(runbook: ComponentRunbook): readonly string[] {
  return runbook.steps
    .map((step) => ('command' in step.command ? step.command.command : null))
    .filter((value): value is string => Boolean(value));
}

function assertReadOnly(command: string): void {
  expect(command).not.toMatch(/\b(modify|create|delete|put|update|reboot|terminate)\b/i);
}

describe('generateRunbook strategies', () => {
  it('RDS hot_standby contains reboot-db-instance --force-failover', () => {
    const runbook = singleRunbook(
      createNode({
        id: 'prod-db',
        type: NodeType.DATABASE,
        sourceType: 'RDS',
        metadata: { dbIdentifier: 'prod-db', multiAZ: true },
      }),
      'failover',
      'rds',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('reboot-db-instance --db-instance-identifier prod-db --force-failover');
  });

  it('RDS hot_standby requires approval on the failover step', () => {
    const runbook = singleRunbook(
      createNode({ id: 'prod-db', type: NodeType.DATABASE, sourceType: 'RDS', metadata: { dbIdentifier: 'prod-db', multiAZ: true } }),
      'failover',
      'rds',
    );

    expect(runbook.steps[0]?.requiresApproval).toBe(true);
  });

  it('RDS hot_standby warns that force-failover is not a simple reboot', () => {
    const runbook = singleRunbook(
      createNode({ id: 'prod-db', type: NodeType.DATABASE, sourceType: 'RDS', metadata: { dbIdentifier: 'prod-db', multiAZ: true } }),
      'failover',
      'rds',
    );

    expect(runbook.steps[0]?.notes.join(' ')).toContain('NOT a simple reboot');
  });

  it('RDS hot_standby includes a rollback re-failover command', () => {
    const runbook = singleRunbook(
      createNode({ id: 'prod-db', type: NodeType.DATABASE, sourceType: 'RDS', metadata: { dbIdentifier: 'prod-db', multiAZ: true } }),
      'failover',
      'rds',
    );

    expect(runbook.rollback.steps[0]?.command.type).toBe('aws_cli');
    expect((runbook.rollback.steps[0]?.command as { readonly command: string }).command).toContain('reboot-db-instance');
  });

  it('RDS backup_restore with PITR uses restore-db-instance-to-point-in-time', () => {
    const runbook = singleRunbook(
      createNode({
        id: 'prod-db',
        type: NodeType.DATABASE,
        sourceType: 'RDS',
        metadata: { dbIdentifier: 'prod-db', latestRestorableTime: '2026-03-28T00:00:00.000Z', dbInstanceClass: 'db.t3.large' },
      }),
      'restore_from_backup',
      'rds',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('restore-db-instance-to-point-in-time');
  });

  it('RDS backup_restore without PITR uses restore-db-instance-from-db-snapshot', () => {
    const runbook = singleRunbook(
      createNode({ id: 'prod-db', type: NodeType.DATABASE, sourceType: 'RDS', metadata: { dbIdentifier: 'prod-db', dbInstanceClass: 'db.t3.large' } }),
      'restore_from_backup',
      'rds',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('restore-db-instance-from-db-snapshot');
  });

  it('RDS backup_restore includes an aws_wait step after restore', () => {
    const runbook = singleRunbook(
      createNode({ id: 'prod-db', type: NodeType.DATABASE, sourceType: 'RDS', metadata: { dbIdentifier: 'prod-db', dbInstanceClass: 'db.t3.large' } }),
      'restore_from_backup',
      'rds',
    );

    expect(runbook.steps.some((step) => step.command.type === 'aws_wait')).toBe(true);
  });

  it('RDS backup_restore uses a collision-safe target identifier with a suffix', () => {
    const runbook = singleRunbook(
      createNode({ id: 'prod-db', type: NodeType.DATABASE, sourceType: 'RDS', metadata: { dbIdentifier: 'prod-db', latestRestorableTime: '2026-03-28T00:00:00.000Z', dbInstanceClass: 'db.t3.large' } }),
      'restore_from_backup',
      'rds',
    );

    expect(allCommandStrings(runbook).join(' ')).toMatch(/prod-db-dr-\d{14}/);
  });

  it('RDS backup_restore rollback deletes the restored instance', () => {
    const runbook = singleRunbook(
      createNode({ id: 'prod-db', type: NodeType.DATABASE, sourceType: 'RDS', metadata: { dbIdentifier: 'prod-db', dbInstanceClass: 'db.t3.large' } }),
      'restore_from_backup',
      'rds',
    );

    expect((runbook.rollback.steps[0]?.command as { readonly command: string }).command).toContain('delete-db-instance');
  });

  it('Aurora failover contains failover-db-cluster', () => {
    const runbook = singleRunbook(
      createNode({ id: 'aurora-orders', type: NodeType.DATABASE, sourceType: 'AURORA_CLUSTER', metadata: { dbClusterIdentifier: 'aurora-orders', originalWriterId: 'aurora-writer-1' } }),
      'aurora_failover',
      'aurora-cluster',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('failover-db-cluster');
  });

  it('Aurora failover notes mention 30 seconds and stable cluster endpoint', () => {
    const runbook = singleRunbook(
      createNode({ id: 'aurora-orders', type: NodeType.DATABASE, sourceType: 'AURORA_CLUSTER', metadata: { dbClusterIdentifier: 'aurora-orders', originalWriterId: 'aurora-writer-1' } }),
      'aurora_failover',
      'aurora-cluster',
    );

    expect(runbook.steps[0]?.notes.join(' ')).toContain('30 seconds');
    expect(runbook.steps[0]?.notes.join(' ')).toContain('does not change');
  });

  it('Aurora global failover contains switchover and remove-from-global-cluster variants', () => {
    const runbook = singleRunbook(
      createNode({
        id: 'aurora-global-secondary',
        type: NodeType.DATABASE,
        sourceType: 'AURORA_CLUSTER',
        metadata: {
          dbClusterIdentifier: 'aurora-global-secondary',
          globalClusterIdentifier: 'global-orders',
          secondaryClusterArn: 'arn:aws:rds:eu-west-1:123456789012:cluster:aurora-global-secondary',
          secondaryClusterId: 'aurora-global-secondary',
          primaryRegion: 'us-east-1',
          secondaryRegion: 'eu-west-1',
        },
      }),
      'aurora_global_failover',
      'aurora-cluster',
    );

    const commands = allCommandStrings(runbook).join(' ');
    expect(commands).toContain('switchover-global-cluster');
    expect(commands).toContain('remove-from-global-cluster');
  });

  it('S3 versioning runbook lists object versions', () => {
    const runbook = singleRunbook(
      createNode({ id: 'orders-bucket', type: NodeType.OBJECT_STORAGE, sourceType: 'S3_BUCKET', metadata: { bucketName: 'orders-bucket', versioningStatus: 'Enabled' } }),
      'restore_from_backup',
      's3',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('list-object-versions');
  });

  it('EC2 in ASG mentions automatic replacement', () => {
    const runbook = singleRunbook(
      createNode({ id: 'i-123', type: NodeType.VM, sourceType: 'EC2', metadata: { autoScalingGroupName: 'orders-asg', asgDesiredCapacity: 2 } }),
      'auto_scaling',
      'ec2',
    );

    expect(runbook.steps[0]?.notes.join(' ')).toContain('replace unhealthy instances automatically');
  });

  it('EC2 standalone recovery launches a new instance with run-instances', () => {
    const runbook = singleRunbook(
      createNode({ id: 'i-standalone', type: NodeType.VM, sourceType: 'EC2', metadata: { instanceType: 't3.medium', subnetId: 'subnet-123', securityGroups: ['sg-123'] } }),
      'rebuild',
      'ec2',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('run-instances');
  });

  it('DynamoDB PITR contains restore-table-to-point-in-time', () => {
    const runbook = singleRunbook(
      createNode({ id: 'orders-table', type: NodeType.DATABASE, sourceType: 'DYNAMODB', metadata: { tableName: 'orders-table', pointInTimeRecoveryEnabled: true } }),
      'restore_from_backup',
      'dynamodb',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('restore-table-to-point-in-time');
  });

  it('ElastiCache contains test-failover', () => {
    const runbook = singleRunbook(
      createNode({ id: 'orders-cache', type: NodeType.CACHE, sourceType: 'ELASTICACHE', metadata: { replicationGroupId: 'orders-cache-rg' } }),
      'failover',
      'elasticache',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('test-failover');
  });

  it('EKS contains describe-cluster and mentions GitOps or Velero', () => {
    const runbook = singleRunbook(
      createNode({ id: 'orders-eks', type: NodeType.KUBERNETES_CLUSTER, sourceType: 'EKS', metadata: { clusterName: 'orders-eks' } }),
      'rebuild',
      'eks',
    );

    expect(allCommandStrings(runbook).join(' ')).toContain('describe-cluster');
    expect(`${runbook.steps[4]?.description} ${runbook.steps[4]?.notes.join(' ')}`).toMatch(/GitOps|Velero/);
  });

  it('Route53 automatic failover mentions that the failover is automatic', () => {
    const runbook = singleRunbook(
      createNode({ id: 'record-primary', name: 'app.example.com', type: NodeType.DNS, sourceType: 'ROUTE53_RECORD', region: 'global', metadata: { hostedZoneId: 'Z123ZONE', healthCheckId: 'hc-123' } }),
      'dns_failover',
      'route53-record',
    );

    expect(runbook.steps[0]?.notes.join(' ')).toContain('shift traffic without a manual DNS change');
  });

  it('Generic rebuild mentions IaC when detected', () => {
    const runbook = singleRunbook(
      createNode({
        id: 'custom-service',
        type: NodeType.APPLICATION,
        sourceType: 'CUSTOM_WIDGET',
        metadata: {
          terraformResourceAddress: 'aws_instance.custom_service',
        },
      }),
      'rebuild',
      'custom-widget',
    );

    expect(runbook.steps[0]?.description).toContain('Terraform');
  });
});

describe('generateRunbook safety and serialization', () => {
  it('verification commands are read-only', () => {
    const runbook = createSampleRunbook();

    runbook.componentRunbooks.forEach((component) => {
      component.steps.forEach((step) => {
        if (step.verification) assertReadOnly(step.verification.command);
      });
      if (component.finalValidation) assertReadOnly(component.finalValidation.command);
    });
  });

  it('aws_wait commands are read-only', () => {
    const runbook = createSampleRunbook();
    const waitCommands = runbook.componentRunbooks.flatMap((component) =>
      component.steps
        .filter((step) => step.command.type === 'aws_wait')
        .map((step) => (step.command as { readonly command: string }).command),
    );

    waitCommands.forEach((command) => assertReadOnly(command));
  });

  it('every generated component runbook has a non-empty rollback', () => {
    const runbook = createSampleRunbook();

    runbook.componentRunbooks.forEach((component) => {
      expect(component.rollback.description.length).toBeGreaterThan(0);
      expect(component.rollback.steps.length).toBeGreaterThan(0);
    });
  });

  it('AWS CLI commands include real component identifiers', () => {
    const runbook = createSampleRunbook();
    const commands = runbook.componentRunbooks.flatMap((component) => allCommandStrings(component)).join(' ');

    expect(commands).toContain('prod-db');
    expect(commands).toContain('orders-bucket');
    expect(commands).toContain('hc-123');
  });

  it('disclaimer and confidentiality warnings are non-empty', () => {
    const runbook = createSampleRunbook();

    expect(runbook.disclaimer.length).toBeGreaterThan(0);
    expect(runbook.confidentialityWarning.length).toBeGreaterThan(0);
  });

  it('serializeRunbook YAML output is parseable by a standard YAML parser', () => {
    const runbook = createSampleRunbook();
    const parsed = parse(serializeRunbook(runbook, 'yaml'));

    expect(parsed).toHaveProperty('components');
  });

  it('the runbook keeps components in DRP recoveryOrder', () => {
    const runbook = createSampleRunbook();

    expect(runbook.componentRunbooks.map((component) => component.componentId)).toEqual([
      'record-primary',
      'prod-db',
      'orders-bucket',
    ]);
  });

  it('generated AWS CLI commands stay on one line', () => {
    const runbook = createSampleRunbook();

    runbook.componentRunbooks
      .flatMap((component) => allCommandStrings(component))
      .forEach((command) => expect(command).not.toContain('\\\n'));
  });
});

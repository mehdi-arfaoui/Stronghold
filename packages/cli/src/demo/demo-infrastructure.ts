import { getStartupDemoPipelineInput, type InfraNode } from '@stronghold-dr/core';

import type { DemoScenario } from '../config/options.js';
import type { StoredScanEdge } from '../storage/file-store.js';

export interface DemoInfrastructure {
  readonly provider: 'aws';
  readonly regions: readonly string[];
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<StoredScanEdge>;
  readonly isDemo: true;
}

const ACCOUNT_ID = '123456789012';

export function getDemoInfrastructure(scenario: DemoScenario): DemoInfrastructure {
  if (scenario === 'enterprise') {
    return buildEnterpriseScenario();
  }
  if (scenario === 'minimal') {
    return buildMinimalScenario();
  }
  return buildStartupScenario();
}

function buildStartupScenario(): DemoInfrastructure {
  return getStartupDemoPipelineInput();
}

function buildEnterpriseScenario(): DemoInfrastructure {
  const primary = 'eu-west-1';
  const secondary = 'us-east-1';
  const primaryZones = ['eu-west-1a', 'eu-west-1b', 'eu-west-1c'] as const;
  const secondaryZones = ['us-east-1a', 'us-east-1b', 'us-east-1c'] as const;
  const nodes: InfraNode[] = [
    vpc('vpc-enterprise-primary', primary),
    ...primaryZones.map((zone, index) =>
      subnet(`subnet-primary-${index + 1}`, primary, zone, 'vpc-enterprise-primary'),
    ),
    vpc('vpc-enterprise-secondary', secondary),
    ...secondaryZones.map((zone, index) =>
      subnet(`subnet-secondary-${index + 1}`, secondary, zone, 'vpc-enterprise-secondary'),
    ),
    asg('orders-asg', primary),
    asg('orders-dr-asg', secondary),
    elb('global-api-alb-primary', primary, [...primaryZones]),
    elb('global-api-alb-secondary', secondary, [...secondaryZones]),
    ...['1', '2', '3', '4', '5', '6'].map((id, index) =>
      ec2(
        `prod-app-${id}`,
        primary,
        primaryZones[index % primaryZones.length] ?? primaryZones[0],
        'orders',
        'orders-asg',
      ),
    ),
    ...['1', '2', '3'].map((id, index) =>
      ec2(
        `dr-app-${id}`,
        secondary,
        secondaryZones[index % secondaryZones.length] ?? secondaryZones[0],
        'orders',
        'orders-dr-asg',
      ),
    ),
    rds('orders-db-primary', primary, {
      multiAz: true,
      readReplicaDBInstanceIdentifiers: ['orders-db-replica'],
      backupPlanName: 'orders-backup-plan',
    }),
    rds('orders-db-replica', primary, {
      multiAz: true,
      readReplicaSourceDBInstanceIdentifier: 'orders-db-primary',
      backupPlanName: 'orders-backup-plan',
    }),
    auroraGlobal('customer-global-db', primary, ['customer-cluster-primary', 'customer-cluster-secondary']),
    auroraCluster('customer-cluster-primary', primary, primaryZones, 14, true, 'customer-global-db'),
    auroraCluster('customer-cluster-secondary', secondary, secondaryZones, 14, true, 'customer-global-db'),
    auroraInstance('customer-writer-primary', primary, primaryZones[0], true),
    auroraInstance('customer-reader-primary-a', primary, primaryZones[1], false),
    auroraInstance('customer-reader-primary-b', primary, primaryZones[2], false),
    auroraInstance('customer-writer-secondary', secondary, secondaryZones[0], true),
    auroraInstance('customer-reader-secondary-a', secondary, secondaryZones[1], false),
    auroraInstance('customer-reader-secondary-b', secondary, secondaryZones[2], false),
    s3Bucket('enterprise-artifacts', primary, true, true),
    s3Bucket('enterprise-audit-logs', primary, true, true),
    dynamodb('orders-table', primary, true, true),
    dynamodb('sessions-table', primary, true, true),
    efs('shared-platform-files', primary, true),
    efsMountTarget('shared-platform-files-a', primary, primaryZones[0], 'fs-shared-platform-files'),
    efsMountTarget('shared-platform-files-b', primary, primaryZones[1], 'fs-shared-platform-files'),
    efsMountTarget('shared-platform-files-c', primary, primaryZones[2], 'fs-shared-platform-files'),
    lambda('invoice-worker', primary, true),
    lambda('billing-webhook', primary, true),
    sqs('billing-events', primary, true),
    sns('ops-alerts', primary),
    eks('platform-eks', primary, ['subnet-primary-1', 'subnet-primary-2', 'subnet-primary-3']),
    elasticache('global-session-cache', primary, true),
    route53Zone('ZENTERPRISE123', 'example-enterprise.com'),
    route53Record(
      'route53-record:ZENTERPRISE123:api.example-enterprise.com:A:PRIMARY',
      'api.example-enterprise.com',
      'ZENTERPRISE123',
      'global-api-alb-primary.eu-west-1.elb.amazonaws.com',
      'PRIMARY',
      60,
    ),
    route53Record(
      'route53-record:ZENTERPRISE123:api.example-enterprise.com:A:SECONDARY',
      'api.example-enterprise.com',
      'ZENTERPRISE123',
      'global-api-alb-secondary.us-east-1.elb.amazonaws.com',
      'SECONDARY',
      60,
    ),
    backupPlan('orders-backup-plan', primary, [
      'orders-db-primary',
      'orders-db-replica',
      efsId('shared-platform-files', primary),
      'arn:aws:dynamodb:eu-west-1:123456789012:table/orders-table',
      'arn:aws:dynamodb:eu-west-1:123456789012:table/sessions-table',
      ...['1', '2', '3', '4', '5', '6'].map((id) => ec2Id(`prod-app-${id}`, primary)),
      ...['1', '2', '3'].map((id) => ec2Id(`dr-app-${id}`, secondary)),
    ]),
    ...[
      'orders-db-primary',
      elbId('global-api-alb-primary', primary),
      elbId('global-api-alb-secondary', secondary),
      'platform-eks',
      'arn:aws:elasticache:eu-west-1:123456789012:replicationgroup:global-session-cache',
      ...['1', '2', '3', '4', '5', '6'].map((id) => ec2Id(`prod-app-${id}`, primary)),
      ...['1', '2', '3'].map((id) => ec2Id(`dr-app-${id}`, secondary)),
      'arn:aws:lambda:eu-west-1:123456789012:function:invoice-worker',
      'arn:aws:lambda:eu-west-1:123456789012:function:billing-webhook',
    ].map((target, index) => cloudwatchAlarm(`alarm-${index + 1}`, primary, [target])),
  ];

  const edges: StoredScanEdge[] = [
    ...primaryZones.map((_zone, index) => contains('vpc-enterprise-primary', `subnet-primary-${index + 1}`)),
    ...secondaryZones.map((_zone, index) => contains('vpc-enterprise-secondary', `subnet-secondary-${index + 1}`)),
    ...['1', '2', '3', '4', '5', '6'].map((id) => contains('orders-asg', ec2Id(`prod-app-${id}`, primary))),
    ...['1', '2', '3'].map((id) => contains('orders-dr-asg', ec2Id(`dr-app-${id}`, secondary))),
    ...['1', '2', '3', '4', '5', '6'].map((id) =>
      depends(elbId('global-api-alb-primary', primary), ec2Id(`prod-app-${id}`, primary)),
    ),
    ...['1', '2', '3'].map((id) =>
      depends(elbId('global-api-alb-secondary', secondary), ec2Id(`dr-app-${id}`, secondary)),
    ),
    ...['1', '2', '3', '4', '5', '6'].map((id) =>
      depends(ec2Id(`prod-app-${id}`, primary), 'orders-db-primary'),
    ),
    ...['1', '2', '3'].map((id) =>
      depends(ec2Id(`dr-app-${id}`, secondary), auroraClusterId('customer-cluster-secondary', secondary)),
    ),
    contains(auroraGlobalId('customer-global-db', primary), auroraClusterId('customer-cluster-primary', primary)),
    contains(auroraGlobalId('customer-global-db', primary), auroraClusterId('customer-cluster-secondary', secondary)),
    contains(auroraClusterId('customer-cluster-primary', primary), auroraInstanceId('customer-writer-primary', primary)),
    contains(auroraClusterId('customer-cluster-primary', primary), auroraInstanceId('customer-reader-primary-a', primary)),
    contains(auroraClusterId('customer-cluster-primary', primary), auroraInstanceId('customer-reader-primary-b', primary)),
    contains(auroraClusterId('customer-cluster-secondary', secondary), auroraInstanceId('customer-writer-secondary', secondary)),
    contains(auroraClusterId('customer-cluster-secondary', secondary), auroraInstanceId('customer-reader-secondary-a', secondary)),
    contains(auroraClusterId('customer-cluster-secondary', secondary), auroraInstanceId('customer-reader-secondary-b', secondary)),
    replicates(auroraClusterId('customer-cluster-primary', primary), auroraClusterId('customer-cluster-secondary', secondary)),
    contains(efsId('shared-platform-files', primary), 'shared-platform-files-a'),
    contains(efsId('shared-platform-files', primary), 'shared-platform-files-b'),
    contains(efsId('shared-platform-files', primary), 'shared-platform-files-c'),
    contains('ZENTERPRISE123', 'route53-record:ZENTERPRISE123:api.example-enterprise.com:A:PRIMARY'),
    contains('ZENTERPRISE123', 'route53-record:ZENTERPRISE123:api.example-enterprise.com:A:SECONDARY'),
    routes('route53-record:ZENTERPRISE123:api.example-enterprise.com:A:PRIMARY', 'global-api-alb-primary'),
    routes('route53-record:ZENTERPRISE123:api.example-enterprise.com:A:SECONDARY', 'global-api-alb-secondary'),
    ...[
      'orders-db-primary',
      'orders-db-replica',
      efsId('shared-platform-files', primary),
      'arn:aws:dynamodb:eu-west-1:123456789012:table/orders-table',
      'arn:aws:dynamodb:eu-west-1:123456789012:table/sessions-table',
      ...['1', '2', '3', '4', '5', '6'].map((id) => ec2Id(`prod-app-${id}`, primary)),
      ...['1', '2', '3'].map((id) => ec2Id(`dr-app-${id}`, secondary)),
    ].map((resourceId) => backup(backupPlanId('orders-backup-plan', primary), resourceId)),
    ...[
      'orders-db-primary',
      elbId('global-api-alb-primary', primary),
      elbId('global-api-alb-secondary', secondary),
      'platform-eks',
      'arn:aws:elasticache:eu-west-1:123456789012:replicationgroup:global-session-cache',
      ...['1', '2', '3', '4', '5', '6'].map((id) => ec2Id(`prod-app-${id}`, primary)),
      ...['1', '2', '3'].map((id) => ec2Id(`dr-app-${id}`, secondary)),
      'arn:aws:lambda:eu-west-1:123456789012:function:invoice-worker',
      'arn:aws:lambda:eu-west-1:123456789012:function:billing-webhook',
    ].map((target, index) => monitors(alarmId(`alarm-${index + 1}`, primary), target)),
  ];

  return {
    provider: 'aws',
    regions: [primary, secondary],
    nodes,
    edges,
    isDemo: true,
  };
}

function buildMinimalScenario(): DemoInfrastructure {
  const region = 'eu-west-1';
  const zone = 'eu-west-1a';
  const nodes: InfraNode[] = [
    vpc('vpc-minimal', region),
    subnet('subnet-minimal-a', region, zone, 'vpc-minimal'),
    elb('minimal-api-alb', region, [zone]),
    ec2('minimal-api-1', region, zone, 'minimal-app'),
    rds('minimal-db', region, {
      multiAz: false,
      backupRetentionPeriod: 0,
      readReplicaDBInstanceIdentifiers: [],
    }),
    s3Bucket('minimal-uploads', region, false, false),
    route53Zone('ZMINIMAL123', 'example-minimal.com'),
    route53Record(
      'route53-record:ZMINIMAL123:api.example-minimal.com:A:simple',
      'api.example-minimal.com',
      'ZMINIMAL123',
      'minimal-api-alb.eu-west-1.elb.amazonaws.com',
    ),
  ];

  const edges: StoredScanEdge[] = [
    contains('vpc-minimal', 'subnet-minimal-a'),
    depends('minimal-api-alb', 'minimal-api-1'),
    depends('minimal-api-1', 'minimal-db'),
    contains('ZMINIMAL123', 'route53-record:ZMINIMAL123:api.example-minimal.com:A:simple'),
    routes('route53-record:ZMINIMAL123:api.example-minimal.com:A:simple', 'minimal-api-alb'),
  ];

  return {
    provider: 'aws',
    regions: [region],
    nodes,
    edges,
    isDemo: true,
  };
}

function createNode(
  input: Partial<InfraNode> & {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly provider?: string;
    readonly region: string;
    readonly tags?: Record<string, string>;
    readonly metadata: Record<string, unknown>;
  },
): InfraNode {
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    provider: input.provider ?? 'aws',
    region: input.region,
    availabilityZone: input.availabilityZone ?? null,
    tags: input.tags ?? {},
    metadata: input.metadata,
  };
}

function ec2(
  name: string,
  region: string,
  availabilityZone: string,
  service: string,
  autoScalingGroupName?: string,
): InfraNode {
  return createNode({
    id: ec2Id(name, region),
    name,
    type: 'VM',
    region,
    availabilityZone,
    tags: { Service: service },
    metadata: {
      sourceType: 'EC2',
      autoScalingGroupName,
      availabilityZone,
      instanceType: 't3.medium',
    },
  });
}

function rds(name: string, region: string, overrides: Record<string, unknown>): InfraNode {
  return createNode({
    id: name,
    name,
    type: 'DATABASE',
    region,
    tags: { Service: 'database' },
    metadata: {
      sourceType: 'RDS',
      dbIdentifier: name,
      dbArn: `arn:aws:rds:${region}:${ACCOUNT_ID}:db:${name}`,
      engine: 'postgres',
      multiAz: true,
      backupRetentionPeriod: 7,
      readReplicaDBInstanceIdentifiers: ['replica'],
      ...overrides,
    },
  });
}

function auroraCluster(
  name: string,
  region: string,
  availabilityZones: readonly string[],
  backupRetentionPeriod: number,
  deletionProtection: boolean,
  globalClusterIdentifier?: string,
): InfraNode {
  return createNode({
    id: auroraClusterId(name, region),
    name,
    type: 'DATABASE',
    region,
    tags: { Service: 'analytics' },
    metadata: {
      sourceType: 'aurora_cluster',
      dbClusterIdentifier: name,
      dbClusterArn: `arn:aws:rds:${region}:${ACCOUNT_ID}:cluster:${name}`,
      availabilityZones,
      backupRetentionPeriod,
      deletionProtection,
      globalClusterIdentifier,
    },
  });
}

function auroraGlobal(name: string, region: string, members: readonly string[]): InfraNode {
  return createNode({
    id: auroraGlobalId(name, region),
    name,
    type: 'DATABASE',
    region,
    tags: { Service: 'analytics' },
    metadata: {
      sourceType: 'aurora_global',
      globalClusterIdentifier: name,
      globalClusterMembers: members.map((member) => ({
        DBClusterArn: member.includes('arn:') ? member : `arn:aws:rds:${region}:${ACCOUNT_ID}:cluster:${member}`,
      })),
    },
  });
}

function auroraInstance(name: string, region: string, availabilityZone: string, writer: boolean): InfraNode {
  return createNode({
    id: auroraInstanceId(name, region),
    name,
    type: 'DATABASE',
    region,
    availabilityZone,
    tags: { Service: 'analytics' },
    metadata: {
      sourceType: 'aurora_instance',
      dbInstanceIdentifier: name,
      isClusterWriter: writer,
      promotionTier: writer ? 0 : 1,
      availabilityZone,
    },
  });
}

function s3Bucket(name: string, region: string, versioning: boolean, replication: boolean): InfraNode {
  return createNode({
    id: `arn:aws:s3:::${name}`,
    name,
    type: 'OBJECT_STORAGE',
    region,
    tags: { Service: 'storage' },
    metadata: {
      sourceType: 'S3_BUCKET',
      bucketArn: `arn:aws:s3:::${name}`,
      bucketName: name,
      versioningStatus: versioning ? 'Enabled' : 'Disabled',
      hasCrossRegionReplication: replication,
      replicationRules: replication ? [{ status: 'Enabled' }] : [],
    },
  });
}

function efs(name: string, region: string, healthy: boolean): InfraNode {
  return createNode({
    id: efsId(name, region),
    name,
    type: 'FILE_STORAGE',
    region,
    tags: { Service: 'shared-files' },
    metadata: {
      sourceType: 'efs_filesystem',
      fileSystemId: `fs-${name}`,
      automaticBackups: healthy,
      backupPolicy: { status: healthy ? 'ENABLED' : 'DISABLED' },
      replicationConfigurations: healthy ? [{ destinationFileSystemId: `fs-${name}-dr` }] : [],
      availabilityZones: healthy ? ['eu-west-1a', 'eu-west-1b'] : ['eu-west-1a'],
    },
  });
}

function efsMountTarget(name: string, region: string, availabilityZone: string, fileSystemId: string): InfraNode {
  return createNode({
    id: name,
    name,
    type: 'FILE_STORAGE',
    region,
    availabilityZone,
    tags: { Service: 'shared-files' },
    metadata: {
      sourceType: 'efs_mount_target',
      fileSystemId,
      mountTargetId: name,
      availabilityZone,
      automaticBackups: true,
      backupPolicy: { status: 'ENABLED' },
    },
  });
}

function lambda(name: string, region: string, hasDlq: boolean): InfraNode {
  return createNode({
    id: `arn:aws:lambda:${region}:${ACCOUNT_ID}:function:${name}`,
    name,
    type: 'SERVERLESS',
    region,
    tags: { Service: name },
    metadata: {
      sourceType: 'LAMBDA',
      functionArn: `arn:aws:lambda:${region}:${ACCOUNT_ID}:function:${name}`,
      functionName: name,
      deadLetterTargetArn: hasDlq ? `arn:aws:sqs:${region}:${ACCOUNT_ID}:${name}-dlq` : null,
    },
  });
}

function sqs(name: string, region: string, hasDlq: boolean): InfraNode {
  return createNode({
    id: `arn:aws:sqs:${region}:${ACCOUNT_ID}:${name}`,
    name,
    type: 'MESSAGE_QUEUE',
    region,
    tags: { Service: 'messaging' },
    metadata: {
      sourceType: 'SQS_QUEUE',
      queueArn: `arn:aws:sqs:${region}:${ACCOUNT_ID}:${name}`,
      queueName: name,
      redrivePolicy: hasDlq ? { deadLetterTargetArn: `arn:aws:sqs:${region}:${ACCOUNT_ID}:${name}-dlq` } : {},
    },
  });
}

function sns(name: string, region: string): InfraNode {
  return createNode({
    id: `arn:aws:sns:${region}:${ACCOUNT_ID}:${name}`,
    name,
    type: 'MESSAGE_QUEUE',
    region,
    tags: { Service: 'alerts' },
    metadata: {
      sourceType: 'SNS_TOPIC',
      topicArn: `arn:aws:sns:${region}:${ACCOUNT_ID}:${name}`,
      topicName: name,
    },
  });
}

function elasticache(name: string, region: string, healthy: boolean): InfraNode {
  return createNode({
    id: `arn:aws:elasticache:${region}:${ACCOUNT_ID}:replicationgroup:${name}`,
    name,
    type: 'CACHE',
    region,
    tags: { Service: 'cache' },
    metadata: {
      sourceType: 'ELASTICACHE',
      replicationGroupId: name,
      automaticFailoverStatus: healthy ? 'enabled' : 'disabled',
      multiAZEnabled: healthy,
      replicaCount: healthy ? 2 : 0,
    },
  });
}

function elb(name: string, region: string, availabilityZones: readonly string[]): InfraNode {
  return createNode({
    id: elbId(name, region),
    name,
    type: 'LOAD_BALANCER',
    region,
    tags: { Service: 'frontend' },
    metadata: {
      sourceType: 'ELB',
      loadBalancerArn: `arn:aws:elasticloadbalancing:${region}:${ACCOUNT_ID}:loadbalancer/app/${name}/123456`,
      loadBalancerName: name,
      crossZoneLoadBalancing: availabilityZones.length > 1,
      healthCheck: { healthyThreshold: 3, interval: 30 },
      availabilityZones,
    },
  });
}

function route53Zone(id: string, name: string): InfraNode {
  return createNode({
    id,
    name,
    type: 'DNS',
    provider: 'aws',
    region: 'global',
    tags: { Service: 'dns' },
    metadata: {
      sourceType: 'route53_hosted_zone',
      hostedZoneId: id,
      name,
    },
  });
}

function route53Record(
  id: string,
  label: string,
  hostedZoneId: string,
  aliasTargetDnsName: string,
  failover?: 'PRIMARY' | 'SECONDARY',
  ttl?: number,
): InfraNode {
  return createNode({
    id,
    name: label,
    type: 'DNS',
    provider: 'aws',
    region: 'global',
    tags: { Service: 'dns' },
    metadata: {
      sourceType: 'route53_record',
      hostedZoneId,
      name: label,
      type: 'A',
      routingPolicy: failover ? 'failover' : 'simple',
      failover,
      ttl,
      aliasTargetDnsName,
      healthCheckId: failover ? `hc-${id}` : undefined,
    },
  });
}

function cloudwatchAlarm(name: string, region: string, monitoredReferences: readonly string[]): InfraNode {
  return createNode({
    id: alarmId(name, region),
    name,
    type: 'APPLICATION',
    region,
    tags: { Service: 'monitoring' },
    metadata: {
      sourceType: 'cloudwatch_alarm',
      alarmName: name,
      monitoredReferences,
      actionsEnabled: true,
      alarmActions: [`arn:aws:sns:${region}:${ACCOUNT_ID}:ops-alerts`],
    },
  });
}

function dynamodb(name: string, region: string, pitr: boolean, global: boolean): InfraNode {
  return createNode({
    id: `arn:aws:dynamodb:${region}:${ACCOUNT_ID}:table/${name}`,
    name,
    type: 'DATABASE',
    region,
    tags: { Service: 'orders' },
    metadata: {
      sourceType: 'DYNAMODB',
      tableArn: `arn:aws:dynamodb:${region}:${ACCOUNT_ID}:table/${name}`,
      tableName: name,
      pointInTimeRecovery: pitr,
      pointInTimeRecoveryStatus: pitr ? 'ENABLED' : 'DISABLED',
      globalTableVersion: global ? '2019.11.21' : null,
      replicas: global ? [{ regionName: 'us-east-1' }] : [],
    },
  });
}

function eks(name: string, region: string, subnetIds: readonly string[]): InfraNode {
  return createNode({
    id: `arn:aws:eks:${region}:${ACCOUNT_ID}:cluster/${name}`,
    name,
    type: 'KUBERNETES_CLUSTER',
    region,
    tags: { Service: 'platform' },
    metadata: {
      sourceType: 'EKS',
      clusterName: name,
      subnetIds,
    },
  });
}

function vpc(name: string, region: string): InfraNode {
  return createNode({
    id: name,
    name,
    type: 'VPC',
    region,
    tags: { Service: 'network' },
    metadata: {
      sourceType: 'VPC',
      vpcId: name,
      cidrBlock: '10.0.0.0/16',
    },
  });
}

function subnet(name: string, region: string, availabilityZone: string, vpcId: string): InfraNode {
  return createNode({
    id: name,
    name,
    type: 'SUBNET',
    region,
    availabilityZone,
    tags: { Service: 'network' },
    metadata: {
      sourceType: 'SUBNET',
      subnetId: name,
      vpcId,
      availabilityZone,
    },
  });
}

function backupPlan(name: string, region: string, protectedResources: readonly string[]): InfraNode {
  return createNode({
    id: backupPlanId(name, region),
    name,
    type: 'FILE_STORAGE',
    region,
    tags: { Service: 'backup' },
    metadata: {
      sourceType: 'backup_plan',
      backupPlanName: name,
      protectedResources: protectedResources.map((resourceId) => ({
        resourceArn: resourceId,
        lastBackupTime: new Date('2026-03-26T08:00:00.000Z').toISOString(),
      })),
      recoveryPoints: [{ lifecycle: { DeleteAfterDays: 35 } }],
    },
  });
}

function asg(name: string, region: string): InfraNode {
  return createNode({
    id: name,
    name,
    type: 'VM',
    region,
    tags: { Service: 'compute' },
    metadata: {
      sourceType: 'ASG',
      autoScalingGroupName: name,
      minSize: 2,
      maxSize: 6,
      desiredCapacity: 3,
    },
  });
}

function ec2Id(name: string, region: string): string {
  return `arn:aws:ec2:${region}:${ACCOUNT_ID}:instance/${name}`;
}

function elbId(name: string, region: string): string {
  return `arn:aws:elasticloadbalancing:${region}:${ACCOUNT_ID}:loadbalancer/app/${name}/123456`;
}

function auroraClusterId(name: string, region: string): string {
  return `arn:aws:rds:${region}:${ACCOUNT_ID}:cluster:${name}`;
}

function auroraGlobalId(name: string, region: string): string {
  return `arn:aws:rds:${region}:${ACCOUNT_ID}:global-cluster:${name}`;
}

function auroraInstanceId(name: string, region: string): string {
  return `arn:aws:rds:${region}:${ACCOUNT_ID}:db:${name}`;
}

function efsId(name: string, region: string): string {
  return `arn:aws:elasticfilesystem:${region}:${ACCOUNT_ID}:file-system/fs-${name}`;
}

function backupPlanId(name: string, region: string): string {
  return `arn:aws:backup:${region}:${ACCOUNT_ID}:backup-plan:${name}`;
}

function alarmId(name: string, region: string): string {
  return `arn:aws:cloudwatch:${region}:${ACCOUNT_ID}:alarm:${name}`;
}

function contains(source: string, target: string): StoredScanEdge {
  return { source, target, type: 'CONTAINS' };
}

function depends(source: string, target: string): StoredScanEdge {
  return { source, target, type: 'DEPENDS_ON' };
}

function routes(source: string, target: string): StoredScanEdge {
  return { source, target, type: 'ROUTES_TO' };
}

function monitors(source: string, target: string): StoredScanEdge {
  return { source, target, type: 'MONITORS' };
}

function replicates(source: string, target: string): StoredScanEdge {
  return { source, target, type: 'REPLICATES_TO' };
}

function backup(source: string, target: string): StoredScanEdge {
  return { source, target, type: 'BACKS_UP_TO' };
}

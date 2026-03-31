import type { ScanEdge } from '../types/infrastructure.js';
import type { InfraNode } from '../validation/index.js';

export interface DemoPipelineInput {
  readonly provider: 'aws';
  readonly regions: readonly string[];
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ScanEdge>;
  readonly isDemo: true;
}

const ACCOUNT_ID = '123456789012';

export function getStartupDemoPipelineInput(): DemoPipelineInput {
  const region = 'eu-west-1';
  const zones = ['eu-west-1a', 'eu-west-1b'] as const;
  const nodes: InfraNode[] = [
    vpc('vpc-startup', region),
    subnet('subnet-public-a', region, zones[0], 'vpc-startup'),
    subnet('subnet-public-b', region, zones[1], 'vpc-startup'),
    subnet('subnet-private-a', region, zones[0], 'vpc-startup'),
    subnet('subnet-private-b', region, zones[1], 'vpc-startup'),
    asg('startup-asg', region),
    elb('prod-api-alb', region, ['eu-west-1a', 'eu-west-1b']),
    ec2('prod-api-1', region, zones[0], 'startup-api', 'startup-asg'),
    ec2('prod-api-2', region, zones[1], 'startup-api', 'startup-asg'),
    rds('prod-db-primary', region, { multiAz: false, readReplicaDBInstanceIdentifiers: [] }),
    auroraCluster('analytics-cluster', region, zones, 7, true),
    auroraInstance('analytics-writer', region, zones[0], true),
    auroraInstance('analytics-reader', region, zones[1], false),
    s3Bucket('user-uploads-bucket', region, true, false),
    s3Bucket('artifacts-bucket', region, true, false),
    lambda('thumbnail-generator', region, true),
    sqs('image-jobs', region, true),
    elasticache('session-cache', region, true),
    efs('shared-documents', region, false),
    efsMountTarget('shared-documents-mt-a', region, zones[0], 'fs-shared-documents'),
    route53Zone('ZSTARTUP123', 'example-startup.com'),
    route53Record(
      'route53-record:ZSTARTUP123:api.example-startup.com:A:simple',
      'api.example-startup.com',
      'ZSTARTUP123',
      'prod-api-alb.eu-west-1.elb.amazonaws.com',
    ),
    backupPlan('startup-backup-plan', region, [
      ec2Id('prod-api-1', region),
      ec2Id('prod-api-2', region),
    ]),
    cloudwatchAlarm('prod-api-alb-health', region, ['prod-api-alb']),
  ];

  const edges: ScanEdge[] = [
    contains('vpc-startup', 'subnet-public-a'),
    contains('vpc-startup', 'subnet-public-b'),
    contains('vpc-startup', 'subnet-private-a'),
    contains('vpc-startup', 'subnet-private-b'),
    contains('startup-asg', ec2Id('prod-api-1', region)),
    contains('startup-asg', ec2Id('prod-api-2', region)),
    depends(elbId('prod-api-alb', region), ec2Id('prod-api-1', region)),
    depends(elbId('prod-api-alb', region), ec2Id('prod-api-2', region)),
    depends(ec2Id('prod-api-1', region), 'prod-db-primary'),
    depends(ec2Id('prod-api-2', region), 'prod-db-primary'),
    depends(
      ec2Id('prod-api-1', region),
      'arn:aws:elasticache:eu-west-1:123456789012:replicationgroup:session-cache',
    ),
    depends(
      ec2Id('prod-api-2', region),
      'arn:aws:elasticache:eu-west-1:123456789012:replicationgroup:session-cache',
    ),
    contains(
      auroraClusterId('analytics-cluster', region),
      auroraInstanceId('analytics-writer', region),
    ),
    contains(
      auroraClusterId('analytics-cluster', region),
      auroraInstanceId('analytics-reader', region),
    ),
    backup(backupPlanId('startup-backup-plan', region), ec2Id('prod-api-1', region)),
    backup(backupPlanId('startup-backup-plan', region), ec2Id('prod-api-2', region)),
    monitors(alarmId('prod-api-alb-health', region), elbId('prod-api-alb', region)),
    contains('ZSTARTUP123', 'route53-record:ZSTARTUP123:api.example-startup.com:A:simple'),
    routes(
      'route53-record:ZSTARTUP123:api.example-startup.com:A:simple',
      elbId('prod-api-alb', region),
    ),
    contains(efsId('shared-documents', region), 'shared-documents-mt-a'),
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
    },
  });
}

function auroraInstance(
  name: string,
  region: string,
  availabilityZone: string,
  writer: boolean,
): InfraNode {
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

function s3Bucket(
  name: string,
  region: string,
  versioning: boolean,
  replication: boolean,
): InfraNode {
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

function efsMountTarget(
  name: string,
  region: string,
  availabilityZone: string,
  fileSystemId: string,
): InfraNode {
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
      redrivePolicy: hasDlq
        ? { deadLetterTargetArn: `arn:aws:sqs:${region}:${ACCOUNT_ID}:${name}-dlq` }
        : {},
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
      routingPolicy: 'simple',
      aliasTargetDnsName,
    },
  });
}

function cloudwatchAlarm(
  name: string,
  region: string,
  monitoredReferences: readonly string[],
): InfraNode {
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

function contains(source: string, target: string): ScanEdge {
  return { source, target, type: 'CONTAINS' };
}

function depends(source: string, target: string): ScanEdge {
  return { source, target, type: 'DEPENDS_ON' };
}

function routes(source: string, target: string): ScanEdge {
  return { source, target, type: 'ROUTES_TO' };
}

function monitors(source: string, target: string): ScanEdge {
  return { source, target, type: 'MONITORS' };
}

function backup(source: string, target: string): ScanEdge {
  return { source, target, type: 'BACKS_UP_TO' };
}

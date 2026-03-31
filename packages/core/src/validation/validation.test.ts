import { describe, expect, it } from 'vitest';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import { allValidationRules } from './validation-rules.js';
import { runValidation } from './validation-engine.js';
import type { ValidationEdge, ValidationResult } from './validation-types.js';

function createNode(
  overrides: Partial<InfraNodeAttrs> & {
    readonly id: string;
    readonly type?: string;
    readonly metadata?: Record<string, unknown>;
  },
): InfraNodeAttrs {
  const sourceType =
    typeof overrides.metadata?.sourceType === 'string'
      ? overrides.metadata.sourceType
      : overrides.type ?? 'GENERIC';
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    type: overrides.type ?? 'APPLICATION',
    provider: 'aws',
    region: overrides.region ?? 'eu-west-1',
    availabilityZone: overrides.availabilityZone ?? null,
    tags: {},
    metadata: {
      sourceType,
      ...(overrides.metadata ?? {}),
    },
    ...overrides,
  };
}

function createEdge(source: string, target: string, type: string): ValidationEdge {
  return { source, target, type };
}

function findRule(ruleId: string) {
  const rule = allValidationRules.find((candidate) => candidate.id === ruleId);
  if (!rule) throw new Error(`Validation rule ${ruleId} was not found.`);
  return rule;
}

function executeRule(
  ruleId: string,
  targetNodeId: string,
  nodes: readonly InfraNodeAttrs[],
  edges: ReadonlyArray<ValidationEdge> = [],
): ValidationResult {
  const report = runValidation(nodes, edges, [findRule(ruleId)]);
  const result = report.results.find((entry) => entry.ruleId === ruleId && entry.nodeId === targetNodeId);
  if (!result) throw new Error(`Validation result for ${ruleId}/${targetNodeId} was not produced.`);
  return result;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function createRdsNode(
  id = 'rds-primary',
  metadata: Record<string, unknown> = {},
  region = 'eu-west-1',
): InfraNodeAttrs {
  return createNode({
    id,
    name: id,
    type: 'DATABASE',
    region,
    metadata: {
      sourceType: 'RDS',
      dbIdentifier: id,
      dbArn: `arn:aws:rds:${region}:123456789012:db:${id}`,
      backupRetentionPeriod: 7,
      backupRetentionDays: 7,
      multiAZ: true,
      readReplicaDBInstanceIdentifiers: ['rds-replica'],
      ...metadata,
    },
  });
}

function createS3Node(
  id = 'arn:aws:s3:::primary-bucket',
  metadata: Record<string, unknown> = {},
  region = 'eu-west-1',
): InfraNodeAttrs {
  return createNode({
    id,
    name: metadata.bucketName as string | undefined ?? 'primary-bucket',
    type: 'OBJECT_STORAGE',
    region,
    metadata: {
      sourceType: 'S3_BUCKET',
      bucketArn: id,
      bucketName: metadata.bucketName ?? 'primary-bucket',
      versioningStatus: 'Enabled',
      replicationRules: [{ status: 'Enabled' }],
      ...metadata,
    },
  });
}

function createEc2Node(
  id = 'i-123',
  availabilityZone = 'eu-west-1a',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    name: id,
    type: 'VM',
    region: 'eu-west-1',
    availabilityZone,
    metadata: {
      sourceType: 'EC2',
      availabilityZone,
      ...metadata,
    },
  });
}

function createAsgNode(id = 'asg-main'): InfraNodeAttrs {
  return createNode({
    id,
    name: id,
    type: 'VM',
    metadata: { sourceType: 'ASG' },
  });
}

function createElastiCacheNode(
  id = 'cache-main',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    name: id,
    type: 'CACHE',
    metadata: {
      sourceType: 'ELASTICACHE',
      automaticFailoverStatus: 'enabled',
      ...metadata,
    },
  });
}

function createDynamoNode(
  id = 'arn:aws:dynamodb:eu-west-1:123456789012:table/app-table',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    name: 'app-table',
    type: 'DATABASE',
    metadata: {
      sourceType: 'DYNAMODB',
      tableArn: id,
      tableName: 'app-table',
      pointInTimeRecoveryEnabled: true,
      globalTableVersion: '2019.11.21',
      replicas: [{ regionName: 'us-east-1' }],
      ...metadata,
    },
  });
}

function createLambdaNode(
  id = 'arn:aws:lambda:eu-west-1:123456789012:function:worker',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    name: 'worker',
    type: 'SERVERLESS',
    metadata: {
      sourceType: 'LAMBDA',
      functionArn: id,
      functionName: 'worker',
      deadLetterConfig: { targetArn: 'arn:aws:sqs:eu-west-1:123456789012:lambda-dlq' },
      deadLetterTargetArn: 'arn:aws:sqs:eu-west-1:123456789012:lambda-dlq',
      ...metadata,
    },
  });
}

function createElbNode(
  id = 'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/main-alb/123456',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    name: 'main-alb',
    type: 'LOAD_BALANCER',
    metadata: {
      sourceType: 'ELB',
      loadBalancerArn: id,
      loadBalancerName: 'main-alb',
      loadBalancerResourceName: 'app/main-alb/123456',
      crossZoneLoadBalancing: true,
      loadBalancingCrossZoneEnabled: true,
      healthCheck: { healthyThreshold: 5, interval: 30 },
      availabilityZones: ['eu-west-1a', 'eu-west-1b'],
      ...metadata,
    },
  });
}

function createSqsNode(
  id = 'arn:aws:sqs:eu-west-1:123456789012:jobs',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    name: 'jobs',
    type: 'MESSAGE_QUEUE',
    metadata: {
      sourceType: 'SQS_QUEUE',
      queueArn: id,
      queueName: 'jobs',
      redrivePolicy: { deadLetterTargetArn: 'arn:aws:sqs:eu-west-1:123456789012:jobs-dlq' },
      ...metadata,
    },
  });
}

function createSubnetNode(id: string, availabilityZone: string, vpcId = 'vpc-1'): InfraNodeAttrs {
  return createNode({
    id,
    name: id,
    type: 'SUBNET',
    availabilityZone,
    metadata: {
      sourceType: 'SUBNET',
      subnetId: id,
      availabilityZone,
      vpcId,
    },
  });
}

function createEksNode(
  id = 'eks-main',
  subnetIds: readonly string[] = ['subnet-a', 'subnet-b'],
): InfraNodeAttrs {
  return createNode({
    id,
    name: id,
    type: 'KUBERNETES_CLUSTER',
    metadata: {
      sourceType: 'EKS',
      subnetIds,
    },
  });
}

function createVpcNode(id = 'vpc-1'): InfraNodeAttrs {
  return createNode({
    id,
    name: id,
    type: 'VPC',
    metadata: { sourceType: 'VPC' },
  });
}

function createNatGatewayNode(id: string, vpcId = 'vpc-1'): InfraNodeAttrs {
  return createNode({
    id,
    name: id,
    type: 'NETWORK_DEVICE',
    metadata: {
      sourceType: 'NAT_GATEWAY',
      natGatewayId: id,
      vpcId,
    },
  });
}

function createRoute53ZoneNode(id = 'Z123ZONE'): InfraNodeAttrs {
  return createNode({
    id,
    name: 'app.example.com',
    type: 'DNS',
    region: 'global',
    metadata: {
      sourceType: 'ROUTE53_HOSTED_ZONE',
      hostedZoneId: id,
      name: 'app.example.com',
    },
  });
}

function createRoute53RecordNode(
  id: string,
  failover: 'PRIMARY' | 'SECONDARY',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return createNode({
    id,
    name: 'app.example.com',
    type: 'DNS',
    region: 'global',
    metadata: {
      sourceType: 'ROUTE53_RECORD',
      hostedZoneId: 'Z123ZONE',
      name: 'app.example.com',
      type: 'A',
      failover,
      routingPolicy: 'failover',
      healthCheckId: 'hc-1',
      ttl: 30,
      ...metadata,
    },
  });
}

function createBackupPlanNode(
  metadata: Record<string, unknown> = {},
  id = 'backup-plan-1',
): InfraNodeAttrs {
  return createNode({
    id,
    name: 'daily-backups',
    type: 'FILE_STORAGE',
    metadata: {
      sourceType: 'BACKUP_PLAN',
      backupPlanId: id,
      backupPlanName: 'daily-backups',
      protectedResources: [
        {
          resourceArn: 'arn:aws:rds:eu-west-1:123456789012:db:rds-primary',
          resourceType: 'RDS',
          lastBackupTime: hoursAgo(2),
        },
      ],
      recoveryPoints: [
        {
          recoveryPointArn: 'recovery-point-1',
          lifecycle: { DeleteAfterDays: 30 },
        },
      ],
      ...metadata,
    },
  });
}

function createCloudWatchAlarmNode(metadata: Record<string, unknown> = {}, id = 'alarm-1'): InfraNodeAttrs {
  return createNode({
    id,
    name: 'cpu-alarm',
    type: 'APPLICATION',
    metadata: {
      sourceType: 'CLOUDWATCH_ALARM',
      actionsEnabled: true,
      alarmActions: ['arn:aws:sns:eu-west-1:123456789012:ops'],
      ...metadata,
    },
  });
}

const passCases = [
  {
    ruleId: 'rds_replica_healthy',
    targetNodeId: 'rds-primary',
    build: () => ({
      nodes: [createRdsNode(), createRdsNode('rds-replica', {}, 'us-east-1')],
      edges: [],
    }),
  },
  {
    ruleId: 'rds_multi_az_active',
    targetNodeId: 'rds-primary',
    build: () => ({ nodes: [createRdsNode()], edges: [] }),
  },
  {
    ruleId: 'rds_backup_configured',
    targetNodeId: 'rds-primary',
    build: () => ({ nodes: [createRdsNode()], edges: [] }),
  },
  {
    ruleId: 's3_versioning_enabled',
    targetNodeId: 'arn:aws:s3:::primary-bucket',
    build: () => ({ nodes: [createS3Node()], edges: [] }),
  },
  {
    ruleId: 's3_replication_active',
    targetNodeId: 'arn:aws:s3:::primary-bucket',
    build: () => ({ nodes: [createS3Node()], edges: [] }),
  },
  {
    ruleId: 'ec2_in_asg',
    targetNodeId: 'i-123',
    build: () => ({
      nodes: [createAsgNode(), createEc2Node()],
      edges: [createEdge('asg-main', 'i-123', 'CONTAINS')],
    }),
  },
  {
    ruleId: 'ec2_multi_az',
    targetNodeId: 'i-123',
    build: () => ({
      nodes: [createAsgNode(), createEc2Node(), createEc2Node('i-456', 'eu-west-1b')],
      edges: [
        createEdge('asg-main', 'i-123', 'CONTAINS'),
        createEdge('asg-main', 'i-456', 'CONTAINS'),
      ],
    }),
  },
  {
    ruleId: 'elasticache_failover',
    targetNodeId: 'cache-main',
    build: () => ({ nodes: [createElastiCacheNode()], edges: [] }),
  },
  {
    ruleId: 'dynamodb_pitr_enabled',
    targetNodeId: 'arn:aws:dynamodb:eu-west-1:123456789012:table/app-table',
    build: () => ({ nodes: [createDynamoNode()], edges: [] }),
  },
  {
    ruleId: 'backup_retention_adequate',
    targetNodeId: 'rds-primary',
    build: () => ({ nodes: [createRdsNode()], edges: [] }),
  },
  {
    ruleId: 'cross_region_exists',
    targetNodeId: 'arn:aws:s3:::primary-bucket',
    build: () => ({
      nodes: [
        createS3Node(),
        createS3Node('arn:aws:s3:::dr-bucket', { bucketName: 'dr-bucket' }, 'us-east-1'),
      ],
      edges: [createEdge('arn:aws:s3:::primary-bucket', 'arn:aws:s3:::dr-bucket', 'REPLICATES_TO')],
    }),
  },
  {
    ruleId: 'route53_health_check',
    targetNodeId: 'record-primary',
    build: () => ({ nodes: [createRoute53RecordNode('record-primary', 'PRIMARY')], edges: [] }),
  },
  {
    ruleId: 'route53_failover_configured',
    targetNodeId: 'Z123ZONE',
    build: () => ({
      nodes: [
        createRoute53ZoneNode(),
        createRoute53RecordNode('record-primary', 'PRIMARY'),
        createRoute53RecordNode('record-secondary', 'SECONDARY'),
      ],
      edges: [
        createEdge('Z123ZONE', 'record-primary', 'CONTAINS'),
        createEdge('Z123ZONE', 'record-secondary', 'CONTAINS'),
      ],
    }),
  },
  {
    ruleId: 'route53_ttl_appropriate',
    targetNodeId: 'record-primary',
    build: () => ({ nodes: [createRoute53RecordNode('record-primary', 'PRIMARY')], edges: [] }),
  },
  {
    ruleId: 'backup_plan_exists',
    targetNodeId: 'rds-primary',
    build: () => ({
      nodes: [createBackupPlanNode(), createRdsNode()],
      edges: [createEdge('backup-plan-1', 'rds-primary', 'BACKS_UP_TO')],
    }),
  },
  {
    ruleId: 'backup_recent',
    targetNodeId: 'rds-primary',
    build: () => ({
      nodes: [createBackupPlanNode(), createRdsNode()],
      edges: [createEdge('backup-plan-1', 'rds-primary', 'BACKS_UP_TO')],
    }),
  },
  {
    ruleId: 'backup_lifecycle_configured',
    targetNodeId: 'backup-plan-1',
    build: () => ({ nodes: [createBackupPlanNode()], edges: [] }),
  },
  {
    ruleId: 'cloudwatch_alarm_exists',
    targetNodeId: 'i-123',
    build: () => ({
      nodes: [createCloudWatchAlarmNode(), createEc2Node()],
      edges: [createEdge('alarm-1', 'i-123', 'MONITORS')],
    }),
  },
  {
    ruleId: 'cloudwatch_alarm_actions',
    targetNodeId: 'alarm-1',
    build: () => ({ nodes: [createCloudWatchAlarmNode()], edges: [] }),
  },
  {
    ruleId: 'lambda_dlq_configured',
    targetNodeId: 'arn:aws:lambda:eu-west-1:123456789012:function:worker',
    build: () => ({ nodes: [createLambdaNode()], edges: [] }),
  },
  {
    ruleId: 'elb_cross_zone',
    targetNodeId: 'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/main-alb/123456',
    build: () => ({ nodes: [createElbNode()], edges: [] }),
  },
  {
    ruleId: 'elb_health_check',
    targetNodeId: 'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/main-alb/123456',
    build: () => ({ nodes: [createElbNode()], edges: [] }),
  },
  {
    ruleId: 'elb_multi_az',
    targetNodeId: 'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/main-alb/123456',
    build: () => ({ nodes: [createElbNode()], edges: [] }),
  },
  {
    ruleId: 'sqs_dlq_configured',
    targetNodeId: 'arn:aws:sqs:eu-west-1:123456789012:jobs',
    build: () => ({ nodes: [createSqsNode()], edges: [] }),
  },
  {
    ruleId: 'eks_multi_az',
    targetNodeId: 'eks-main',
    build: () => ({
      nodes: [createEksNode(), createSubnetNode('subnet-a', 'eu-west-1a'), createSubnetNode('subnet-b', 'eu-west-1b')],
      edges: [],
    }),
  },
  {
    ruleId: 'vpc_multi_az_subnets',
    targetNodeId: 'vpc-1',
    build: () => ({
      nodes: [createVpcNode(), createSubnetNode('subnet-a', 'eu-west-1a'), createSubnetNode('subnet-b', 'eu-west-1b')],
      edges: [createEdge('vpc-1', 'subnet-a', 'CONTAINS'), createEdge('vpc-1', 'subnet-b', 'CONTAINS')],
    }),
  },
  {
    ruleId: 'vpc_nat_redundancy',
    targetNodeId: 'vpc-1',
    build: () => ({
      nodes: [createVpcNode(), createNatGatewayNode('nat-1'), createNatGatewayNode('nat-2')],
      edges: [createEdge('vpc-1', 'nat-1', 'CONTAINS'), createEdge('vpc-1', 'nat-2', 'CONTAINS')],
    }),
  },
  {
    ruleId: 'dynamodb_global_table',
    targetNodeId: 'arn:aws:dynamodb:eu-west-1:123456789012:table/app-table',
    build: () => ({ nodes: [createDynamoNode()], edges: [] }),
  },
] as const;

const failCases = [
  { ruleId: 'rds_replica_healthy', targetNodeId: 'rds-primary', build: () => ({ nodes: [createRdsNode('rds-primary', { readReplicaDBInstanceIdentifiers: [] })], edges: [] }) },
  { ruleId: 'rds_multi_az_active', targetNodeId: 'rds-primary', build: () => ({ nodes: [createRdsNode('rds-primary', { multiAZ: false })], edges: [] }) },
  { ruleId: 'rds_backup_configured', targetNodeId: 'rds-primary', build: () => ({ nodes: [createRdsNode('rds-primary', { backupRetentionPeriod: 0, backupRetentionDays: 0 })], edges: [] }) },
  { ruleId: 's3_versioning_enabled', targetNodeId: 'arn:aws:s3:::primary-bucket', build: () => ({ nodes: [createS3Node(undefined, { versioningStatus: 'Suspended' })], edges: [] }) },
  { ruleId: 's3_replication_active', targetNodeId: 'arn:aws:s3:::primary-bucket', build: () => ({ nodes: [createS3Node(undefined, { replicationRules: [{ status: 'Disabled' }] })], edges: [] }) },
  { ruleId: 'ec2_in_asg', targetNodeId: 'i-123', build: () => ({ nodes: [createEc2Node()], edges: [] }) },
  { ruleId: 'ec2_multi_az', targetNodeId: 'i-123', build: () => ({ nodes: [createAsgNode(), createEc2Node(), createEc2Node('i-456', 'eu-west-1a')], edges: [createEdge('asg-main', 'i-123', 'CONTAINS'), createEdge('asg-main', 'i-456', 'CONTAINS')] }) },
  { ruleId: 'elasticache_failover', targetNodeId: 'cache-main', build: () => ({ nodes: [createElastiCacheNode('cache-main', { automaticFailoverStatus: 'disabled' })], edges: [] }) },
  { ruleId: 'dynamodb_pitr_enabled', targetNodeId: 'arn:aws:dynamodb:eu-west-1:123456789012:table/app-table', build: () => ({ nodes: [createDynamoNode(undefined, { pointInTimeRecoveryEnabled: false })], edges: [] }) },
  { ruleId: 'backup_retention_adequate', targetNodeId: 'rds-primary', build: () => ({ nodes: [createRdsNode('rds-primary', { backupRetentionPeriod: 0, backupRetentionDays: 0 })], edges: [] }) },
  { ruleId: 'cross_region_exists', targetNodeId: 'arn:aws:s3:::primary-bucket', build: () => ({ nodes: [createS3Node(), createS3Node('arn:aws:s3:::secondary-bucket', { bucketName: 'secondary-bucket' }, 'eu-west-1')], edges: [createEdge('arn:aws:s3:::primary-bucket', 'arn:aws:s3:::secondary-bucket', 'REPLICATES_TO')] }) },
  { ruleId: 'route53_health_check', targetNodeId: 'record-primary', build: () => ({ nodes: [createRoute53RecordNode('record-primary', 'PRIMARY', { healthCheckId: undefined })], edges: [] }) },
  { ruleId: 'route53_failover_configured', targetNodeId: 'Z123ZONE', build: () => ({ nodes: [createRoute53ZoneNode(), createRoute53RecordNode('record-primary', 'PRIMARY')], edges: [createEdge('Z123ZONE', 'record-primary', 'CONTAINS')] }) },
  { ruleId: 'route53_ttl_appropriate', targetNodeId: 'record-primary', build: () => ({ nodes: [createRoute53RecordNode('record-primary', 'PRIMARY', { ttl: 400 })], edges: [] }) },
  { ruleId: 'backup_plan_exists', targetNodeId: 'rds-primary', build: () => ({ nodes: [createRdsNode()], edges: [] }) },
  { ruleId: 'backup_recent', targetNodeId: 'rds-primary', build: () => ({ nodes: [createBackupPlanNode({ protectedResources: [{ resourceArn: 'arn:aws:rds:eu-west-1:123456789012:db:rds-primary', resourceType: 'RDS', lastBackupTime: hoursAgo(48) }] }), createRdsNode()], edges: [createEdge('backup-plan-1', 'rds-primary', 'BACKS_UP_TO')] }) },
  { ruleId: 'backup_lifecycle_configured', targetNodeId: 'backup-plan-1', build: () => ({ nodes: [createBackupPlanNode({ recoveryPoints: [{ recoveryPointArn: 'rp-1', lifecycle: {} }] })], edges: [] }) },
  { ruleId: 'cloudwatch_alarm_exists', targetNodeId: 'i-123', build: () => ({ nodes: [createEc2Node()], edges: [] }) },
  { ruleId: 'cloudwatch_alarm_actions', targetNodeId: 'alarm-1', build: () => ({ nodes: [createCloudWatchAlarmNode({ actionsEnabled: false, alarmActions: [] })], edges: [] }) },
  { ruleId: 'lambda_dlq_configured', targetNodeId: 'arn:aws:lambda:eu-west-1:123456789012:function:worker', build: () => ({ nodes: [createLambdaNode(undefined, { deadLetterConfig: undefined, deadLetterTargetArn: undefined })], edges: [] }) },
  { ruleId: 'elb_cross_zone', targetNodeId: 'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/main-alb/123456', build: () => ({ nodes: [createElbNode(undefined, { crossZoneLoadBalancing: false, loadBalancingCrossZoneEnabled: false })], edges: [] }) },
  { ruleId: 'elb_health_check', targetNodeId: 'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/main-alb/123456', build: () => ({ nodes: [createElbNode(undefined, { healthCheck: {} })], edges: [] }) },
  { ruleId: 'elb_multi_az', targetNodeId: 'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/main-alb/123456', build: () => ({ nodes: [createElbNode(undefined, { availabilityZones: ['eu-west-1a'] })], edges: [] }) },
  { ruleId: 'sqs_dlq_configured', targetNodeId: 'arn:aws:sqs:eu-west-1:123456789012:jobs', build: () => ({ nodes: [createSqsNode(undefined, { redrivePolicy: undefined })], edges: [] }) },
  { ruleId: 'eks_multi_az', targetNodeId: 'eks-main', build: () => ({ nodes: [createEksNode('eks-main', ['subnet-a']), createSubnetNode('subnet-a', 'eu-west-1a')], edges: [] }) },
  { ruleId: 'vpc_multi_az_subnets', targetNodeId: 'vpc-1', build: () => ({ nodes: [createVpcNode(), createSubnetNode('subnet-a', 'eu-west-1a')], edges: [createEdge('vpc-1', 'subnet-a', 'CONTAINS')] }) },
  { ruleId: 'vpc_nat_redundancy', targetNodeId: 'vpc-1', build: () => ({ nodes: [createVpcNode()], edges: [] }) },
  { ruleId: 'dynamodb_global_table', targetNodeId: 'arn:aws:dynamodb:eu-west-1:123456789012:table/app-table', build: () => ({ nodes: [createDynamoNode(undefined, { globalTableVersion: undefined, replicas: [], globalTable: false })], edges: [] }) },
] as const;

describe('DR validation rules', () => {
  it('assigns a DR category to every validation rule and removes encryption_at_rest', () => {
    const allowedCategories = new Set([
      'backup',
      'redundancy',
      'failover',
      'detection',
      'recovery',
      'replication',
    ]);

    expect(allValidationRules.some((rule) => rule.id === 'encryption_at_rest')).toBe(false);
    for (const rule of allValidationRules) {
      expect(rule.category).toBeDefined();
      expect(allowedCategories.has(rule.category)).toBe(true);
    }
  });

  for (const testCase of passCases) {
    it(`${testCase.ruleId} passes`, () => {
      const scenario = testCase.build();
      const result = executeRule(testCase.ruleId, testCase.targetNodeId, scenario.nodes, scenario.edges);
      expect(result.status).toBe('pass');
    });
  }

  for (const testCase of failCases) {
    it(`${testCase.ruleId} fails`, () => {
      const scenario = testCase.build();
      const result = executeRule(testCase.ruleId, testCase.targetNodeId, scenario.nodes, scenario.edges);
      expect(result.status).toBe('fail');
    });
  }

  it('route53_ttl_appropriate warns when TTL is above 60 seconds but below the fail threshold', () => {
    const result = executeRule(
      'route53_ttl_appropriate',
      'record-primary',
      [createRoute53RecordNode('record-primary', 'PRIMARY', { ttl: 120 })],
    );
    expect(result.status).toBe('warn');
  });

  it('backup_recent warns when the last backup is older than 13 hours but newer than 25 hours', () => {
    const backupPlan = createBackupPlanNode({
      protectedResources: [
        {
          resourceArn: 'arn:aws:rds:eu-west-1:123456789012:db:rds-primary',
          resourceType: 'RDS',
          lastBackupTime: hoursAgo(14),
        },
      ],
    });
    const result = executeRule(
      'backup_recent',
      'rds-primary',
      [backupPlan, createRdsNode()],
      [createEdge('backup-plan-1', 'rds-primary', 'BACKS_UP_TO')],
    );
    expect(result.status).toBe('warn');
  });

  it('vpc_nat_redundancy warns when exactly one NAT gateway is present', () => {
    const result = executeRule(
      'vpc_nat_redundancy',
      'vpc-1',
      [createVpcNode(), createNatGatewayNode('nat-1')],
      [createEdge('vpc-1', 'nat-1', 'CONTAINS')],
    );
    expect(result.status).toBe('warn');
  });
});

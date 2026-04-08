import type { SupportedService } from './options.js';

export interface IamPolicyDocument {
  readonly Version: '2012-10-17';
  readonly Statement: readonly IamPolicyStatement[];
}

export interface IamPolicyStatement {
  readonly Sid: string;
  readonly Effect: 'Allow';
  readonly Action: readonly string[];
  readonly Resource: '*';
}

const SERVICE_POLICY: Readonly<Record<SupportedService | 'sts', IamPolicyStatement>> = {
  ec2: {
    Sid: 'StrongholdReadOnlyEC2',
    Effect: 'Allow',
    Action: [
      'ec2:DescribeInstances',
      'ec2:DescribeVpcs',
      'ec2:DescribeSubnets',
      'ec2:DescribeSecurityGroups',
      'ec2:DescribeNatGateways',
      'ec2:DescribeRegions',
      'autoscaling:DescribeAutoScalingGroups',
    ],
    Resource: '*',
  },
  rds: {
    Sid: 'StrongholdReadOnlyRDS',
    Effect: 'Allow',
    Action: [
      'rds:DescribeDBInstances',
      'rds:DescribeDBClusters',
      'rds:DescribeGlobalClusters',
      'rds:ListTagsForResource',
    ],
    Resource: '*',
  },
  s3: {
    Sid: 'StrongholdReadOnlyS3',
    Effect: 'Allow',
    Action: [
      's3:ListAllMyBuckets',
      's3:GetBucketLocation',
      's3:GetBucketTagging',
      's3:GetBucketVersioning',
      's3:GetBucketReplication',
      's3:GetEncryptionConfiguration',
    ],
    Resource: '*',
  },
  lambda: {
    Sid: 'StrongholdReadOnlyLambda',
    Effect: 'Allow',
    Action: [
      'lambda:ListFunctions',
      'lambda:GetFunctionConfiguration',
      'lambda:ListEventSourceMappings',
      'lambda:ListTags',
    ],
    Resource: '*',
  },
  dynamodb: {
    Sid: 'StrongholdReadOnlyDynamoDB',
    Effect: 'Allow',
    Action: [
      'dynamodb:ListTables',
      'dynamodb:DescribeTable',
      'dynamodb:DescribeContinuousBackups',
      'dynamodb:DescribeGlobalTable',
      'dynamodb:ListTagsOfResource',
    ],
    Resource: '*',
  },
  elasticache: {
    Sid: 'StrongholdReadOnlyElastiCache',
    Effect: 'Allow',
    Action: [
      'elasticache:DescribeCacheClusters',
      'elasticache:DescribeReplicationGroups',
      'elasticache:ListTagsForResource',
    ],
    Resource: '*',
  },
  sqs: {
    Sid: 'StrongholdReadOnlySQS',
    Effect: 'Allow',
    Action: [
      'sqs:ListQueues',
      'sqs:GetQueueAttributes',
      'sqs:ListQueueTags',
    ],
    Resource: '*',
  },
  sns: {
    Sid: 'StrongholdReadOnlySNS',
    Effect: 'Allow',
    Action: [
      'sns:ListTopics',
      'sns:GetTopicAttributes',
      'sns:ListSubscriptionsByTopic',
      'sns:ListTagsForResource',
    ],
    Resource: '*',
  },
  elb: {
    Sid: 'StrongholdReadOnlyELB',
    Effect: 'Allow',
    Action: [
      'elasticloadbalancing:DescribeLoadBalancers',
      'elasticloadbalancing:DescribeTargetGroups',
      'elasticloadbalancing:DescribeTargetHealth',
      'elasticloadbalancing:DescribeLoadBalancerAttributes',
      'elasticloadbalancing:DescribeTags',
    ],
    Resource: '*',
  },
  eks: {
    Sid: 'StrongholdReadOnlyEKS',
    Effect: 'Allow',
    Action: [
      'eks:ListClusters',
      'eks:DescribeCluster',
      'eks:ListNodegroups',
      'eks:DescribeNodegroup',
      'eks:ListTagsForResource',
    ],
    Resource: '*',
  },
  efs: {
    Sid: 'StrongholdReadOnlyEFS',
    Effect: 'Allow',
    Action: [
      'elasticfilesystem:DescribeFileSystems',
      'elasticfilesystem:DescribeMountTargets',
      'elasticfilesystem:DescribeReplicationConfigurations',
      'elasticfilesystem:DescribeBackupPolicy',
      'elasticfilesystem:DescribeTags',
    ],
    Resource: '*',
  },
  route53: {
    Sid: 'StrongholdReadOnlyRoute53',
    Effect: 'Allow',
    Action: [
      'route53:ListHostedZones',
      'route53:ListResourceRecordSets',
      'route53:ListTagsForResource',
    ],
    Resource: '*',
  },
  backup: {
    Sid: 'StrongholdReadOnlyBackup',
    Effect: 'Allow',
    Action: [
      'backup:ListBackupPlans',
      'backup:ListBackupSelections',
      'backup:ListBackupVaults',
      'backup:ListProtectedResources',
      'backup:ListRecoveryPointsByBackupVault',
      'backup:GetBackupPlan',
      'backup:GetBackupSelection',
      'backup:ListTags',
    ],
    Resource: '*',
  },
  cloudwatch: {
    Sid: 'StrongholdReadOnlyCloudWatch',
    Effect: 'Allow',
    Action: ['cloudwatch:DescribeAlarms', 'cloudwatch:ListTagsForResource'],
    Resource: '*',
  },
  aurora: {
    Sid: 'StrongholdReadOnlyAurora',
    Effect: 'Allow',
    Action: [
      'rds:DescribeDBClusters',
      'rds:DescribeDBInstances',
      'rds:DescribeGlobalClusters',
      'rds:ListTagsForResource',
    ],
    Resource: '*',
  },
  vpc: {
    Sid: 'StrongholdReadOnlyVPC',
    Effect: 'Allow',
    Action: [
      'ec2:DescribeVpcs',
      'ec2:DescribeSubnets',
      'ec2:DescribeSecurityGroups',
      'ec2:DescribeNatGateways',
    ],
    Resource: '*',
  },
  sts: {
    Sid: 'StrongholdReadOnlySTS',
    Effect: 'Allow',
    Action: ['sts:GetCallerIdentity'],
    Resource: '*',
  },
};

const DEFAULT_POLICY_SERVICES: readonly SupportedService[] = [
  'ec2',
  'rds',
  's3',
  'lambda',
  'dynamodb',
  'elasticache',
  'sqs',
  'sns',
  'elb',
  'eks',
  'efs',
  'route53',
  'backup',
  'cloudwatch',
  'aurora',
];

export function buildIamPolicy(
  services?: readonly SupportedService[],
): IamPolicyDocument {
  const selectedServices = services && services.length > 0 ? services : DEFAULT_POLICY_SERVICES;
  const statements = selectedServices.map((service) => SERVICE_POLICY[service]);
  return {
    Version: '2012-10-17',
    Statement: [...statements, SERVICE_POLICY.sts],
  };
}

export function renderIamPolicyJson(document: IamPolicyDocument): string {
  return JSON.stringify(document, null, 2);
}

export function renderIamPolicyTerraform(document: IamPolicyDocument): string {
  return `# Stronghold IAM policy
# Generated by stronghold-dr v1.0.0
resource "aws_iam_policy" "stronghold_read_only" {
  name        = "stronghold-read-only"
  description = "Read-only permissions required by Stronghold CLI"

  policy = <<POLICY
${JSON.stringify(document, null, 2)}
POLICY
}
`;
}

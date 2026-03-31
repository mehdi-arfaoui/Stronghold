import { getMetadata, readString } from '../graph/analysis-helpers.js';
import type { InfraNode } from './validation-types.js';

function normalizeReference(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

function addReference(target: Set<string>, value: string | null): void {
  if (!value) return;
  const normalized = normalizeReference(value);
  if (!normalized) return;
  target.add(normalized);

  if (normalized.startsWith('arn:')) {
    const lastColon = normalized.split(':').pop();
    const lastSlash = normalized.split('/').pop();
    if (lastColon) target.add(lastColon);
    if (lastSlash) target.add(lastSlash);
    const loadBalancerMarker = 'loadbalancer/';
    const loadBalancerIndex = normalized.indexOf(loadBalancerMarker);
    if (loadBalancerIndex >= 0) {
      target.add(normalized.slice(loadBalancerIndex + loadBalancerMarker.length));
    }
  }

  if (normalized.includes('.')) {
    target.add(normalized.replace(/^dualstack\./, ''));
  }
}

export function normalizeType(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

export function collectNodeKinds(node: InfraNode): ReadonlySet<string> {
  const metadata = getMetadata(node);
  const kinds = new Set<string>();

  for (const value of [node.type, metadata.sourceType, metadata.subType, metadata.awsService]) {
    const normalized = normalizeType(readString(value) ?? '');
    if (!normalized) continue;

    kinds.add(normalized);
    const withoutPrefix = normalized.replace(/^(aws|azure|gcp)-/, '');
    kinds.add(withoutPrefix);

    if (withoutPrefix.includes('rds')) {
      kinds.add('rds');
      kinds.add('rds-instance');
    }
    if (withoutPrefix.includes('aurora')) {
      kinds.add('aurora');
      if (withoutPrefix.includes('cluster')) kinds.add('aurora-cluster');
      if (withoutPrefix.includes('instance')) kinds.add('aurora-instance');
      if (withoutPrefix.includes('global')) kinds.add('aurora-global');
    }
    if (withoutPrefix.includes('s3')) {
      kinds.add('s3');
      kinds.add('s3-bucket');
    }
    if (withoutPrefix.includes('efs')) {
      kinds.add('efs');
      if (withoutPrefix.includes('file-system')) kinds.add('efs-filesystem');
      if (withoutPrefix.includes('mount-target')) kinds.add('efs-mount-target');
    }
    if (withoutPrefix.includes('ec2')) {
      kinds.add('ec2');
      kinds.add('ec2-instance');
    }
    if (withoutPrefix.includes('elasticache')) kinds.add('elasticache');
    if (withoutPrefix.includes('dynamodb')) kinds.add('dynamodb');
    if (withoutPrefix.includes('lambda')) kinds.add('lambda');
    if (withoutPrefix.includes('sqs')) kinds.add('sqs');
    if (withoutPrefix.includes('eks')) kinds.add('eks');
    if (withoutPrefix.includes('vpc')) kinds.add('vpc');
    if (withoutPrefix.includes('subnet')) kinds.add('subnet');
    if (
      withoutPrefix.includes('elb') ||
      withoutPrefix.includes('alb') ||
      withoutPrefix.includes('nlb') ||
      withoutPrefix.includes('load-balancer')
    ) {
      kinds.add('elb');
    }
    if (withoutPrefix.includes('asg') || withoutPrefix.includes('auto-scaling')) {
      kinds.add('asg');
      kinds.add('auto-scaling');
    }
    if (withoutPrefix.includes('route53') && withoutPrefix.includes('hosted-zone')) {
      kinds.add('route53-hosted-zone');
    }
    if (withoutPrefix.includes('route53') && withoutPrefix.includes('record')) {
      kinds.add('route53-record');
    }
    if (withoutPrefix.includes('backup-plan')) kinds.add('backup-plan');
    if (withoutPrefix.includes('backup-vault')) kinds.add('backup-vault');
    if (withoutPrefix.includes('cloudwatch') && withoutPrefix.includes('alarm')) {
      kinds.add('cloudwatch-alarm');
    }
    if (withoutPrefix.includes('nat-gateway')) kinds.add('nat-gateway');
  }

  return kinds;
}

export function hasNodeKind(node: InfraNode, expected: readonly string[]): boolean {
  const kinds = collectNodeKinds(node);
  return expected.some((target) => kinds.has(normalizeType(target)));
}

export function collectNodeReferences(node: InfraNode): ReadonlySet<string> {
  const metadata = getMetadata(node);
  const references = new Set<string>();
  const keys = [
    'dbIdentifier',
    'dbArn',
    'dbClusterIdentifier',
    'dbClusterArn',
    'dbInstanceIdentifier',
    'dbInstanceArn',
    'globalClusterIdentifier',
    'bucketArn',
    'bucketName',
    'tableArn',
    'tableName',
    'functionArn',
    'functionName',
    'queueArn',
    'queueUrl',
    'queueName',
    'topicArn',
    'topicName',
    'loadBalancerArn',
    'loadBalancerName',
    'loadBalancerResourceName',
    'fileSystemId',
    'fileSystemArn',
    'mountTargetId',
    'dnsName',
    'resourceArn',
    'natGatewayId',
    'vpcId',
    'subnetId',
    'clusterName',
  ] as const;

  addReference(references, node.id);
  addReference(references, node.name);
  for (const key of keys) {
    addReference(references, readString(metadata[key]));
  }

  if (Array.isArray(metadata.subnetIds)) {
    for (const subnetId of metadata.subnetIds) {
      addReference(references, readString(subnetId));
    }
  }

  return references;
}

import { AWS_PRICING_ESTIMATES_EU_WEST_3 } from '../../../constants/dr-financial-reference-data.js';
import {
  readPositiveNumberFromKeys,
  readStringFromKeys,
} from '../metadataUtils.js';
import type { CloudServiceResolution } from '../types.js';

export const AWS_DR_PRICING_ESTIMATES = {
  region: 'eu-west-3',
  ...AWS_PRICING_ESTIMATES_EU_WEST_3,
} as const;

function normalizeKey(value: string | null): string {
  return String(value || '').trim().toLowerCase();
}

export function lookupAwsEstimatedMonthlyUsd(resolution: CloudServiceResolution): number | null {
  const metadata = resolution.metadata;
  const kind = resolution.kind;

  if (kind === 'ec2') {
    const instanceType = normalizeKey(
      readStringFromKeys(metadata, ['instanceType', 'instance_type', 'vmSize']),
    );
    return (
      AWS_DR_PRICING_ESTIMATES.ec2[
        (instanceType as keyof typeof AWS_DR_PRICING_ESTIMATES.ec2) || 'default'
      ] ?? AWS_DR_PRICING_ESTIMATES.ec2.default
    );
  }

  if (kind === 'rds') {
    const instanceClass = normalizeKey(
      readStringFromKeys(metadata, ['dbInstanceClass', 'instanceClass', 'instanceType']),
    );
    return (
      AWS_DR_PRICING_ESTIMATES.rds[
        (instanceClass as keyof typeof AWS_DR_PRICING_ESTIMATES.rds) || 'default'
      ] ?? AWS_DR_PRICING_ESTIMATES.rds.default
    );
  }

  if (kind === 'elasticache') {
    const cacheNodeType = normalizeKey(
      readStringFromKeys(metadata, ['cacheNodeType', 'instanceType']),
    );
    return (
      AWS_DR_PRICING_ESTIMATES.elasticache[
        (cacheNodeType as keyof typeof AWS_DR_PRICING_ESTIMATES.elasticache) || 'default'
      ] ?? AWS_DR_PRICING_ESTIMATES.elasticache.default
    );
  }

  if (kind === 'lambda') return AWS_DR_PRICING_ESTIMATES.lambda.default;
  if (kind === 'dynamodb') return AWS_DR_PRICING_ESTIMATES.dynamodb.default;
  if (kind === 'sqs') return AWS_DR_PRICING_ESTIMATES.sqs.default;
  if (kind === 'sns') return AWS_DR_PRICING_ESTIMATES.sns.default;

  if (kind === 's3') {
    const bytes = readPositiveNumberFromKeys(metadata, ['sizeBytes', 'tableSizeBytes']);
    const storageGb = readPositiveNumberFromKeys(metadata, [
      'storageGB',
      'storageGb',
      'sizeGB',
      'sizeGb',
    ]);
    const estimatedGb = storageGb ?? (bytes != null ? bytes / (1024 ** 3) : null);
    const base = AWS_DR_PRICING_ESTIMATES.s3.default;
    if (estimatedGb == null) return base;
    const estimatedPerTb = (estimatedGb / 1024) * 23;
    return Math.max(base, Number(estimatedPerTb.toFixed(2)));
  }

  return null;
}

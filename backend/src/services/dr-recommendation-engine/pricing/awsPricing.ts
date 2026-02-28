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

  if (kind === 'alb') {
    const estimatedLcu =
      readPositiveNumberFromKeys(metadata, ['estimatedLcu', 'lcu', 'estimatedLCU']) ?? 1;
    const total =
      AWS_DR_PRICING_ESTIMATES.alb.base_monthly +
      estimatedLcu * AWS_DR_PRICING_ESTIMATES.alb.per_lcu;
    return Number(total.toFixed(2));
  }

  if (kind === 'lambda') {
    const memoryMb = readPositiveNumberFromKeys(metadata, [
      'memorySize',
      'memorySizeMb',
      'memoryMb',
    ]) ?? 128;
    const monthlyInvocations =
      readPositiveNumberFromKeys(metadata, [
        'estimatedMonthlyInvocations',
        'monthlyInvocations',
        'estimatedInvocations',
      ]) ?? 1_000_000;
    const pricingKey =
      memoryMb >= 1024
        ? 'per_million_invocations_1024mb'
        : memoryMb >= 512
          ? 'per_million_invocations_512mb'
          : 'per_million_invocations_128mb';
    const pricePerMillion = AWS_DR_PRICING_ESTIMATES.lambda[pricingKey];
    return Number(((monthlyInvocations / 1_000_000) * pricePerMillion).toFixed(2));
  }

  if (kind === 'dynamodb') {
    const wcu = readPositiveNumberFromKeys(metadata, ['wcu', 'writeCapacityUnits']) ?? 10;
    const rcu = readPositiveNumberFromKeys(metadata, ['rcu', 'readCapacityUnits']) ?? 25;
    const total =
      wcu * AWS_DR_PRICING_ESTIMATES.dynamodb.per_wcu_month +
      rcu * AWS_DR_PRICING_ESTIMATES.dynamodb.per_rcu_month;
    return Number(Math.max(AWS_DR_PRICING_ESTIMATES.dynamodb.default, total).toFixed(2));
  }

  if (kind === 'sqs') {
    const monthlyRequests =
      readPositiveNumberFromKeys(metadata, [
        'estimatedMonthlyRequests',
        'monthlyRequests',
        'estimatedRequests',
      ]) ?? 1_000_000;
    const total =
      (monthlyRequests / 1_000_000) * AWS_DR_PRICING_ESTIMATES.sqs.per_million_requests;
    return Number(Math.max(AWS_DR_PRICING_ESTIMATES.sqs.default, total).toFixed(2));
  }

  if (kind === 'sns') {
    const monthlyNotifications =
      readPositiveNumberFromKeys(metadata, [
        'estimatedMonthlyNotifications',
        'monthlyNotifications',
        'estimatedNotifications',
      ]) ?? 1_000_000;
    const total =
      (monthlyNotifications / 1_000_000) *
      AWS_DR_PRICING_ESTIMATES.sns.per_million_notifications;
    return Number(Math.max(AWS_DR_PRICING_ESTIMATES.sns.default, total).toFixed(2));
  }

  if (kind === 's3') {
    const bytes = readPositiveNumberFromKeys(metadata, ['sizeBytes', 'tableSizeBytes']);
    const storageGb = readPositiveNumberFromKeys(metadata, [
      'storageGB',
      'storageGb',
      'sizeGB',
      'sizeGb',
      'estimatedStorageGB',
    ]);
    const estimatedGb = storageGb ?? (bytes != null ? bytes / (1024 ** 3) : null);
    const base = AWS_DR_PRICING_ESTIMATES.s3.default;
    if (estimatedGb == null) return base;
    const total = estimatedGb * AWS_DR_PRICING_ESTIMATES.s3.per_gb_month;
    return Number(Math.max(base, total).toFixed(2));
  }

  return null;
}

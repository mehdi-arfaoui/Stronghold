import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2';

import type { DiscoveryCredentials, DiscoveredResource } from '../../types/discovery.js';
import type {
  CloudProviderAdapter,
  DiscoveryProgress,
  ScanOptions,
  ScanOutput,
} from '../provider-interface.js';
import {
  computeRetryDelayMs,
  DEFAULT_AWS_RETRY_POLICY,
  getAwsErrorMessage,
  getAwsFailureType,
  isAwsThrottlingError,
  type AwsRetryPolicy,
} from './aws-retry-utils.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from './aws-client-factory.js';
import { processWithConcurrencyLimit, sleep } from './scan-utils.js';
import { scanAuroraClusters } from './services/aurora-scanner.js';
import { scanAutoScalingGroups } from './services/auto-scaling-scanner.js';
import { scanBackupResources } from './services/backup-scanner.js';
import { scanCloudWatchAlarms } from './services/cloudwatch-scanner.js';
import { scanDynamoDbTables } from './services/dynamodb-scanner.js';
import {
  scanEc2Instances,
  scanNatGateways,
  scanSecurityGroups,
  scanSubnets,
  scanVpcs,
} from './services/ec2-scanner.js';
import { scanEfsFileSystems } from './services/efs-scanner.js';
import { scanEcsServices } from './services/ecs-scanner.js';
import { scanEksClusters } from './services/eks-scanner.js';
import { scanElastiCacheClusters } from './services/elasticache-scanner.js';
import { scanLoadBalancers } from './services/elb-scanner.js';
import { scanLambdaFunctions } from './services/lambda-scanner.js';
import { scanRdsInstances } from './services/rds-scanner.js';
import { scanRoute53HostedZones } from './services/route53-scanner.js';
import { scanS3Buckets } from './services/s3-scanner.js';
import { scanSnsTopics } from './services/sns-scanner.js';
import { scanSqsQueues } from './services/sqs-scanner.js';

export const DEFAULT_SCANNER_CONCURRENCY = 5;
export const MIN_SCANNER_CONCURRENCY = 1;
export const MAX_SCANNER_CONCURRENCY = 16;
export const DEFAULT_SCANNER_TIMEOUT_MS = 60_000;
export const MIN_SCANNER_TIMEOUT_MS = 10_000;
export const MAX_SCANNER_TIMEOUT_MS = 300_000;
export {
  computeRetryDelayMs,
  DEFAULT_AWS_RETRY_POLICY,
  isAwsThrottlingError,
  type AwsRetryPolicy,
} from './aws-retry-utils.js';

const SERVICE_SCANNERS = [
  'EC2',
  'RDS',
  'Aurora',
  'EFS',
  'Lambda',
  'ECS',
  'ElastiCache',
  'DynamoDB',
  'SQS',
  'SNS',
  'ELB',
  'EKS',
  'AutoScaling',
  'VPC',
  'NATGateway',
  'Backup',
  'CloudWatch',
  'Route53',
  'S3',
] as const;

export type AwsServiceScannerOutput =
  | DiscoveredResource[]
  | { resources: DiscoveredResource[]; warnings: string[] };

export type AwsServiceScanner = (
  options: AwsClientOptions,
) => Promise<AwsServiceScannerOutput>;

export interface AwsServiceScannerDefinition {
  readonly name: string;
  readonly global?: boolean;
  readonly scan: AwsServiceScanner;
}

export interface AwsServiceScanResult {
  readonly scannerName: string;
  readonly region: string;
  readonly durationMs: number;
  readonly retryCount: number;
  readonly finalStatus: 'success' | 'failed';
  readonly failureType?: string;
  readonly resourceCount: number;
}

export interface AwsServiceScannerCapture {
  readonly scannerResult: AwsServiceScanResult;
  readonly resources: readonly DiscoveredResource[];
  readonly warnings: readonly string[];
}

export interface AwsRegionScanResult {
  readonly region: string;
  readonly durationMs: number;
  readonly resources: readonly DiscoveredResource[];
  readonly warnings: readonly string[];
  readonly scannerResults: readonly AwsServiceScanResult[];
  readonly scannerOutputs?: readonly AwsServiceScannerCapture[];
}

export interface AwsScanSummary {
  readonly totalDurationMs: number;
  readonly scannerConcurrency: number;
  readonly scannerTimeoutMs: number;
  readonly scannedRegions: readonly string[];
  readonly discoveredResourceCount: number;
  readonly successfulScanners: number;
  readonly failedScanners: number;
  readonly scannerResults: readonly AwsServiceScanResult[];
}

export interface ScanAwsRegionOptions {
  readonly includeGlobalServices: boolean;
  readonly services?: readonly string[];
  readonly onProgress?: ScanOptions['onProgress'];
  readonly scannerConcurrency?: number;
  readonly scannerTimeoutMs?: number;
  readonly retryPolicy?: AwsRetryPolicy;
  readonly random?: () => number;
  readonly scanners?: readonly AwsServiceScannerDefinition[];
}

function buildAwsServiceScanners(
  includeGlobalServices: boolean,
): readonly AwsServiceScannerDefinition[] {
  return [
    { name: 'EC2', scan: scanEc2Instances },
    { name: 'RDS', scan: scanRdsInstances },
    {
      name: 'Aurora',
      scan: (options) =>
        scanAuroraClusters(options, {
          includeGlobalClusters: includeGlobalServices,
        }),
    },
    { name: 'EFS', scan: scanEfsFileSystems },
    { name: 'Lambda', scan: scanLambdaFunctions },
    { name: 'ECS', scan: scanEcsServices },
    { name: 'ElastiCache', scan: scanElastiCacheClusters },
    { name: 'DynamoDB', scan: scanDynamoDbTables },
    { name: 'SQS', scan: scanSqsQueues },
    { name: 'SNS', scan: scanSnsTopics },
    { name: 'ELB', scan: scanLoadBalancers },
    { name: 'EKS', scan: scanEksClusters },
    { name: 'AutoScaling', scan: scanAutoScalingGroups },
    { name: 'VPC', scan: scanVpcs },
    { name: 'NATGateway', scan: scanNatGateways },
    { name: 'Backup', scan: scanBackupResources },
    { name: 'CloudWatch', scan: scanCloudWatchAlarms },
    { name: 'Subnets', scan: scanSubnets },
    { name: 'SecurityGroups', scan: scanSecurityGroups },
    { name: 'S3', global: true, scan: scanS3Buckets },
    { name: 'Route53', global: true, scan: scanRoute53HostedZones },
  ];
}

async function getAllAwsRegions(credentials: DiscoveryCredentials): Promise<string[]> {
  if (!credentials.aws) {
    return [];
  }

  const ec2 = createAwsClient(EC2Client, {
    region: 'us-east-1',
    credentials: credentials.aws,
    maxAttempts: 1,
  });
  const { Regions } = await ec2.send(new DescribeRegionsCommand({}), getAwsCommandOptions({}));
  return Regions?.map((entry) => entry.RegionName).filter((name): name is string => Boolean(name)) ?? [];
}

function emitProgress(
  onProgress: ScanOptions['onProgress'],
  progress: DiscoveryProgress,
): void {
  onProgress?.(progress);
}

function normalizeRequestedServices(
  services?: readonly string[],
): ReadonlySet<string> | null {
  if (!services || services.length === 0) {
    return null;
  }

  const selected = new Set<string>();
  for (const service of services) {
    const normalized = service.trim().toLowerCase();
    if (normalized === 'ec2') {
      selected.add('EC2');
      selected.add('AutoScaling');
      continue;
    }
    if (normalized === 'rds') {
      selected.add('RDS');
      continue;
    }
    if (normalized === 'aurora') {
      selected.add('Aurora');
      continue;
    }
    if (normalized === 's3') {
      selected.add('S3');
      continue;
    }
    if (normalized === 'lambda') {
      selected.add('Lambda');
      continue;
    }
    if (normalized === 'ecs' || normalized === 'fargate') {
      selected.add('ECS');
      continue;
    }
    if (normalized === 'dynamodb') {
      selected.add('DynamoDB');
      continue;
    }
    if (normalized === 'elasticache') {
      selected.add('ElastiCache');
      continue;
    }
    if (normalized === 'sqs') {
      selected.add('SQS');
      continue;
    }
    if (normalized === 'sns') {
      selected.add('SNS');
      continue;
    }
    if (normalized === 'elb') {
      selected.add('ELB');
      continue;
    }
    if (normalized === 'eks') {
      selected.add('EKS');
      continue;
    }
    if (normalized === 'efs') {
      selected.add('EFS');
      continue;
    }
    if (normalized === 'route53') {
      selected.add('Route53');
      continue;
    }
    if (normalized === 'backup') {
      selected.add('Backup');
      continue;
    }
    if (normalized === 'cloudwatch') {
      selected.add('CloudWatch');
      continue;
    }
    if (normalized === 'vpc') {
      selected.add('VPC');
      selected.add('NATGateway');
      selected.add('Subnets');
      selected.add('SecurityGroups');
    }
  }

  if (selected.size > 0) {
    selected.add('VPC');
    selected.add('NATGateway');
    selected.add('Subnets');
    selected.add('SecurityGroups');
  }

  return selected;
}

function shouldScanService(
  requestedServices: ReadonlySet<string> | null,
  serviceName: string,
): boolean {
  return requestedServices === null || requestedServices.has(serviceName);
}

function normalizeScannerConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_SCANNER_CONCURRENCY;
  }
  return Math.min(MAX_SCANNER_CONCURRENCY, Math.max(MIN_SCANNER_CONCURRENCY, Math.trunc(value)));
}

function normalizeScannerTimeoutMs(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_SCANNER_TIMEOUT_MS;
  }
  return Math.min(MAX_SCANNER_TIMEOUT_MS, Math.max(MIN_SCANNER_TIMEOUT_MS, Math.trunc(value)));
}

function normalizeScannerOutput(result: AwsServiceScannerOutput): {
  readonly resources: readonly DiscoveredResource[];
  readonly warnings: readonly string[];
} {
  if (Array.isArray(result)) {
    return {
      resources: result,
      warnings: [],
    };
  }

  return {
    resources: result.resources,
    warnings: result.warnings,
  };
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Scanner exceeded ${timeoutMs}ms timeout`);
  error.name = 'TimeoutError';
  return error;
}

async function executeWithScannerTimeout<TValue>(
  action: Promise<TValue>,
  abortSignal: AbortSignal,
  timeoutMs: number,
): Promise<TValue> {
  if (abortSignal.aborted) {
    throw createTimeoutError(timeoutMs);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<TValue>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createTimeoutError(timeoutMs));
    }, timeoutMs);
    abortSignal.addEventListener(
      'abort',
      () => {
        reject(createTimeoutError(timeoutMs));
      },
      { once: true },
    );
  });

  try {
    return await Promise.race([action, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function formatServiceWarning(name: string, region: string, error: unknown): string {
  const code = getAwsFailureType(error);
  if (code === 'AccessDeniedException' || code === 'AccessDenied') {
    return `${name} scan skipped in ${region} (AccessDenied).`;
  }
  if (code === 'ExpiredTokenException' || code === 'ExpiredToken') {
    return `${name} scan skipped in ${region} (ExpiredToken).`;
  }
  if (code === 'UnrecognizedClientException' || code === 'InvalidClientTokenId') {
    return `${name} scan skipped in ${region} (InvalidCredentials).`;
  }
  if (code.toLowerCase().includes('timeout') || code === 'AbortError') {
    return `${name} scan skipped in ${region} (Timeout).`;
  }
  return `${name} scan skipped in ${region} (insufficient permissions or unavailable API).`;
}

async function executeScanner(
  definition: AwsServiceScannerDefinition,
  clientOptions: AwsClientOptions,
  options: {
    readonly onProgress?: ScanOptions['onProgress'];
    readonly retryPolicy: AwsRetryPolicy;
    readonly scannerTimeoutMs: number;
    readonly random: () => number;
  },
): Promise<{
  readonly resources: readonly DiscoveredResource[];
  readonly warnings: readonly string[];
  readonly scannerResult: AwsServiceScanResult;
}> {
  const startedAt = Date.now();
  let retryCount = 0;

  emitProgress(options.onProgress, {
    service: definition.name,
    status: 'scanning',
    resourceCount: 0,
    region: clientOptions.region,
  });

  for (let attempt = 1; attempt <= options.retryPolicy.maxAttempts; attempt += 1) {
    const abortSignal = AbortSignal.timeout(options.scannerTimeoutMs);

    try {
      const result = await executeWithScannerTimeout(
        definition.scan({
          ...clientOptions,
          abortSignal,
          maxAttempts: 1,
        }),
        abortSignal,
        options.scannerTimeoutMs,
      );
      const normalized = normalizeScannerOutput(result);
      const durationMs = Date.now() - startedAt;
      const scannerResult: AwsServiceScanResult = {
        scannerName: definition.name,
        region: clientOptions.region,
        durationMs,
        retryCount,
        finalStatus: 'success',
        resourceCount: normalized.resources.length,
      };

      emitProgress(options.onProgress, {
        service: definition.name,
        status: 'completed',
        resourceCount: normalized.resources.length,
        region: clientOptions.region,
        durationMs,
        retryCount,
      });

      return {
        resources: normalized.resources,
        warnings: normalized.warnings,
        scannerResult,
      };
    } catch (error) {
      const failureType = getAwsFailureType(error);
      if (isAwsThrottlingError(error) && attempt < options.retryPolicy.maxAttempts) {
        retryCount += 1;
        const waitMs = computeRetryDelayMs(retryCount, options.retryPolicy, options.random);
        emitProgress(options.onProgress, {
          service: definition.name,
          status: 'retrying',
          resourceCount: 0,
          region: clientOptions.region,
          error: getAwsErrorMessage(error),
          retryCount,
          attempt: attempt + 1,
          maxAttempts: options.retryPolicy.maxAttempts,
          waitMs,
          failureType,
        });
        await sleep(waitMs);
        continue;
      }

      const durationMs = Date.now() - startedAt;
      const warning = formatServiceWarning(definition.name, clientOptions.region, error);
      const scannerResult: AwsServiceScanResult = {
        scannerName: definition.name,
        region: clientOptions.region,
        durationMs,
        retryCount,
        finalStatus: 'failed',
        failureType,
        resourceCount: 0,
      };

      emitProgress(options.onProgress, {
        service: definition.name,
        status: 'failed',
        resourceCount: 0,
        region: clientOptions.region,
        durationMs,
        retryCount,
        error: warning,
        failureType,
      });

      return {
        resources: [],
        warnings: [warning],
        scannerResult,
      };
    }
  }

  const durationMs = Date.now() - startedAt;
  return {
    resources: [],
    warnings: [
      formatServiceWarning(definition.name, clientOptions.region, new Error('UnknownError')),
    ],
    scannerResult: {
      scannerName: definition.name,
      region: clientOptions.region,
      durationMs,
      retryCount,
      finalStatus: 'failed',
      failureType: 'UnknownError',
      resourceCount: 0,
    },
  };
}

async function scanAwsRegion(
  clientOptions: AwsClientOptions,
  options: ScanAwsRegionOptions,
): Promise<AwsRegionScanResult> {
  const startedAt = Date.now();
  const requestedServices = normalizeRequestedServices(options.services);
  const scanners = (options.scanners ?? buildAwsServiceScanners(options.includeGlobalServices))
    .filter((scanner) => {
      if (!shouldScanService(requestedServices, scanner.name)) {
        return false;
      }
      return !scanner.global || options.includeGlobalServices;
    });
  const concurrency = normalizeScannerConcurrency(options.scannerConcurrency);
  const timeoutMs = normalizeScannerTimeoutMs(options.scannerTimeoutMs);
  const retryPolicy = options.retryPolicy ?? DEFAULT_AWS_RETRY_POLICY;
  const random = options.random ?? Math.random;

  const settled = await processWithConcurrencyLimit(scanners, concurrency, async (scanner) =>
    executeScanner(scanner, clientOptions, {
      onProgress: options.onProgress,
      retryPolicy,
      scannerTimeoutMs: timeoutMs,
      random,
    }),
  );

  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const scannerResults: AwsServiceScanResult[] = [];
  const scannerOutputs: AwsServiceScannerCapture[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      resources.push(...result.value.resources);
      warnings.push(...result.value.warnings);
      scannerResults.push(result.value.scannerResult);
      scannerOutputs.push({
        scannerResult: result.value.scannerResult,
        resources: result.value.resources,
        warnings: result.value.warnings,
      });
      return;
    }

    const scanner = scanners[index];
    const warning = formatServiceWarning(
      scanner?.name ?? 'UnknownScanner',
      clientOptions.region,
      result.reason,
    );
    const scannerResult: AwsServiceScanResult = {
      scannerName: scanner?.name ?? 'UnknownScanner',
      region: clientOptions.region,
      durationMs: 0,
      retryCount: 0,
      finalStatus: 'failed',
      failureType: getAwsFailureType(result.reason),
      resourceCount: 0,
    };
    warnings.push(
      warning,
    );
    scannerResults.push(scannerResult);
    scannerOutputs.push({
      scannerResult,
      resources: [],
      warnings: [warning],
    });
  });

  return {
    region: clientOptions.region,
    durationMs: Date.now() - startedAt,
    resources,
    warnings,
    scannerResults,
    scannerOutputs,
  };
}

async function resolveRegions(
  credentials: DiscoveryCredentials,
  options?: ScanOptions,
): Promise<string[]> {
  if (options?.regions && options.regions.length > 0) {
    if (options.regions.includes('all')) {
      return getAllAwsRegions(credentials);
    }
    return [...options.regions];
  }

  if (credentials.aws?.region) {
    return [credentials.aws.region];
  }

  return [];
}

export function buildAwsScanSummary(input: {
  readonly scannedRegions: readonly string[];
  readonly regionResults: readonly AwsRegionScanResult[];
  readonly totalDurationMs: number;
  readonly scannerConcurrency: number;
  readonly scannerTimeoutMs: number;
}): AwsScanSummary {
  const scannerResults = input.regionResults.flatMap((region) => region.scannerResults);
  return {
    totalDurationMs: input.totalDurationMs,
    scannerConcurrency: input.scannerConcurrency,
    scannerTimeoutMs: input.scannerTimeoutMs,
    scannedRegions: input.scannedRegions,
    discoveredResourceCount: input.regionResults.reduce(
      (count, region) => count + region.resources.length,
      0,
    ),
    successfulScanners: scannerResults.filter((result) => result.finalStatus === 'success').length,
    failedScanners: scannerResults.filter((result) => result.finalStatus === 'failed').length,
    scannerResults,
  };
}

export const awsScanner: CloudProviderAdapter = {
  name: 'aws',

  async scan(credentials: DiscoveryCredentials, options?: ScanOptions): Promise<ScanOutput> {
    const startTime = Date.now();
    const regionsToScan = await resolveRegions(credentials, options);

    if (regionsToScan.length === 0) {
      return {
        nodes: [],
        edges: [],
        metadata: {
          provider: 'aws',
          regions: [],
          scanDuration: 0,
          servicesCovered: [],
          timestamp: new Date(),
        },
      };
    }

    if (!credentials.aws) {
      return {
        nodes: [],
        edges: [],
        metadata: {
          provider: 'aws',
          regions: regionsToScan,
          scanDuration: Date.now() - startTime,
          servicesCovered: [],
          timestamp: new Date(),
        },
      };
    }

    const regionResults: AwsRegionScanResult[] = [];
    const allResources: DiscoveredResource[] = [];
    const allWarnings: string[] = [];

    for (const [index, region] of regionsToScan.entries()) {
      const result = await scanAwsRegion(
        {
          region,
          credentials: credentials.aws,
        },
        {
          includeGlobalServices: index === 0,
          services: options?.services,
          onProgress: options?.onProgress,
          scannerConcurrency: options?.scannerConcurrency,
          scannerTimeoutMs: options?.scannerTimeoutMs,
        },
      );
      regionResults.push(result);
      allResources.push(...result.resources);
      allWarnings.push(...result.warnings);
    }

    const summary = buildAwsScanSummary({
      scannedRegions: regionsToScan,
      regionResults,
      totalDurationMs: Date.now() - startTime,
      scannerConcurrency: normalizeScannerConcurrency(options?.scannerConcurrency),
      scannerTimeoutMs: normalizeScannerTimeoutMs(options?.scannerTimeoutMs),
    });

    return {
      nodes: [],
      edges: [],
      metadata: {
        provider: 'aws',
        regions: regionsToScan,
        scanDuration: Date.now() - startTime,
        servicesCovered:
          options?.services && options.services.length > 0
            ? Array.from(normalizeRequestedServices(options.services) ?? []).sort()
            : [...SERVICE_SCANNERS],
        timestamp: new Date(),
        scannerResults: summary.scannerResults,
        awsScanSummary: summary,
        ...(allResources.length > 0 ? { rawResources: allResources } : {}),
        ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      } as ScanOutput['metadata'],
    };
  },
};

export { getAllAwsRegions, resolveRegions, scanAwsRegion };

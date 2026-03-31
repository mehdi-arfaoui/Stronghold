/**
 * AWS cloud provider scanner — orchestrates per-service scanners
 * across one or multiple regions with concurrency control.
 */

import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import type { DiscoveredResource } from '../../types/discovery.js';
import type {
  CloudProviderAdapter,
  ScanOutput,
  ScanOptions,
  DiscoveryProgress,
} from '../provider-interface.js';
import type { DiscoveryCredentials } from '../../types/discovery.js';
import type { AwsClientOptions } from './aws-client-factory.js';
import { createAwsClient } from './aws-client-factory.js';
import { processInBatches } from './scan-utils.js';
import {
  scanEc2Instances,
  scanVpcs,
  scanSubnets,
  scanSecurityGroups,
  scanNatGateways,
} from './services/ec2-scanner.js';
import { scanAuroraClusters } from './services/aurora-scanner.js';
import { scanRdsInstances } from './services/rds-scanner.js';
import { scanEfsFileSystems } from './services/efs-scanner.js';
import { scanLambdaFunctions } from './services/lambda-scanner.js';
import { scanElastiCacheClusters } from './services/elasticache-scanner.js';
import { scanDynamoDbTables } from './services/dynamodb-scanner.js';
import { scanS3Buckets } from './services/s3-scanner.js';
import { scanSqsQueues } from './services/sqs-scanner.js';
import { scanSnsTopics } from './services/sns-scanner.js';
import { scanLoadBalancers } from './services/elb-scanner.js';
import { scanEksClusters } from './services/eks-scanner.js';
import { scanAutoScalingGroups } from './services/auto-scaling-scanner.js';
import { scanRoute53HostedZones } from './services/route53-scanner.js';
import { scanBackupResources } from './services/backup-scanner.js';
import { scanCloudWatchAlarms } from './services/cloudwatch-scanner.js';

const MAX_CONCURRENT_REGIONS = 5;

const SERVICE_SCANNERS = [
  'EC2',
  'RDS',
  'Aurora',
  'EFS',
  'Lambda',
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

async function getAllAwsRegions(credentials: DiscoveryCredentials): Promise<string[]> {
  if (!credentials.aws) {
    return [];
  }

  const ec2 = createAwsClient(EC2Client, {
    region: 'us-east-1',
    credentials: credentials.aws,
  });
  const { Regions } = await ec2.send(new DescribeRegionsCommand({}));
  return Regions?.map((r) => r.RegionName).filter((name): name is string => Boolean(name)) ?? [];
}

function emitProgress(
  onProgress: ScanOptions['onProgress'],
  service: string,
  status: DiscoveryProgress['status'],
  resourceCount: number,
  error?: string,
): void {
  onProgress?.({ service, status, resourceCount, error });
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

function getAwsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const candidate = error as Record<string, unknown>;
  return String(candidate.name ?? candidate.Code ?? candidate.code ?? '');
}

function isRetryableAwsError(error: unknown): boolean {
  const code = getAwsErrorCode(error).toLowerCase();
  return code.includes('throttl') || code.includes('timeout') || code.includes('toomanyrequests');
}

async function executeWithRetry<TValue>(
  action: () => Promise<TValue>,
  attempts = 3,
): Promise<TValue> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isRetryableAwsError(error) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }

  throw lastError;
}

function formatServiceWarning(name: string, region: string, error: unknown): string {
  const code = getAwsErrorCode(error);
  if (code === 'AccessDeniedException' || code === 'AccessDenied') {
    return `${name} scan skipped in ${region} (AccessDenied).`;
  }
  if (code === 'ExpiredTokenException' || code === 'ExpiredToken') {
    return `${name} scan skipped in ${region} (ExpiredToken).`;
  }
  if (code === 'UnrecognizedClientException' || code === 'InvalidClientTokenId') {
    return `${name} scan skipped in ${region} (InvalidCredentials).`;
  }
  if (code.toLowerCase().includes('timeout')) {
    return `${name} scan skipped in ${region} (Timeout).`;
  }
  return `${name} scan skipped in ${region} (insufficient permissions or unavailable API).`;
}

/** Scan all supported AWS services in a single region. */
async function scanAwsRegion(
  clientOptions: AwsClientOptions,
  options: {
    includeGlobalServices: boolean;
    services?: readonly string[];
    onProgress?: ScanOptions['onProgress'];
  },
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const requestedServices = normalizeRequestedServices(options.services);

  const scanService = async (
    name: string,
    fn: () => Promise<
      DiscoveredResource[] | { resources: DiscoveredResource[]; warnings: string[] }
    >,
  ): Promise<void> => {
    if (!shouldScanService(requestedServices, name)) {
      return;
    }
    emitProgress(options.onProgress, name, 'scanning', 0);
    try {
      const result = await executeWithRetry(fn);
      if (Array.isArray(result)) {
        resources.push(...result);
        emitProgress(options.onProgress, name, 'completed', result.length);
      } else {
        resources.push(...result.resources);
        warnings.push(...result.warnings);
        emitProgress(options.onProgress, name, 'completed', result.resources.length);
      }
    } catch (error) {
      const msg = formatServiceWarning(name, clientOptions.region, error);
      warnings.push(msg);
      emitProgress(options.onProgress, name, 'failed', 0, msg);
    }
  };

  await scanService('EC2', () => scanEc2Instances(clientOptions));
  await scanService('RDS', () => scanRdsInstances(clientOptions));
  await scanService('Aurora', () =>
    scanAuroraClusters(clientOptions, {
      includeGlobalClusters: options.includeGlobalServices,
    }),
  );
  await scanService('EFS', () => scanEfsFileSystems(clientOptions));
  await scanService('Lambda', () => scanLambdaFunctions(clientOptions));
  await scanService('ElastiCache', () => scanElastiCacheClusters(clientOptions));
  await scanService('DynamoDB', () => scanDynamoDbTables(clientOptions));
  await scanService('SQS', () => scanSqsQueues(clientOptions));
  await scanService('SNS', () => scanSnsTopics(clientOptions));
  await scanService('ELB', () => scanLoadBalancers(clientOptions));
  await scanService('EKS', () => scanEksClusters(clientOptions));
  await scanService('AutoScaling', () => scanAutoScalingGroups(clientOptions));
  await scanService('VPC', () => scanVpcs(clientOptions));
  await scanService('NATGateway', () => scanNatGateways(clientOptions));
  await scanService('Backup', () => scanBackupResources(clientOptions));
  await scanService('CloudWatch', () => scanCloudWatchAlarms(clientOptions));

  // Subnet and Security Groups are part of VPC scanning
  await scanService('Subnets', () => scanSubnets(clientOptions));
  await scanService('SecurityGroups', () => scanSecurityGroups(clientOptions));

  // S3 and Route53 are global services, only scan once
  if (options.includeGlobalServices) {
    await scanService('S3', () => scanS3Buckets(clientOptions));
    await scanService('Route53', () => scanRoute53HostedZones(clientOptions));
  }

  return { resources, warnings };
}

/** Resolves the list of regions to scan based on options and credentials. */
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

/** AWS CloudProvider implementation. */
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

    const allResources: DiscoveredResource[] = [];
    const allWarnings: string[] = [];

    const regionInputs = regionsToScan.map((region, index) => ({
      region,
      index,
    }));

    const results = await processInBatches(
      regionInputs,
      MAX_CONCURRENT_REGIONS,
      async ({ region, index }) => {
        const clientOptions: AwsClientOptions = {
          region,
          credentials: credentials.aws!,
        };
        return scanAwsRegion(clientOptions, {
          includeGlobalServices: index === 0,
          services: options?.services,
          onProgress: options?.onProgress,
        });
      },
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allResources.push(...result.value.resources);
        allWarnings.push(...result.value.warnings);
      } else {
        const errorMsg =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        allWarnings.push(`AWS scan failed for a region: ${errorMsg}`);
      }
    }

    // Use the graph bridge (imported by consumer) to convert resources → nodes/edges
    // The scanner returns raw DiscoveredResources; transformation happens at orchestration layer
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
        // Attach raw resources for the orchestration layer to transform
        ...(allResources.length > 0 ? { rawResources: allResources } : {}),
        ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      } as ScanOutput['metadata'],
    };
  },
};

/** Re-export for direct usage of the raw scanning function. */
export { scanAwsRegion, getAllAwsRegions, resolveRegions };

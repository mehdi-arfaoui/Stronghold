import {
  buildAwsScanSummary,
  DEFAULT_SCANNER_CONCURRENCY,
  DEFAULT_SCANNER_TIMEOUT_MS,
  dynamoDbPitrEnricher,
  ec2AsgEnricher,
  elasticacheFailoverEnricher,
  s3ReplicationEnricher,
  scanAwsRegion,
  withScanContextRegion,
  transformToScanResult,
  type Evidence,
  type AwsRegionScanResult,
  type DiscoveryCloudCredentials,
  type DiscoveryProgress,
  type DiscoveredResource,
  type GraphOverrides,
  type InfraNode,
  type ScanContext,
} from '@stronghold-dr/core';

import type { SupportedService } from '../config/options.js';
import type {
  ScanExecutionMetadata,
  ScanResults,
  StoredScanEdge,
} from '../storage/file-store.js';
import { normalizeEdge } from './graph-adjustments.js';
import { runScanPipeline } from './scan-pipeline.js';

export interface AwsScanHooks {
  readonly onRegionStart?: (region: string) => void | Promise<void>;
  readonly onRegionComplete?: (region: string, durationMs: number) => void | Promise<void>;
  readonly onProgress?: (region: string, progress: DiscoveryProgress) => void | Promise<void>;
  readonly onStage?: (message: string) => void | Promise<void>;
  readonly onServiceLog?: (message: string) => void | Promise<void>;
}

export interface AwsScanIdentityMetadata {
  readonly authMode?: string;
  readonly profile?: string;
  readonly maskedAccountId?: string;
  readonly roleArn?: string;
  readonly accountName?: string;
}

export interface AwsScanOptions {
  readonly scanContext: ScanContext;
  readonly regions: readonly string[];
  readonly services?: readonly SupportedService[];
  readonly scannerConcurrency?: number;
  readonly scannerTimeoutMs?: number;
  readonly graphOverrides?: GraphOverrides | null;
  readonly identityMetadata?: AwsScanIdentityMetadata;
  readonly hooks?: AwsScanHooks;
  readonly servicesFilePath?: string;
  readonly previousAssignments?: readonly import('@stronghold-dr/core').Service[];
  readonly evidence?: readonly Evidence[];
}

export interface AwsScanExecution {
  readonly results: ScanResults;
  readonly warnings: readonly string[];
  readonly scanMetadata: ScanExecutionMetadata;
  readonly regionResults: readonly AwsRegionScanResult[];
}

export async function runAwsScan(options: AwsScanOptions): Promise<AwsScanExecution> {
  const scanStartedAt = Date.now();
  const mergedResources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const regionResults: AwsRegionScanResult[] = [];

  for (const [index, region] of options.regions.entries()) {
    const regionStart = Date.now();
    await options.hooks?.onRegionStart?.(region);
    const regionContext = withScanContextRegion(options.scanContext, region);

    const result = await scanAwsRegion(
      {
        region,
        scanContext: regionContext,
      },
      {
        includeGlobalServices: index === 0,
        services: options.services,
        onProgress: (progress) => options.hooks?.onProgress?.(region, progress),
        scannerConcurrency: options.scannerConcurrency,
        scannerTimeoutMs: options.scannerTimeoutMs,
      },
    );

    mergedResources.push(...result.resources);
    warnings.push(...result.warnings);
    regionResults.push(result);
    await options.hooks?.onRegionComplete?.(region, Date.now() - regionStart);
  }

  const transformed = transformToScanResult(mergedResources, [], 'aws');
  const nodes = transformed.nodes as InfraNode[];
  const edges: ReadonlyArray<StoredScanEdge> = transformed.edges.map((edge) => normalizeEdge(edge));

  const enrichmentCredentials = await options.scanContext.getCredentials();
  await enrichNodes(
    nodes,
    toDiscoveryCloudCredentials(enrichmentCredentials, options.scanContext.region),
    options.services,
    warnings,
    options.hooks,
  );

  const scanMetadata: ScanExecutionMetadata = {
    ...buildAwsScanSummary({
      scannedRegions: options.regions,
      regionResults,
      totalDurationMs: Date.now() - scanStartedAt,
      scannerConcurrency: options.scannerConcurrency ?? DEFAULT_SCANNER_CONCURRENCY,
      scannerTimeoutMs: options.scannerTimeoutMs ?? DEFAULT_SCANNER_TIMEOUT_MS,
    }),
    ...(options.identityMetadata?.authMode
      ? { authMode: options.identityMetadata.authMode }
      : {}),
    ...(options.identityMetadata?.profile
      ? { profile: options.identityMetadata.profile }
      : {}),
    ...(options.identityMetadata?.maskedAccountId
      ? { maskedAccountId: options.identityMetadata.maskedAccountId }
      : {}),
    ...(options.identityMetadata?.roleArn
      ? { roleArn: options.identityMetadata.roleArn }
      : {}),
    ...(options.identityMetadata?.accountName
      ? { accountName: options.identityMetadata.accountName }
      : {}),
  };

  const results = await runScanPipeline({
    provider: 'aws',
    regions: options.regions,
    nodes,
    edges,
    timestamp: new Date().toISOString(),
    graphOverrides: options.graphOverrides,
    scanMetadata,
    warnings,
    servicesFilePath: options.servicesFilePath,
    previousAssignments: options.previousAssignments,
    evidence: options.evidence,
    onStage: (stage) => {
      if (stage === 'graph') {
        return options.hooks?.onStage?.('Building dependency graph...');
      }
      if (stage === 'validation') {
        return options.hooks?.onStage?.('Running DR validation...');
      }
      return options.hooks?.onStage?.('Generating DR plan...');
    },
    onServiceLog: (message) => options.hooks?.onServiceLog?.(message),
  });

  const allWarnings = results.warnings ?? warnings;

  return { results, warnings: allWarnings, scanMetadata, regionResults };
}

async function enrichNodes(
  nodes: InfraNode[],
  credentials: DiscoveryCloudCredentials,
  services: readonly SupportedService[] | undefined,
  warnings: string[],
  hooks?: AwsScanHooks,
): Promise<void> {
  const enrichers = [
    {
      service: 's3' as const,
      name: 'S3 metadata',
      run: () => s3ReplicationEnricher.enrich(nodes, credentials),
    },
    {
      service: 'dynamodb' as const,
      name: 'DynamoDB PITR metadata',
      run: () => dynamoDbPitrEnricher.enrich(nodes, credentials),
    },
    {
      service: 'ec2' as const,
      name: 'EC2 Auto Scaling metadata',
      run: () => ec2AsgEnricher.enrich(nodes, credentials),
    },
    {
      service: 'elasticache' as const,
      name: 'ElastiCache failover metadata',
      run: () => elasticacheFailoverEnricher.enrich(nodes, credentials),
    },
  ];

  for (const enricher of enrichers) {
    if (services && services.length > 0 && !services.includes(enricher.service)) {
      continue;
    }

    await hooks?.onStage?.(`Enriching ${enricher.name}...`);
    const result = await enricher.run();
    if (result.failed > 0) {
      warnings.push(`${enricher.name} enrichment failed for ${result.failed} resource(s).`);
    }
  }
}

function toDiscoveryCloudCredentials(
  credentials: Awaited<ReturnType<ScanContext['getCredentials']>>,
  region: string,
): DiscoveryCloudCredentials {
  return {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
    region,
  };
}

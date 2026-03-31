import {
  dynamoDbPitrEnricher,
  ec2AsgEnricher,
  elasticacheFailoverEnricher,
  s3ReplicationEnricher,
  scanAwsRegion,
  transformToScanResult,
  type DiscoveryProgress,
  type DiscoveryCredentials,
  type InfraNode,
} from '@stronghold-dr/core';

import type { SupportedService } from '../config/options.js';
import type { ScanResults, StoredScanEdge } from '../storage/file-store.js';
import { runScanPipeline } from './scan-pipeline.js';

export interface AwsScanHooks {
  readonly onRegionStart?: (region: string) => void | Promise<void>;
  readonly onRegionComplete?: (region: string, durationMs: number) => void | Promise<void>;
  readonly onProgress?: (region: string, progress: DiscoveryProgress) => void | Promise<void>;
  readonly onStage?: (message: string) => void | Promise<void>;
}

export interface AwsScanOptions {
  readonly credentials: DiscoveryCredentials;
  readonly regions: readonly string[];
  readonly services?: readonly SupportedService[];
  readonly hooks?: AwsScanHooks;
}

export interface AwsScanExecution {
  readonly results: ScanResults;
  readonly warnings: readonly string[];
}

export async function runAwsScan(options: AwsScanOptions): Promise<AwsScanExecution> {
  const mergedResources = [];
  const warnings: string[] = [];

  for (const [index, region] of options.regions.entries()) {
    const regionStart = Date.now();
    await options.hooks?.onRegionStart?.(region);
    const result = await scanAwsRegion(
      {
        region,
        credentials: options.credentials.aws ?? {},
      },
      {
        includeGlobalServices: index === 0,
        services: options.services,
        onProgress: (progress) => options.hooks?.onProgress?.(region, progress),
      },
    );
    mergedResources.push(...result.resources);
    warnings.push(...result.warnings);
    await options.hooks?.onRegionComplete?.(region, Date.now() - regionStart);
  }

  const transformed = transformToScanResult(mergedResources, [], 'aws');
  const nodes = transformed.nodes as InfraNode[];
  const edges: ReadonlyArray<StoredScanEdge> = transformed.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    type: edge.type,
  }));

  await enrichNodes(nodes, options.credentials, options.services, warnings, options.hooks);

  const results = await runScanPipeline({
    provider: 'aws',
    regions: options.regions,
    nodes,
    edges,
    timestamp: new Date().toISOString(),
    warnings,
    onStage: (stage) => {
      if (stage === 'graph') {
        return options.hooks?.onStage?.('Building dependency graph...');
      }
      if (stage === 'validation') {
        return options.hooks?.onStage?.('Running DR validation...');
      }
      return options.hooks?.onStage?.('Generating DR plan...');
    },
  });

  return { results, warnings };
}

async function enrichNodes(
  nodes: InfraNode[],
  credentials: DiscoveryCredentials,
  services: readonly SupportedService[] | undefined,
  warnings: string[],
  hooks?: AwsScanHooks,
): Promise<void> {
  const enrichers = [
    { service: 's3' as const, name: 'S3 metadata', run: () => s3ReplicationEnricher.enrich(nodes, credentials.aws ?? {}) },
    {
      service: 'dynamodb' as const,
      name: 'DynamoDB PITR metadata',
      run: () => dynamoDbPitrEnricher.enrich(nodes, credentials.aws ?? {}),
    },
    {
      service: 'ec2' as const,
      name: 'EC2 Auto Scaling metadata',
      run: () => ec2AsgEnricher.enrich(nodes, credentials.aws ?? {}),
    },
    {
      service: 'elasticache' as const,
      name: 'ElastiCache failover metadata',
      run: () => elasticacheFailoverEnricher.enrich(nodes, credentials.aws ?? {}),
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

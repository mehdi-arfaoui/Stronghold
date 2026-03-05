import assert from 'node:assert/strict';
import test from 'node:test';

import { syncDiscoveryJobToResilienceGraph } from '../src/workers/discoveryWorker.ts';

test('syncDiscoveryJobToResilienceGraph bridges legacy discovery results into the resilience graph', async () => {
  let captured:
    | {
        tenantId: string;
        provider: string;
        inferDependencies: boolean;
        metadataEnrichmentEnabled: boolean;
        metadataEnrichmentAwsRegion: string | null;
        resources: Array<{ externalId: string }>;
        flows: Array<{ sourceIp?: string | null; targetIp?: string | null }>;
      }
    | null = null;

  const report = await syncDiscoveryJobToResilienceGraph({
    prismaClient: {} as never,
    tenantId: 'tenant-legacy',
    jobId: 'job-legacy',
    inferDependencies: false,
    metadataEnrichment: {
      credentials: {
        aws: {
          accessKeyId: 'AKIA_TEST',
          secretAccessKey: 'secret-test',
          region: 'eu-west-1',
        },
      },
      regions: { aws: 'eu-west-1' },
    },
    logger: {
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
    },
    loadScanData: async () => ({
      resources: [
        {
          source: 'network',
          externalId: 'srv-1',
          name: 'srv-1',
          kind: 'infra',
          type: 'HOST',
          ip: '10.0.0.10',
          hostname: 'srv-1.local',
          metadata: { detectedOs: 'Windows Server' },
        },
      ],
      flows: [
        {
          sourceIp: '10.0.0.10',
          targetIp: '10.0.0.20',
        },
      ],
    }),
    ingest: async (_prismaClient, tenantId, resources, flows, provider, options) => {
      captured = {
        tenantId,
        provider,
        inferDependencies: options?.inferDependencies !== false,
        metadataEnrichmentEnabled: Boolean(options?.metadataEnrichment),
        metadataEnrichmentAwsRegion: options?.metadataEnrichment?.regions?.aws || null,
        resources,
        flows,
      };

      return {
        provider,
        scannedAt: new Date('2026-03-04T08:00:00.000Z'),
        totalNodes: resources.length,
        totalEdges: flows.length,
        nodesCreated: 1,
        nodesUpdated: 0,
        nodesRemoved: 0,
        edgesCreated: 1,
        edgesUpdated: 0,
        edgesRemoved: 0,
      };
    },
  });

  assert.equal(captured?.tenantId, 'tenant-legacy');
  assert.equal(captured?.provider, 'legacy-discovery');
  assert.equal(captured?.inferDependencies, false);
  assert.equal(captured?.metadataEnrichmentEnabled, true);
  assert.equal(captured?.metadataEnrichmentAwsRegion, 'eu-west-1');
  assert.equal(captured?.resources.length, 1);
  assert.equal(captured?.flows.length, 1);
  assert.equal(report?.totalNodes, 1);
});

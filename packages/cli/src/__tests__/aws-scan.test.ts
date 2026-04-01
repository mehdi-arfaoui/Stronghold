import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const scanAwsRegionMock = vi.fn();
  const transformToScanResultMock = vi.fn((resources: Array<{ externalId: string; type: string }>) => ({
    nodes: resources.map((resource) => ({
      id: resource.externalId,
      name: resource.externalId,
      type: resource.type,
      provider: 'aws',
      region: 'eu-west-1',
      availabilityZone: null,
      tags: {},
      metadata: {},
    })),
    edges: [],
  }));
  const noOpEnricher = {
    enrich: vi.fn(async () => ({ failed: 0 })),
  };
  return {
    scanAwsRegionMock,
    transformToScanResultMock,
    noOpEnricher,
  };
});

vi.mock('@stronghold-dr/core', async () => {
  const actual = await vi.importActual<typeof import('@stronghold-dr/core')>('@stronghold-dr/core');
  return {
    ...actual,
    scanAwsRegion: hoisted.scanAwsRegionMock,
    transformToScanResult: hoisted.transformToScanResultMock,
    s3ReplicationEnricher: hoisted.noOpEnricher,
    dynamoDbPitrEnricher: hoisted.noOpEnricher,
    ec2AsgEnricher: hoisted.noOpEnricher,
    elasticacheFailoverEnricher: hoisted.noOpEnricher,
  };
});

import { runAwsScan } from '../pipeline/aws-scan.js';

describe('runAwsScan', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps regions sequential while aggregating region scan metadata', async () => {
    const startedRegions: string[] = [];
    let resolveFirstRegion: (() => void) | undefined;
    let resolveSecondRegion: (() => void) | undefined;

    hoisted.scanAwsRegionMock.mockImplementation(async ({ region }: { region: string }) => {
      startedRegions.push(region);
      if (region === 'eu-west-1') {
        await new Promise<void>((resolve) => {
          resolveFirstRegion = resolve;
        });
        return {
          region,
          durationMs: 25,
          resources: [
            { source: 'aws', externalId: 'ec2-1', name: 'ec2-1', kind: 'infra', type: 'EC2' },
          ],
          warnings: [],
          scannerResults: [
            {
              scannerName: 'EC2',
              region,
              durationMs: 25,
              retryCount: 0,
              finalStatus: 'success',
              resourceCount: 1,
            },
          ],
          scannerOutputs: [
            {
              scannerResult: {
                scannerName: 'EC2',
                region,
                durationMs: 25,
                retryCount: 0,
                finalStatus: 'success',
                resourceCount: 1,
              },
              resources: [
                {
                  source: 'aws',
                  externalId: 'ec2-1',
                  name: 'ec2-1',
                  kind: 'infra',
                  type: 'EC2',
                },
              ],
              warnings: [],
            },
          ],
        };
      }

      await new Promise<void>((resolve) => {
        resolveSecondRegion = resolve;
      });
      return {
        region,
        durationMs: 30,
        resources: [],
        warnings: ['EKS scan skipped in us-east-1 (Timeout).'],
        scannerResults: [
          {
            scannerName: 'EKS',
            region,
            durationMs: 30,
            retryCount: 1,
            finalStatus: 'failed',
            failureType: 'TimeoutError',
            resourceCount: 0,
          },
        ],
        scannerOutputs: [
          {
            scannerResult: {
              scannerName: 'EKS',
              region,
              durationMs: 30,
              retryCount: 1,
              finalStatus: 'failed',
              failureType: 'TimeoutError',
              resourceCount: 0,
            },
            resources: [],
            warnings: ['EKS scan skipped in us-east-1 (Timeout).'],
          },
        ],
      };
    });

    const executionPromise = runAwsScan({
      credentials: { aws: {} },
      regions: ['eu-west-1', 'us-east-1'],
      scannerConcurrency: 5,
      scannerTimeoutMs: 60_000,
      identityMetadata: { authMode: 'default-credential-chain' },
    });

    await Promise.resolve();
    expect(startedRegions).toEqual(['eu-west-1']);

    resolveFirstRegion?.();
    await vi.waitFor(() => {
      expect(startedRegions).toEqual(['eu-west-1', 'us-east-1']);
    });

    resolveSecondRegion?.();
    const execution = await executionPromise;

    expect(execution.scanMetadata).toMatchObject({
      successfulScanners: 1,
      failedScanners: 1,
      scannedRegions: ['eu-west-1', 'us-east-1'],
      discoveredResourceCount: 1,
      authMode: 'default-credential-chain',
    });
    expect(execution.results.scanMetadata).toMatchObject({
      successfulScanners: 1,
      failedScanners: 1,
    });
    expect(execution.regionResults).toHaveLength(2);
    expect(execution.regionResults[0]?.scannerOutputs).toHaveLength(1);
  });
});

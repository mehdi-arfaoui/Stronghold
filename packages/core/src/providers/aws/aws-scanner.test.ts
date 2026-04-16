import { afterEach, describe, expect, it, vi } from 'vitest';

import { createResource } from '../../types/discovery.js';
import type { AwsClientOptions } from './aws-client-factory.js';
import {
  buildAwsScanSummary,
  DEFAULT_AWS_RETRY_POLICY,
  scanAwsRegion,
  type AwsServiceScannerDefinition,
} from './aws-scanner.js';

const TEST_CLIENT_OPTIONS: AwsClientOptions = {
  region: 'eu-west-1',
  credentials: {},
};

const TEST_ACCOUNT = {
  accountId: '123456789012',
  partition: 'aws',
} as const;

function createScanner(
  name: string,
  run: AwsServiceScannerDefinition['scan'],
): AwsServiceScannerDefinition {
  return {
    name,
    scan: run,
  };
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function createTestResource(type: string, id: string) {
  const arn =
    type === 'EKS'
      ? `arn:aws:eks:${TEST_CLIENT_OPTIONS.region}:${TEST_ACCOUNT.accountId}:cluster/${id}`
      : `arn:aws:ec2:${TEST_CLIENT_OPTIONS.region}:${TEST_ACCOUNT.accountId}:instance/${id}`;

  return createResource({
    source: 'aws',
    arn,
    name: id,
    kind: 'infra',
    type,
    account: TEST_ACCOUNT,
  });
}

describe('scanAwsRegion', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('respects the configured concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const scanners = ['EC2', 'RDS', 'EKS', 'S3'].map((name) =>
      createScanner(name, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await wait(10);
        active -= 1;
        return [];
      }),
    );

    const result = await scanAwsRegion(TEST_CLIENT_OPTIONS, {
      includeGlobalServices: true,
      scannerConcurrency: 2,
      scanners,
    });

    expect(result.scannerResults).toHaveLength(4);
    expect(result.scannerOutputs).toHaveLength(4);
    expect(maxActive).toBe(2);
  });

  it('runs scanners sequentially when concurrency is set to 1', async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const scanners = ['EC2', 'RDS', 'EKS'].map((name) =>
      createScanner(name, async () => {
        order.push(`start:${name}`);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await wait(5);
        active -= 1;
        order.push(`end:${name}`);
        return [];
      }),
    );

    await scanAwsRegion(TEST_CLIENT_OPTIONS, {
      includeGlobalServices: true,
      scannerConcurrency: 1,
      scanners,
    });

    expect(maxActive).toBe(1);
    expect(order).toEqual([
      'start:EC2',
      'end:EC2',
      'start:RDS',
      'end:RDS',
      'start:EKS',
      'end:EKS',
    ]);
  });

  it('keeps scanning when one scanner fails', async () => {
    const scanners = [
      createScanner('EC2', async () => [createTestResource('EC2', 'ec2-1')]),
      createScanner('RDS', async () => {
        throw new Error('boom');
      }),
      createScanner('EKS', async () => [createTestResource('EKS', 'eks-1')]),
    ];

    const result = await scanAwsRegion(TEST_CLIENT_OPTIONS, {
      includeGlobalServices: true,
      scannerConcurrency: 3,
      scanners,
    });

    expect(result.resources.map((resource) => resource.resourceId)).toEqual(['ec2-1', 'eks-1']);
    expect(result.scannerResults.filter((scanner) => scanner.finalStatus === 'failed')).toHaveLength(1);
    expect(result.scannerResults.filter((scanner) => scanner.finalStatus === 'success')).toHaveLength(2);
  });

  it('retries and succeeds after transient throttling', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const progressEvents: Array<{ readonly status: string; readonly attempt?: number }> = [];
    const promise = scanAwsRegion(TEST_CLIENT_OPTIONS, {
      includeGlobalServices: true,
      scanners: [
        createScanner('EKS', async () => {
          attempts += 1;
          if (attempts === 1) {
            const error = new Error('rate limited');
            error.name = 'ThrottlingException';
            throw error;
          }
          return [createTestResource('EKS', 'eks-1')];
        }),
      ],
      onProgress: (progress) => {
        progressEvents.push({ status: progress.status, attempt: progress.attempt });
      },
      random: () => 0,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts).toBe(2);
    expect(result.scannerResults[0]).toMatchObject({
      finalStatus: 'success',
      retryCount: 1,
      resourceCount: 1,
    });
    expect(progressEvents.some((event) => event.status === 'retrying' && event.attempt === 2)).toBe(true);
  });

  it('marks a scanner as failed when throttling retries are exhausted', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const promise = scanAwsRegion(TEST_CLIENT_OPTIONS, {
      includeGlobalServices: true,
      scanners: [
        createScanner('Backup', async () => {
          attempts += 1;
          const error = new Error('too many requests');
          error.name = 'TooManyRequestsException';
          throw error;
        }),
      ],
      random: () => 0,
      retryPolicy: DEFAULT_AWS_RETRY_POLICY,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts).toBe(3);
    expect(result.scannerResults[0]).toMatchObject({
      finalStatus: 'failed',
      retryCount: 2,
      failureType: 'TooManyRequestsException',
    });
  });

  it('marks a scanner as failed on timeout', async () => {
    vi.useFakeTimers();
    const promise = scanAwsRegion(TEST_CLIENT_OPTIONS, {
      includeGlobalServices: true,
      scannerTimeoutMs: 10_000,
      scanners: [
        createScanner('Route53', async () => {
          await wait(20_000);
          return [];
        }),
      ],
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.scannerResults[0]).toMatchObject({
      finalStatus: 'failed',
      failureType: 'TimeoutError',
    });
  });
});

describe('buildAwsScanSummary', () => {
  it('builds summary metadata for operators', () => {
    const summary = buildAwsScanSummary({
      scannedRegions: ['eu-west-1', 'us-east-1'],
      totalDurationMs: 12_500,
      scannerConcurrency: 5,
      scannerTimeoutMs: 60_000,
      regionResults: [
        {
          region: 'eu-west-1',
          durationMs: 5_000,
          resources: [createTestResource('EC2', 'ec2-1')],
          warnings: [],
          scannerResults: [
            {
              scannerName: 'EC2',
              region: 'eu-west-1',
              durationMs: 1_000,
              retryCount: 0,
              finalStatus: 'success',
              resourceCount: 1,
            },
          ],
        },
        {
          region: 'us-east-1',
          durationMs: 7_500,
          resources: [],
          warnings: ['EKS scan skipped in us-east-1 (Timeout).'],
          scannerResults: [
            {
              scannerName: 'EKS',
              region: 'us-east-1',
              durationMs: 7_500,
              retryCount: 1,
              finalStatus: 'failed',
              failureType: 'TimeoutError',
              resourceCount: 0,
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      totalDurationMs: 12_500,
      scannerConcurrency: 5,
      scannerTimeoutMs: 60_000,
      discoveredResourceCount: 1,
      successfulScanners: 1,
      failedScanners: 1,
      scannedRegions: ['eu-west-1', 'us-east-1'],
    });
    expect(summary.scannerResults).toHaveLength(2);
  });
});

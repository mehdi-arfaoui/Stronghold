/**
 * Scans AWS S3 buckets (global service, queried once per scan).
 */

import { S3Client, ListBucketsCommand, GetBucketLocationCommand } from '@aws-sdk/client-s3';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { buildResource } from '../scan-utils.js';

function normalizeS3Region(locationConstraint: string | null | undefined): string {
  if (!locationConstraint) return 'us-east-1';
  if (locationConstraint === 'EU') return 'eu-west-1';
  return locationConstraint;
}

export async function scanS3Buckets(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const s3 = createAwsClient(S3Client, {
    ...options,
    region: 'us-east-1',
  });
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];

  const buckets = await s3.send(new ListBucketsCommand({}));

  for (const bucket of buckets.Buckets ?? []) {
    if (!bucket.Name) continue;
    const bucketName = bucket.Name;

    let bucketRegion = 'us-east-1';
    try {
      const location = await s3.send(new GetBucketLocationCommand({ Bucket: bucketName }));
      bucketRegion = normalizeS3Region(location.LocationConstraint as string | undefined);
    } catch {
      // Keep default us-east-1 when bucket location is unavailable.
    }

    resources.push(
      buildResource({
        source: 'aws',
        externalId: `arn:aws:s3:::${bucketName}`,
        name: bucketName,
        kind: 'infra',
        type: 'S3_BUCKET',
        metadata: {
          region: bucketRegion,
          bucketName,
          bucketArn: `arn:aws:s3:::${bucketName}`,
          creationDate: bucket.CreationDate?.toISOString(),
          displayName: bucketName,
        },
      }),
    );
  }

  return { resources, warnings };
}

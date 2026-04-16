/**
 * Scans AWS S3 buckets (global service, queried once per scan).
 */

import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketTaggingCommand,
} from '@aws-sdk/client-s3';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import {
  createAccountContextResolver,
  createResource,
} from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

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
  const tagWarnings = new Set<string>();
  const resolveAccountContext = createAccountContextResolver(options);

  const buckets = await s3.send(new ListBucketsCommand({}), getAwsCommandOptions(options));

  for (const bucket of buckets.Buckets ?? []) {
    if (!bucket.Name) continue;
    const bucketName = bucket.Name;

    let bucketRegion = 'us-east-1';
    try {
      const location = await s3.send(
        new GetBucketLocationCommand({ Bucket: bucketName }),
        getAwsCommandOptions(options),
      );
      bucketRegion = normalizeS3Region(location.LocationConstraint as string | undefined);
    } catch {
      // Keep default us-east-1 when bucket location is unavailable.
    }

    const tags = await fetchAwsTagsWithRetry(
      () =>
        s3.send(
          new GetBucketTaggingCommand({ Bucket: bucketName }),
          getAwsCommandOptions(options),
        ),
      (response) => tagsArrayToMap(response.TagSet),
      {
        description: `S3 tag discovery unavailable in ${bucketRegion}`,
        warnings,
        warningDeduper: tagWarnings,
        ignoreErrorCodes: ['NoSuchTagSet'],
      },
    );
    const displayName = getNameTag(tags) ?? bucketName;

    const accountContext = await resolveAccountContext();
    const bucketArn = `arn:${accountContext.partition}:s3:::${bucketName}`;

    resources.push(
      createResource({
        source: 'aws',
        arn: bucketArn,
        name: displayName,
        kind: 'infra',
        type: 'S3_BUCKET',
        account: accountContext,
        tags,
        metadata: {
          region: bucketRegion,
          bucketName,
          bucketArn,
          creationDate: bucket.CreationDate?.toISOString(),
          displayName,
          ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        },
      }),
    );
  }

  return { resources, warnings };
}

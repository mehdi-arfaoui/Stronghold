/**
 * Scans AWS DynamoDB tables.
 */

import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  ListTagsOfResourceCommand,
} from '@aws-sdk/client-dynamodb';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

export async function scanDynamoDbTables(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const dynamodb = createAwsClient(DynamoDBClient, options);
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();

  const tableNames = await paginateAws(
    (exclusiveStartTableName) =>
      dynamodb.send(
        new ListTablesCommand({ ExclusiveStartTableName: exclusiveStartTableName }),
        getAwsCommandOptions(options),
      ),
    (response) => response.TableNames,
    (response) => response.LastEvaluatedTableName,
  );

  const resources: DiscoveredResource[] = [];

  for (const tableName of tableNames) {
    const details = await dynamodb.send(
      new DescribeTableCommand({ TableName: tableName }),
      getAwsCommandOptions(options),
    );
    const table = details.Table;
    if (!table) continue;
    const replicaCount = table.Replicas?.length ?? 0;
    const tags = table.TableArn
      ? await fetchAwsTagsWithRetry(
          () =>
            dynamodb.send(
              new ListTagsOfResourceCommand({ ResourceArn: table.TableArn! }),
              getAwsCommandOptions(options),
            ),
          (response) => tagsArrayToMap(response.Tags),
          {
            description: `DynamoDB tag discovery unavailable in ${options.region}`,
            warnings,
            warningDeduper: tagWarnings,
          },
        )
      : {};
    const displayName = getNameTag(tags) ?? table.TableName ?? tableName;

    resources.push(
      buildResource({
        source: 'aws',
        externalId: table.TableArn ?? table.TableId ?? table.TableName ?? tableName,
        name: displayName,
        kind: 'infra',
        type: 'DYNAMODB',
        tags,
        metadata: {
          region: options.region,
          tableName: table.TableName,
          tableArn: table.TableArn,
          status: table.TableStatus,
          billingMode: table.BillingModeSummary?.BillingMode,
          itemCount: table.ItemCount,
          sizeBytes: table.TableSizeBytes,
          streamArn: table.LatestStreamArn,
          replicaCount,
          replicas: (table.Replicas ?? [])
            .map((replica) => ({
              regionName: replica.RegionName,
              replicaStatus: replica.ReplicaStatus,
            }))
            .filter((replica) => Boolean(replica.regionName)),
          globalTableVersion: table.GlobalTableVersion,
          globalTable: replicaCount > 0,
          displayName,
          ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        },
      }),
    );
  }

  return { resources, warnings };
}

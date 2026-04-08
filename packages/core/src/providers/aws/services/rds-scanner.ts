/**
 * Scans AWS RDS database instances.
 */

import {
  RDSClient,
  DescribeDBInstancesCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-rds';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

function isAuroraEngine(engine: string | undefined): boolean {
  return typeof engine === 'string' && engine.startsWith('aurora');
}

export async function scanRdsInstances(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const rds = createAwsClient(RDSClient, options);
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();

  const dbInstances = await paginateAws(
    (marker) =>
      rds.send(new DescribeDBInstancesCommand({ Marker: marker }), getAwsCommandOptions(options)),
    (response) => response.DBInstances,
    (response) => response.Marker,
  );

  const resources: DiscoveredResource[] = [];

  for (const db of dbInstances.filter((item) => !isAuroraEngine(item.Engine))) {
    const dbIdentifier = db.DBInstanceIdentifier ?? 'rds';
    const tags = db.DBInstanceArn
      ? await fetchAwsTagsWithRetry(
          () =>
            rds.send(
              new ListTagsForResourceCommand({ ResourceName: db.DBInstanceArn! }),
              getAwsCommandOptions(options),
            ),
          (response) => tagsArrayToMap(response.TagList),
          {
            description: `RDS tag discovery unavailable in ${options.region}`,
            warnings,
            warningDeduper: tagWarnings,
          },
        )
      : {};
    const displayName = getNameTag(tags) ?? dbIdentifier;

    resources.push(
      buildResource({
      source: 'aws',
      externalId: dbIdentifier,
      name: displayName,
      kind: 'infra',
      type: 'RDS',
      ip: db.Endpoint?.Address ?? null,
      tags,
      metadata: {
        dbIdentifier,
        dbArn: db.DBInstanceArn,
        engine: db.Engine,
        dbInstanceClass: db.DBInstanceClass,
        instanceClass: db.DBInstanceClass,
        status: db.DBInstanceStatus,
        region: options.region,
        multiAz: Boolean(db.MultiAZ),
        multi_az: Boolean(db.MultiAZ),
        isMultiAZ: Boolean(db.MultiAZ),
        backupRetentionPeriod: db.BackupRetentionPeriod ?? null,
        backupRetentionDays: db.BackupRetentionPeriod ?? null,
        readReplicaCount: db.ReadReplicaDBInstanceIdentifiers?.length ?? 0,
        replicaCount: db.ReadReplicaDBInstanceIdentifiers?.length ?? 0,
        readReplicaDBInstanceIdentifiers: (db.ReadReplicaDBInstanceIdentifiers ?? []).filter(
          (identifier): identifier is string => Boolean(identifier),
        ),
        readReplicaSourceDBInstanceIdentifier: db.ReadReplicaSourceDBInstanceIdentifier ?? null,
        storageEncrypted: Boolean(db.StorageEncrypted),
        encrypted: Boolean(db.StorageEncrypted),
        publiclyAccessible: db.PubliclyAccessible,
        availabilityZone: db.AvailabilityZone,
        endpointAddress: db.Endpoint?.Address,
        endpointPort: db.Endpoint?.Port,
        subnetId: db.DBSubnetGroup?.Subnets?.[0]?.SubnetIdentifier,
        vpcId: db.DBSubnetGroup?.VpcId,
        securityGroups: (db.VpcSecurityGroups ?? [])
          .map((group) => group.VpcSecurityGroupId)
          .filter((groupId): groupId is string => Boolean(groupId)),
        displayName,
        ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
      },
      }),
    );
  }

  return { resources, warnings };
}

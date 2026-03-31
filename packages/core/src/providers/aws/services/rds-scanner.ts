/**
 * Scans AWS RDS database instances.
 */

import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';

function isAuroraEngine(engine: string | undefined): boolean {
  return typeof engine === 'string' && engine.startsWith('aurora');
}

export async function scanRdsInstances(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const rds = createAwsClient(RDSClient, options);

  const dbInstances = await paginateAws(
    (marker) => rds.send(new DescribeDBInstancesCommand({ Marker: marker })),
    (response) => response.DBInstances,
    (response) => response.Marker,
  );

  return dbInstances
    .filter((db) => !isAuroraEngine(db.Engine))
    .map((db) => {
    const dbIdentifier = db.DBInstanceIdentifier ?? 'rds';
    return buildResource({
      source: 'aws',
      externalId: dbIdentifier,
      name: dbIdentifier,
      kind: 'infra',
      type: 'RDS',
      ip: db.Endpoint?.Address ?? null,
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
        displayName: dbIdentifier,
      },
    });
    });
}

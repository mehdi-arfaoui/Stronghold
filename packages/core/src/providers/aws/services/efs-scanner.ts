/**
 * Scans Amazon EFS file systems and mount targets.
 */

import {
  DescribeBackupPolicyCommand,
  DescribeFileSystemsCommand,
  DescribeMountTargetsCommand,
  DescribeReplicationConfigurationsCommand,
  EFSClient,
  type BackupPolicy,
  type Destination,
  type FileSystemDescription,
  type MountTargetDescription,
} from '@aws-sdk/client-efs';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createEfsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { buildResource, paginateAws } from '../scan-utils.js';

interface ReplicationSummary {
  readonly destinationFileSystemId: string;
  readonly destinationRegion: string;
  readonly status: string;
}

function readEfsTags(fileSystem: FileSystemDescription): string[] {
  const tags: string[] = [];
  for (const tag of fileSystem.Tags ?? []) {
    if (!tag?.Key || tag.Value == null) continue;
    tags.push(`${tag.Key}:${tag.Value}`);
  }
  return tags;
}

function summarizeReplication(destination: Destination): ReplicationSummary | null {
  if (!destination.FileSystemId || !destination.Region || !destination.Status) return null;
  return {
    destinationFileSystemId: destination.FileSystemId,
    destinationRegion: destination.Region,
    status: destination.Status,
  };
}

function buildFileSystemResource(
  fileSystem: FileSystemDescription,
  region: string,
  backupPolicy: BackupPolicy | null,
  replicationConfigurations: readonly ReplicationSummary[],
  mountTargets: readonly MountTargetDescription[],
): DiscoveredResource {
  const fileSystemId = fileSystem.FileSystemId ?? 'efs-filesystem';
  const name = fileSystem.Name ?? fileSystemId;
  return buildResource({
    source: 'aws',
    externalId: fileSystemId,
    name,
    kind: 'infra',
    type: 'EFS_FILESYSTEM',
    tags: readEfsTags(fileSystem),
    metadata: {
      region,
      fileSystemId,
      fileSystemArn: fileSystem.FileSystemArn,
      name,
      lifecycleState: fileSystem.LifeCycleState,
      performanceMode: fileSystem.PerformanceMode,
      throughputMode: fileSystem.ThroughputMode,
      encrypted: Boolean(fileSystem.Encrypted),
      sizeInBytes: fileSystem.SizeInBytes?.Value,
      numberOfMountTargets: fileSystem.NumberOfMountTargets,
      availabilityZoneName: fileSystem.AvailabilityZoneName ?? null,
      availabilityZoneId: fileSystem.AvailabilityZoneId ?? null,
      replicationConfigurations,
      backupPolicy: backupPolicy ? { status: backupPolicy.Status } : null,
      automaticBackups: backupPolicy?.Status === 'ENABLED',
      mountTargetIds: mountTargets.map((mountTarget) => mountTarget.MountTargetId),
      replicaRegions: replicationConfigurations.map((config) => config.destinationRegion),
      displayName: name,
    },
  });
}

function buildMountTargetResource(
  mountTarget: MountTargetDescription,
  region: string,
): DiscoveredResource {
  const mountTargetId = mountTarget.MountTargetId ?? 'efs-mount-target';
  return buildResource({
    source: 'aws',
    externalId: mountTargetId,
    name: mountTargetId,
    kind: 'infra',
    type: 'EFS_MOUNT_TARGET',
    ip: mountTarget.IpAddress ?? null,
    metadata: {
      region,
      mountTargetId,
      fileSystemId: mountTarget.FileSystemId,
      availabilityZoneId: mountTarget.AvailabilityZoneId,
      availabilityZoneName: mountTarget.AvailabilityZoneName,
      availabilityZone: mountTarget.AvailabilityZoneName,
      subnetId: mountTarget.SubnetId,
      vpcId: mountTarget.VpcId,
      ipAddress: mountTarget.IpAddress,
      lifecycleState: mountTarget.LifeCycleState,
      displayName: mountTargetId,
    },
  });
}

async function describeMountTargets(
  efs: EFSClient,
  fileSystemId: string,
): Promise<readonly MountTargetDescription[]> {
  return paginateAws(
    (marker) =>
      efs.send(
        new DescribeMountTargetsCommand({
          FileSystemId: fileSystemId,
          Marker: marker,
        }),
      ),
    (response) => response.MountTargets,
    (response) => response.NextMarker,
  );
}

export async function scanEfsFileSystems(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const efs = createEfsClient(options);
  const warnings: string[] = [];
  const resources: DiscoveredResource[] = [];
  const fileSystems = await paginateAws(
    (marker) => efs.send(new DescribeFileSystemsCommand({ Marker: marker })),
    (response) => response.FileSystems,
    (response) => response.NextMarker,
  );

  const replicationConfigurations = await paginateAws(
    (nextToken) =>
      efs.send(new DescribeReplicationConfigurationsCommand({ NextToken: nextToken })),
    (response) => response.Replications,
    (response) => response.NextToken,
  ).catch(() => {
    warnings.push(`EFS replication discovery unavailable in ${options.region}.`);
    return [];
  });

  const replicationsBySource = new Map<string, ReplicationSummary[]>();
  for (const replication of replicationConfigurations) {
    const sourceFileSystemId = replication.SourceFileSystemId;
    if (!sourceFileSystemId) continue;
    const current = replicationsBySource.get(sourceFileSystemId) ?? [];
    current.push(
      ...(replication.Destinations ?? [])
        .map((destination) => summarizeReplication(destination))
        .filter((destination): destination is ReplicationSummary => destination !== null),
    );
    replicationsBySource.set(sourceFileSystemId, current);
  }

  for (const fileSystem of fileSystems) {
    const fileSystemId = fileSystem.FileSystemId;
    if (!fileSystemId) continue;

    const mountTargets = await describeMountTargets(efs, fileSystemId).catch(() => {
      warnings.push(`EFS mount targets unavailable for filesystem ${fileSystemId}.`);
      return [] as readonly MountTargetDescription[];
    });

    const backupPolicy = await efs
      .send(new DescribeBackupPolicyCommand({ FileSystemId: fileSystemId }))
      .then((response) => response.BackupPolicy ?? null)
      .catch(() => {
        warnings.push(`EFS backup policy unavailable for filesystem ${fileSystemId}.`);
        return null;
      });

    resources.push(
      buildFileSystemResource(
        fileSystem,
        options.region,
        backupPolicy,
        replicationsBySource.get(fileSystemId) ?? [],
        mountTargets,
      ),
    );
    resources.push(...mountTargets.map((mountTarget) => buildMountTargetResource(mountTarget, options.region)));
  }

  return { resources, warnings };
}

/**
 * Scans Amazon EFS file systems and mount targets.
 */

import {
  DescribeBackupPolicyCommand,
  DescribeFileSystemsCommand,
  DescribeMountTargetsCommand,
  DescribeReplicationConfigurationsCommand,
  DescribeTagsCommand,
  EFSClient,
  type BackupPolicy,
  type Destination,
  type FileSystemDescription,
  type MountTargetDescription,
} from '@aws-sdk/client-efs';
import type { DiscoveredResource } from '../../../types/discovery.js';
import type { AccountContext } from '../../../identity/index.js';
import { createEfsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import {
  createAccountContextResolver,
  createResource,
  paginateAws,
} from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

interface ReplicationSummary {
  readonly destinationFileSystemId: string;
  readonly destinationRegion: string;
  readonly status: string;
}

function readEfsTags(fileSystem: FileSystemDescription): Record<string, string> {
  return tagsArrayToMap(fileSystem.Tags);
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
  accountContext: AccountContext,
  backupPolicy: BackupPolicy | null,
  replicationConfigurations: readonly ReplicationSummary[],
  mountTargets: readonly MountTargetDescription[],
  tags: Record<string, string>,
): DiscoveredResource {
  const fileSystemId = fileSystem.FileSystemId ?? 'efs-filesystem';
  const name = getNameTag(tags) ?? fileSystem.Name ?? fileSystemId;
  const fileSystemArn =
    fileSystem.FileSystemArn ??
    `arn:${accountContext.partition}:elasticfilesystem:${region}:${accountContext.accountId}:file-system/${fileSystemId}`;
  return createResource({
    source: 'aws',
    arn: fileSystemArn,
    name,
    kind: 'infra',
    type: 'EFS_FILESYSTEM',
    account: accountContext,
    tags,
    metadata: {
      region,
      fileSystemId,
      fileSystemArn,
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
      ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
    },
  });
}

function buildMountTargetResource(
  mountTarget: MountTargetDescription,
  region: string,
  accountContext: AccountContext,
): DiscoveredResource {
  const mountTargetId = mountTarget.MountTargetId ?? 'efs-mount-target';
  return createResource({
    source: 'aws',
    arn: `arn:${accountContext.partition}:elasticfilesystem:${region}:${accountContext.accountId}:mount-target/${mountTargetId}`,
    name: mountTargetId,
    kind: 'infra',
    type: 'EFS_MOUNT_TARGET',
    ip: mountTarget.IpAddress ?? null,
    account: accountContext,
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
  options: AwsClientOptions,
  fileSystemId: string,
): Promise<readonly MountTargetDescription[]> {
  return paginateAws(
    (marker) =>
      efs.send(
        new DescribeMountTargetsCommand({
          FileSystemId: fileSystemId,
          Marker: marker,
        }),
        getAwsCommandOptions(options),
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
  const tagWarnings = new Set<string>();
  const accountContext = await createAccountContextResolver(options)();
  const fileSystems = await paginateAws(
    (marker) =>
      efs.send(new DescribeFileSystemsCommand({ Marker: marker }), getAwsCommandOptions(options)),
    (response) => response.FileSystems,
    (response) => response.NextMarker,
  );

  const replicationConfigurations = await paginateAws(
    (nextToken) =>
      efs.send(
        new DescribeReplicationConfigurationsCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
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

    const mountTargets = await describeMountTargets(efs, options, fileSystemId).catch(() => {
      warnings.push(`EFS mount targets unavailable for filesystem ${fileSystemId}.`);
      return [] as readonly MountTargetDescription[];
    });

    const backupPolicy = await efs.send(
      new DescribeBackupPolicyCommand({ FileSystemId: fileSystemId }),
      getAwsCommandOptions(options),
    )
      .then((response) => response.BackupPolicy ?? null)
      .catch(() => {
        warnings.push(`EFS backup policy unavailable for filesystem ${fileSystemId}.`);
        return null;
      });
    const fetchedTags = await fetchAwsTagsWithRetry(
      () =>
        efs.send(
          new DescribeTagsCommand({ FileSystemId: fileSystemId }),
          getAwsCommandOptions(options),
        ),
      (response) => tagsArrayToMap(response.Tags),
      {
        description: `EFS tag discovery unavailable in ${options.region}`,
        warnings,
        warningDeduper: tagWarnings,
      },
    );
    const tags = Object.keys(fetchedTags).length > 0 ? fetchedTags : readEfsTags(fileSystem);

    resources.push(
      buildFileSystemResource(
        fileSystem,
        options.region,
        accountContext,
        backupPolicy,
        replicationsBySource.get(fileSystemId) ?? [],
        mountTargets,
        tags,
      ),
    );
    resources.push(
      ...mountTargets.map((mountTarget) =>
        buildMountTargetResource(mountTarget, options.region, accountContext),
      ),
    );
  }

  return { resources, warnings };
}

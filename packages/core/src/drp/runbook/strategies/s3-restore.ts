import { readBoolean, readNumber, readString } from '../../../graph/analysis-helpers.js';
import {
  awsCli,
  componentRunbook,
  createStep,
  resolveIdentifier,
  resolveRegion,
  resolveSecondaryRegion,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateS3Runbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  if (hasReplication(metadata)) {
    return buildReplicationRunbook(componentId, componentName, componentType, strategy, metadata);
  }
  if (hasVersioning(metadata)) {
    return buildVersioningRunbook(componentId, componentName, componentType, strategy, metadata);
  }
  return buildBackupRunbook(componentId, componentName, componentType, strategy, metadata);
}

function buildVersioningRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const bucketName = resolveIdentifier(metadata, ['bucketName'], componentId);
  const region = resolveRegion(metadata);
  const listVersions = `aws s3api list-object-versions --bucket ${bucketName} --prefix <PREFIX> --region ${region}`;
  const restoreVersion =
    `aws s3api get-object --bucket ${bucketName} --key <KEY> --version-id <VERSION_ID> restored-<KEY> --region ${region}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: [
      'Identify the object keys or prefixes affected by the incident.',
      'Confirm whether you need a local retrieval only or an in-place object re-upload afterward.',
    ],
    steps: [
      createStep({
        order: 1,
        title: 'List bucket object versions',
        description: 'Inspect available object versions under the affected prefix.',
        command: awsCli(listVersions, 'Lists object versions for the target bucket and prefix.'),
        estimatedMinutes: 1,
      }),
      createStep({
        order: 2,
        title: 'Retrieve the required object version',
        description: 'Download the chosen version so it can be reviewed and re-uploaded if needed.',
        command: awsCli(restoreVersion, 'Downloads the selected object version to the local workstation.'),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: [
          'Replace <PREFIX>, <KEY>, and <VERSION_ID> with values identified in the previous step.',
          'For large-scale restoration, prefer a scripted aws s3 sync workflow and validate object counts carefully.',
        ],
      }),
    ],
    rollback: rollback('Remove any incorrectly restored objects or revert the application to the original object version.', [
      createStep({
        order: 1,
        title: 'Re-delete or replace the restored object version',
        description: 'Undo any manual re-upload that was based on the downloaded version.',
        command: { type: 'manual', description: 'Delete the re-uploaded object or restore the correct current version.' },
        estimatedMinutes: 5,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(
      `aws s3 ls s3://${bucketName} --region ${region}`,
      'The bucket is reachable and object listing succeeds.',
    ),
    warnings: ['Downloading an older version does not change bucket contents until you re-upload it or copy it in place.'],
  });
}

function buildReplicationRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const bucketName = resolveIdentifier(metadata, ['bucketName'], componentId);
  const replicaBucket = readString(metadata.replicaBucketName) ?? '<REPLICA_BUCKET>';
  const replicaRegion = resolveSecondaryRegion(metadata) ?? resolveRegion(metadata);
  const verifyReplica = `aws s3 ls s3://${replicaBucket} --region ${replicaRegion}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Confirm the replica bucket name, access path, and any application configuration overrides.'],
    steps: [
      createStep({
        order: 1,
        title: 'Point the application to the replica bucket',
        description: 'Cut traffic over to the replicated S3 bucket in the DR region.',
        command: { type: 'manual', description: `Update the application to read from ${replicaBucket} instead of ${bucketName}.` },
        estimatedMinutes: 10,
        requiresApproval: true,
        notes: ['If the replica bucket name was not discovered, replace <REPLICA_BUCKET> before executing the validation step.'],
      }),
      createStep({
        order: 2,
        title: 'Verify replica bucket access',
        description: 'Confirm that the DR bucket is accessible from the operator environment.',
        command: awsCli(verifyReplica, 'Lists objects from the replica bucket.'),
        estimatedMinutes: 1,
        verification: verification(verifyReplica, 'The replica bucket contents can be listed successfully.'),
      }),
    ],
    rollback: rollback('Point the application back to the primary bucket once the original path is healthy again.', [
      createStep({
        order: 1,
        title: 'Restore the original bucket target',
        description: 'Undo the application configuration change and resume using the source bucket.',
        command: { type: 'manual', description: `Revert application configuration to use ${bucketName}.` },
        estimatedMinutes: 10,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(verifyReplica, 'The replica bucket remains accessible after cutover.'),
  });
}

function buildBackupRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const bucketName = resolveIdentifier(metadata, ['bucketName'], componentId);
  const bucketArn = readString(metadata.bucketArn) ?? `arn:aws:s3:::${bucketName}`;
  const region = resolveRegion(metadata);

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Identify the AWS Backup restore role and metadata template used for S3 restores in your account.'],
    steps: [
      createStep({
        order: 1,
        title: 'List AWS Backup recovery points',
        description: 'Enumerate available S3 recovery points for this bucket.',
        command: awsCli(
          `aws backup list-recovery-points-by-resource --resource-arn ${bucketArn} --region ${region}`,
          'Lists AWS Backup recovery points for the bucket.',
        ),
        estimatedMinutes: 1,
      }),
      createStep({
        order: 2,
        title: 'Start the restore job',
        description: 'Launch an AWS Backup restore using the selected recovery point ARN and your approved restore role.',
        command: awsCli(
          `aws backup start-restore-job --recovery-point-arn <RECOVERY_POINT_ARN> --iam-role-arn <RESTORE_ROLE_ARN> --metadata <RESTORE_METADATA_JSON> --region ${region}`,
          'Starts an AWS Backup restore job for the S3 bucket.',
        ),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: ['Replace the placeholders with your selected recovery point ARN, restore role ARN, and restore metadata JSON.'],
      }),
    ],
    rollback: rollback('Remove incorrectly restored objects or revert consumers back to the original bucket path.', [
      createStep({
        order: 1,
        title: 'Clean up the restored content',
        description: 'Undo the AWS Backup restore outcome if it does not match the desired recovery point.',
        command: { type: 'manual', description: 'Delete the restored objects or re-point applications back to the original bucket.' },
        estimatedMinutes: 10,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(
      `aws s3 ls s3://${bucketName} --region ${region}`,
      'The bucket is reachable after the restore workflow completes.',
    ),
    warnings: ['AWS Backup restore inputs vary by account policy and restore target configuration.'],
  });
}

function hasVersioning(metadata: Record<string, unknown>): boolean {
  return (readString(metadata.versioningStatus) ?? '').toLowerCase() === 'enabled';
}

function hasReplication(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.hasCrossRegionReplication) === true ||
    (readNumber(metadata.replicationRules) ?? 0) > 0
  );
}

registerRunbookStrategy('s3', '*', generateS3Runbook);
registerRunbookStrategy('s3-bucket', '*', generateS3Runbook);

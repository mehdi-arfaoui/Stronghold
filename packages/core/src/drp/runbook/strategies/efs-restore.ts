import { readString } from '../../../graph/analysis-helpers.js';
import {
  awsCli,
  componentRunbook,
  createCollisionSafeSuffix,
  createStep,
  resolveIdentifier,
  resolveRegion,
  resolveReplicationDestination,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateEfsRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  return resolveReplicationDestination(metadata)
    ? buildReplicationRunbook(componentId, componentName, componentType, strategy, metadata)
    : buildBackupRunbook(componentId, componentName, componentType, strategy, metadata);
}

function buildReplicationRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const destination = resolveReplicationDestination(metadata) ?? {};
  const replicaId = readString(destination.destinationFileSystemId) ?? '<REPLICA_FILE_SYSTEM_ID>';
  const replicaRegion = readString(destination.destinationRegion) ?? resolveRegion(metadata);
  const verifyReplica = `aws efs describe-file-systems --file-system-id ${replicaId} --region ${replicaRegion}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Confirm the application mount targets or DNS entries that must be updated to point to the replica filesystem.'],
    steps: [
      createStep({
        order: 1,
        title: 'Verify the replicated filesystem',
        description: 'Confirm that the destination EFS filesystem exists and is available.',
        command: awsCli(verifyReplica, 'Describes the replicated EFS filesystem in the DR region.'),
        estimatedMinutes: 1,
        verification: verification(verifyReplica, 'The replica filesystem details are returned successfully.'),
      }),
      createStep({
        order: 2,
        title: 'Update application mount targets',
        description: 'Move applications, mount targets, or DNS references to the replica filesystem.',
        command: { type: 'manual', description: 'Update application mount targets to the replicated EFS filesystem.' },
        estimatedMinutes: 15,
        requiresApproval: true,
      }),
    ],
    rollback: rollback('Switch clients back to the original filesystem once it is healthy again.', [
      createStep({
        order: 1,
        title: 'Restore original mounts',
        description: 'Revert application mount targets to the original filesystem.',
        command: { type: 'manual', description: 'Revert application mount targets to the source EFS filesystem.' },
        estimatedMinutes: 15,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(verifyReplica, 'The replica filesystem remains available after cutover.'),
  });
}

function buildBackupRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const efsId = resolveIdentifier(metadata, ['fileSystemId'], componentId);
  const efsArn = readString(metadata.fileSystemArn) ?? componentId;
  const region = resolveRegion(metadata);
  const suffix = createCollisionSafeSuffix();
  const creationToken = `${efsId}-dr-${suffix}`;
  const performanceMode = readString(metadata.performanceMode) ?? 'generalPurpose';
  const pollCommand =
    `aws efs describe-file-systems --creation-token ${creationToken} --region ${region}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Identify the AWS Backup restore role used for EFS restores in this account.'],
    steps: [
      createStep({
        order: 1,
        title: 'List AWS Backup recovery points',
        description: 'Enumerate the EFS recovery points available for this filesystem.',
        command: awsCli(
          `aws backup list-recovery-points-by-resource --resource-arn ${efsArn} --region ${region}`,
          'Lists AWS Backup recovery points for the EFS filesystem.',
        ),
        estimatedMinutes: 1,
      }),
      createStep({
        order: 2,
        title: 'Start the restore job',
        description: 'Launch an EFS restore into a new filesystem.',
        command: awsCli(
          `aws backup start-restore-job --recovery-point-arn <RECOVERY_POINT_ARN> --iam-role-arn <RESTORE_ROLE_ARN> --metadata "{\\"file-system-id\\":\\"\\",\\"newFileSystem\\":\\"true\\",\\"CreationToken\\":\\"${creationToken}\\",\\"PerformanceMode\\":\\"${performanceMode}\\"}" --region ${region}`,
          'Starts an AWS Backup restore into a new EFS filesystem.',
        ),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: ['Replace <RECOVERY_POINT_ARN> and <RESTORE_ROLE_ARN> before running this command.'],
      }),
      createStep({
        order: 3,
        title: 'Poll for the restored filesystem',
        description: 'Re-run the describe command until the restored filesystem appears and reaches the available state.',
        command: awsCli(pollCommand, 'Polls the EFS filesystem that matches the restore creation token.'),
        estimatedMinutes: null,
        notes: ['EFS has no AWS CLI wait command for restore completion. Re-run this describe command every 30-60 seconds.'],
      }),
    ],
    rollback: rollback('Delete the restored filesystem if the restore result is not needed.', [
      createStep({
        order: 1,
        title: 'Delete the restored filesystem',
        description: 'Remove the filesystem created by the restore workflow.',
        command: awsCli(
          `aws efs delete-file-system --file-system-id <RESTORED_FILE_SYSTEM_ID> --region ${region}`,
          'Deletes the restored EFS filesystem.',
        ),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: ['Use the filesystem ID returned by the polling command once the restore finishes.'],
      }),
    ]),
    finalValidation: verification(pollCommand, 'A filesystem created with the restore token is returned.'),
  });
}

registerRunbookStrategy('efs', '*', {
  generate: generateEfsRunbook,
  executionRisk: 'caution',
  riskReason: 'EFS replication and mount-target changes can affect clients and should be scheduled.',
});
registerRunbookStrategy('efs-filesystem', '*', {
  generate: generateEfsRunbook,
  executionRisk: 'caution',
  riskReason: 'EFS replication and mount-target changes can affect clients and should be scheduled.',
});

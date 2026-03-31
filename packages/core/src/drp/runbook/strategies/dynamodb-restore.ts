import { readString } from '../../../graph/analysis-helpers.js';
import {
  awsCli,
  awsWait,
  componentRunbook,
  createCollisionSafeSuffix,
  createStep,
  hasPointInTimeRecovery,
  resolveIdentifier,
  resolveRegion,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateDynamoDbRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  return hasPointInTimeRecovery(metadata)
    ? buildPitrRunbook(componentId, componentName, componentType, strategy, metadata)
    : buildBackupRunbook(componentId, componentName, componentType, strategy, metadata);
}

function buildPitrRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const tableName = resolveIdentifier(metadata, ['tableName'], componentId);
  const region = resolveRegion(metadata);
  const targetTableName = `${tableName}-dr-${createCollisionSafeSuffix()}`;
  const verifyCommand =
    `aws dynamodb describe-table --table-name ${targetTableName} --query "Table.TableStatus" --region ${region}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Confirm the application can be pointed to a replacement table name after restore.'],
    steps: [
      createStep({
        order: 1,
        title: 'Restore the table to the latest restorable point',
        description: 'Create a new DynamoDB table using point-in-time recovery.',
        command: awsCli(
          `aws dynamodb restore-table-to-point-in-time --source-table-name ${tableName} --target-table-name ${targetTableName} --use-latest-restorable-date-time --region ${region}`,
          'Starts a DynamoDB PITR restore into a new table.',
        ),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: [
          `Target table name: ${targetTableName}. If a previous restore exists with a similar name, change it before running.`,
        ],
      }),
      createStep({
        order: 2,
        title: 'Wait for the restored table',
        description: 'Block until the new table exists.',
        command: awsWait(
          `aws dynamodb wait table-exists --table-name ${targetTableName} --region ${region}`,
          'Waits until the restored table exists.',
        ),
        estimatedMinutes: null,
      }),
      createStep({
        order: 3,
        title: 'Verify restored table status',
        description: 'Confirm that the target table is active.',
        command: awsCli(verifyCommand, 'Reads the restored table status.'),
        estimatedMinutes: 1,
        verification: verification(verifyCommand, 'The table status is ACTIVE.'),
      }),
    ],
    rollback: rollback('Delete the restored table if the recovery point or schema is not the desired one.', [
      createStep({
        order: 1,
        title: 'Delete the restored table',
        description: 'Remove the replacement table created for this DR attempt.',
        command: awsCli(
          `aws dynamodb delete-table --table-name ${targetTableName} --region ${region}`,
          'Deletes the restored DynamoDB table.',
        ),
        estimatedMinutes: 1,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(verifyCommand, 'The restored table is ACTIVE.'),
  });
}

function buildBackupRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const tableName = resolveIdentifier(metadata, ['tableName'], componentId);
  const tableArn =
    readString(metadata.tableArn) ?? `arn:aws:dynamodb:${resolveRegion(metadata)}:ACCOUNT_ID:table/${tableName}`;
  const region = resolveRegion(metadata);
  const targetTableName = `${tableName}-dr-${createCollisionSafeSuffix()}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Identify the AWS Backup recovery point ARN and restore metadata for the target table.'],
    steps: [
      createStep({
        order: 1,
        title: 'List backup recovery points',
        description: 'Enumerate the DynamoDB recovery points available in AWS Backup.',
        command: awsCli(
          `aws backup list-recovery-points-by-resource --resource-arn ${tableArn} --region ${region}`,
          'Lists AWS Backup recovery points for the table.',
        ),
        estimatedMinutes: 1,
      }),
      createStep({
        order: 2,
        title: 'Start the restore job',
        description: 'Launch an AWS Backup restore into a new target table.',
        command: awsCli(
          `aws backup start-restore-job --recovery-point-arn <RECOVERY_POINT_ARN> --iam-role-arn <RESTORE_ROLE_ARN> --metadata "{\\"targetTableName\\":\\"${targetTableName}\\"}" --region ${region}`,
          'Starts an AWS Backup restore for the DynamoDB table.',
        ),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: ['Replace <RECOVERY_POINT_ARN> and <RESTORE_ROLE_ARN> before running this command.'],
      }),
      createStep({
        order: 3,
        title: 'Wait for the restored table',
        description: 'Block until the replacement table exists.',
        command: awsWait(
          `aws dynamodb wait table-exists --table-name ${targetTableName} --region ${region}`,
          'Waits until the restored table exists.',
        ),
        estimatedMinutes: null,
      }),
    ],
    rollback: rollback('Delete the restored table if the selected backup is incorrect.', [
      createStep({
        order: 1,
        title: 'Delete the restored table',
        description: 'Remove the replacement table created for this recovery attempt.',
        command: awsCli(
          `aws dynamodb delete-table --table-name ${targetTableName} --region ${region}`,
          'Deletes the restored DynamoDB table.',
        ),
        estimatedMinutes: 1,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(
      `aws dynamodb describe-table --table-name ${targetTableName} --query "Table.TableStatus" --region ${region}`,
      'The restored table is ACTIVE.',
    ),
  });
}

registerRunbookStrategy('dynamodb', '*', generateDynamoDbRunbook);
registerRunbookStrategy('dynamodb-table', '*', generateDynamoDbRunbook);

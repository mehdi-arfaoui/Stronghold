import {
  awsCli,
  awsWait,
  componentRunbook,
  createCollisionSafeSuffix,
  createStep,
  hasLatestRestorableTime,
  joinCliValues,
  resolveIdentifier,
  resolveRegion,
  resolveSecurityGroups,
  resolveSubnetGroupName,
  rollback,
  verification,
  withOption,
} from '../runbook-helpers.js';
import { readString } from '../../../graph/analysis-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateRdsRestoreRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const dbId = resolveIdentifier(metadata, ['dbIdentifier', 'dbInstanceIdentifier'], componentId);
  const region = resolveRegion(metadata);
  const suffix = createCollisionSafeSuffix();
  const targetId = `${dbId}-dr-${suffix}`;
  const instanceClass =
    readString(metadata.instanceClass) ??
    readString(metadata.dbInstanceClass) ??
    'db.t3.medium';
  const subnetGroup = resolveSubnetGroupName(metadata);
  const securityGroups = joinCliValues(resolveSecurityGroups(metadata));
  const baseRestoreCommand = withOption(
    withOption(
      withOption(
        `--db-instance-class ${instanceClass}`,
        '--db-subnet-group-name',
        subnetGroup,
      ),
      '--vpc-security-group-ids',
      securityGroups || null,
    ),
    '--region',
    region,
  );
  const verifyCommand = `aws rds describe-db-instances --db-instance-identifier ${targetId} --region ${region} --query "DBInstances[0].[DBInstanceStatus,Endpoint.Address]"`;
  const steps = hasLatestRestorableTime(metadata)
    ? buildPitrSteps(dbId, targetId, region, baseRestoreCommand, verifyCommand)
    : buildSnapshotSteps(dbId, targetId, region, baseRestoreCommand, verifyCommand);

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: [
      'Confirm VPC networking, subnet group, and security groups for the restored database.',
      'Confirm the application failover path for the new endpoint before changing traffic.',
    ],
    steps,
    rollback: rollback('Delete the restored instance if the recovery attempt fails or uses the wrong recovery point.', [
      createStep({
        order: 1,
        title: 'Delete the restored instance',
        description: 'Removes the new database instance created for this DR attempt.',
        command: awsCli(
          `aws rds delete-db-instance --db-instance-identifier ${targetId} --skip-final-snapshot --region ${region}`,
          'Deletes the restored RDS instance without taking a final snapshot.',
        ),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: ['Only run this after confirming no application traffic depends on the restored instance.'],
      }),
    ]),
    finalValidation: verification(verifyCommand, 'The restored instance is available and exposes an endpoint address.'),
    warnings: ['The restored database uses a new identifier and a new endpoint address.'],
  });
}

function buildPitrSteps(
  dbId: string,
  targetId: string,
  region: string,
  baseRestoreCommand: string,
  verifyCommand: string,
): readonly ReturnType<typeof createStep>[] {
  const restoreCommand =
    `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier ${dbId} --target-db-instance-identifier ${targetId} --use-latest-restorable-time ${baseRestoreCommand}`;

  return [
    createStep({
      order: 1,
      title: 'Restore the instance to the latest restorable time',
      description: 'Create a new database instance from transaction-log based point-in-time recovery.',
      command: awsCli(restoreCommand, 'Starts an RDS point-in-time restore into a new instance.'),
      estimatedMinutes: 2,
      requiresApproval: true,
      notes: [
        `Target identifier: ${targetId}. If a previous restore attempt exists with a similar name, change this identifier before running.`,
      ],
    }),
    createStep({
      order: 2,
      title: 'Wait for the restored instance',
      description: 'Block until the restored database is available.',
      command: awsWait(
        `aws rds wait db-instance-available --db-instance-identifier ${targetId} --region ${region}`,
        'Blocks until the restored instance reports as available.',
      ),
      estimatedMinutes: null,
      notes: ['This command blocks until the new instance is ready.'],
    }),
    createStep({
      order: 3,
      title: 'Verify status and endpoint',
      description: 'Confirm that the restored database is healthy and exposes a new endpoint.',
      command: awsCli(verifyCommand, 'Reads the restored instance status and endpoint address.'),
      estimatedMinutes: 1,
      verification: verification(verifyCommand, 'The instance status is available and an endpoint address is returned.'),
    }),
    createStep({
      order: 4,
      title: 'Update application configuration',
      description: 'Point the application, secrets, or DNS to the restored database endpoint.',
      command: { type: 'manual', description: 'Update the application configuration to use the restored endpoint.' },
      estimatedMinutes: 10,
      requiresApproval: true,
      notes: ['Do this only after validating the restored data set and endpoint connectivity.'],
    }),
  ];
}

function buildSnapshotSteps(
  dbId: string,
  targetId: string,
  region: string,
  baseRestoreCommand: string,
  verifyCommand: string,
): readonly ReturnType<typeof createStep>[] {
  const snapshotLookup =
    `aws rds describe-db-snapshots --db-instance-identifier ${dbId} --query "reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].DBSnapshotIdentifier" --output text --region ${region}`;
  const restoreCommand =
    `aws rds restore-db-instance-from-db-snapshot --db-instance-identifier ${targetId} --db-snapshot-identifier <SNAPSHOT_ID> ${baseRestoreCommand}`;

  return [
    createStep({
      order: 1,
      title: 'Find the latest snapshot',
      description: 'List snapshots and capture the newest snapshot identifier.',
      command: awsCli(snapshotLookup, 'Returns the newest DB snapshot identifier for this instance.'),
      estimatedMinutes: 1,
    }),
    createStep({
      order: 2,
      title: 'Restore from the selected snapshot',
      description: 'Create a new database instance from the chosen snapshot.',
      command: awsCli(restoreCommand, 'Starts an RDS snapshot restore into a new instance.'),
      estimatedMinutes: 2,
      requiresApproval: true,
      notes: [
        'Replace <SNAPSHOT_ID> with the value returned by the previous step.',
        `Target identifier: ${targetId}. If a previous restore attempt exists with a similar name, change this identifier before running.`,
      ],
    }),
    createStep({
      order: 3,
      title: 'Wait for the restored instance',
      description: 'Block until the restored database is available.',
      command: awsWait(
        `aws rds wait db-instance-available --db-instance-identifier ${targetId} --region ${region}`,
        'Blocks until the restored instance reports as available.',
      ),
      estimatedMinutes: null,
      notes: ['This command blocks until the new instance is ready.'],
    }),
    createStep({
      order: 4,
      title: 'Verify status and endpoint',
      description: 'Confirm that the restored database is healthy and exposes a new endpoint.',
      command: awsCli(verifyCommand, 'Reads the restored instance status and endpoint address.'),
      estimatedMinutes: 1,
      verification: verification(verifyCommand, 'The instance status is available and an endpoint address is returned.'),
    }),
    createStep({
      order: 5,
      title: 'Update application configuration',
      description: 'Point the application, secrets, or DNS to the restored database endpoint.',
      command: { type: 'manual', description: 'Update the application configuration to use the restored endpoint.' },
      estimatedMinutes: 10,
      requiresApproval: true,
      notes: ['Do this only after validating the restored data set and endpoint connectivity.'],
    }),
  ];
}

registerRunbookStrategy('rds', 'backup_restore', {
  generate: generateRdsRestoreRunbook,
  executionRisk: 'safe',
  riskReason: 'Backup posture improvements on RDS are usually additive and do not require downtime.',
});
registerRunbookStrategy('rds-instance', 'backup_restore', {
  generate: generateRdsRestoreRunbook,
  executionRisk: 'safe',
  riskReason: 'Backup posture improvements on RDS are usually additive and do not require downtime.',
});

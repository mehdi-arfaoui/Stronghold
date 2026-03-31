import {
  awsCli,
  awsWait,
  componentRunbook,
  createStep,
  resolveIdentifier,
  resolveRegion,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateRdsFailoverRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const dbId = resolveIdentifier(metadata, ['dbIdentifier', 'dbInstanceIdentifier'], componentId);
  const region = resolveRegion(metadata);
  const failoverCommand = `aws rds reboot-db-instance --db-instance-identifier ${dbId} --force-failover --region ${region}`;
  const azVerification = `aws rds describe-db-instances --db-instance-identifier ${dbId} --region ${region} --query "DBInstances[0].AvailabilityZone"`;
  const finalCheck = `aws rds describe-db-instances --db-instance-identifier ${dbId} --region ${region} --query "DBInstances[0].[DBInstanceStatus,AvailabilityZone]"`;
  const steps = [
    createStep({
      order: 1,
      title: 'Initiate Multi-AZ failover',
      description: 'Force RDS to fail over to the standby instance.',
      command: awsCli(failoverCommand, 'Forces a Multi-AZ failover on the current RDS instance.'),
      estimatedMinutes: 1,
      requiresApproval: true,
      notes: [
        'WARNING: This is NOT a simple reboot. --force-failover forces a Multi-AZ failover, causing 60-120 seconds of downtime.',
        'Applications using the RDS endpoint will reconnect automatically after the failover.',
        'Only use this during an actual disaster or a planned DR test in a maintenance window.',
      ],
    }),
    createStep({
      order: 2,
      title: 'Wait for the instance to become available',
      description: 'Block until the primary instance is healthy again.',
      command: awsWait(
        `aws rds wait db-instance-available --db-instance-identifier ${dbId} --region ${region}`,
        'Blocks until the instance reports the available state.',
      ),
      estimatedMinutes: null,
      notes: [
        'This command blocks the terminal until the instance is ready.',
        'AWS CLI wait commands time out after roughly 30 minutes by default.',
      ],
    }),
    createStep({
      order: 3,
      title: 'Verify the new Availability Zone',
      description: 'Confirm that the writer is now running in the expected alternate AZ.',
      command: awsCli(azVerification, 'Reads the active Availability Zone for the instance.'),
      estimatedMinutes: 1,
      verification: verification(azVerification, 'A different Availability Zone than before the failover.'),
    }),
    createStep({
      order: 4,
      title: 'Verify application connectivity',
      description: 'Run the application smoke test against the existing RDS endpoint.',
      command: { type: 'manual', description: 'Check application connectivity and error rates.' },
      estimatedMinutes: 5,
      notes: ['Validate writes, reads, connection pool recovery, and latency from the application tier.'],
    }),
  ];

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: [
      'Confirm this instance is configured for Multi-AZ.',
      'Notify stakeholders about the expected 60-120 second database interruption.',
    ],
    steps,
    rollback: rollback('Fail over back to the other AZ once the original path is healthy again.', [
      createStep({
        order: 1,
        title: 'Trigger a second failover',
        description: 'Repeat the forced failover to move the writer back to the alternate AZ.',
        command: awsCli(failoverCommand, 'Forces a second Multi-AZ failover.'),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: ['Use this only after confirming the original zone and dependencies are healthy again.'],
      }),
    ]),
    finalValidation: verification(finalCheck, 'The instance status is available and the writer is serving traffic.'),
    warnings: ['This procedure introduces a brief outage and should be tested before production use.'],
  });
}

registerRunbookStrategy('rds', 'hot_standby', generateRdsFailoverRunbook);
registerRunbookStrategy('rds-instance', 'hot_standby', generateRdsFailoverRunbook);

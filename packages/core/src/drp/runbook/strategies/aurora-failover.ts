import {
  awsCli,
  awsWait,
  componentRunbook,
  createStep,
  resolveAuroraWriterId,
  resolveIdentifier,
  resolveRegion,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateAuroraFailoverRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const clusterId = resolveIdentifier(metadata, ['dbClusterIdentifier'], componentId);
  const region = resolveRegion(metadata);
  const originalWriterId = resolveAuroraWriterId(metadata);
  const verifyWriter =
    `aws rds describe-db-clusters --db-cluster-identifier ${clusterId} --region ${region} --query "DBClusters[0].DBClusterMembers[?IsClusterWriter==\\\`true\\\`].DBInstanceIdentifier"`;
  const rollbackCommand = originalWriterId
    ? `aws rds failover-db-cluster --db-cluster-identifier ${clusterId} --target-db-instance-identifier ${originalWriterId} --region ${region}`
    : `aws rds failover-db-cluster --db-cluster-identifier ${clusterId} --region ${region}`;
  const rollbackNotes = originalWriterId
    ? []
    : ['The original writer was not identified in scan metadata, so rollback uses an untargeted failover.'];

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Verify that the cluster has at least one healthy reader instance before forcing failover.'],
    steps: [
      createStep({
        order: 1,
        title: 'Initiate Aurora cluster failover',
        description: 'Promote a reader instance to become the new writer.',
        command: awsCli(
          `aws rds failover-db-cluster --db-cluster-identifier ${clusterId} --region ${region}`,
          'Triggers an Aurora cluster failover.',
        ),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: [
          'Aurora failover typically completes in about 30 seconds.',
          'The cluster endpoint does not change during a standard Aurora failover.',
        ],
      }),
      createStep({
        order: 2,
        title: 'Wait for the cluster to become available',
        description: 'Block until Aurora finishes writer promotion.',
        command: awsWait(
          `aws rds wait db-cluster-available --db-cluster-identifier ${clusterId} --region ${region}`,
          'Blocks until the Aurora cluster is available again.',
        ),
        estimatedMinutes: null,
      }),
      createStep({
        order: 3,
        title: 'Verify the new writer',
        description: 'Read the cluster member list and identify the promoted writer instance.',
        command: awsCli(verifyWriter, 'Lists the current Aurora writer instance identifier.'),
        estimatedMinutes: 1,
        verification: verification(verifyWriter, 'A new writer instance identifier is returned.'),
      }),
      createStep({
        order: 4,
        title: 'Verify application connectivity',
        description: 'Run application smoke tests against the cluster endpoint.',
        command: { type: 'manual', description: 'Validate application read/write connectivity.' },
        estimatedMinutes: 5,
      }),
    ],
    rollback: rollback('Fail over back to the original writer if you need to restore the initial topology.', [
      createStep({
        order: 1,
        title: 'Fail over back to the original writer',
        description: 'Promote the original writer again if it is healthy.',
        command: awsCli(rollbackCommand, 'Triggers an Aurora failover back toward the original writer.'),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: rollbackNotes,
      }),
    ]),
    finalValidation: verification(
      `aws rds describe-db-clusters --db-cluster-identifier ${clusterId} --region ${region} --query "DBClusters[0].[Status,Endpoint,ReaderEndpoint]"`,
      'The cluster is available and both writer and reader endpoints are returned.',
    ),
  });
}

registerRunbookStrategy('aurora-cluster', 'aurora_failover', {
  generate: generateAuroraFailoverRunbook,
  executionRisk: 'caution',
  riskReason: 'Aurora failover and topology changes can cause a brief interruption and should be planned.',
});

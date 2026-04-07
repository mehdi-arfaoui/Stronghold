import { readString } from '../../../graph/analysis-helpers.js';
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

function generateAuroraGlobalFailoverRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const globalId = resolveIdentifier(metadata, ['globalClusterIdentifier'], componentId);
  const secondaryClusterArn = readString(metadata.secondaryClusterArn) ?? '<SECONDARY_CLUSTER_ARN>';
  const secondaryClusterId =
    readString(metadata.secondaryClusterId) ??
    resolveIdentifier(metadata, ['dbClusterIdentifier'], componentId);
  const primaryRegion = readString(metadata.primaryRegion) ?? resolveRegion(metadata);
  const secondaryRegion = resolveSecondaryRegion(metadata) ?? resolveRegion(metadata);
  const validateSecondary =
    `aws rds describe-db-clusters --db-cluster-identifier ${secondaryClusterId} --region ${secondaryRegion} --query "DBClusters[0].[Status,Endpoint]"`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: [
      'Decide whether you can use a planned switchover or if the primary region is fully unavailable.',
      'Prepare any DNS or application endpoint cutover steps before promoting the secondary cluster.',
    ],
    steps: [
      createStep({
        order: 1,
        title: 'Perform a planned global switchover',
        description: 'Use this path first when the primary cluster is reachable and data consistency can be preserved.',
        command: awsCli(
          `aws rds switchover-global-cluster --global-cluster-identifier ${globalId} --target-db-cluster-identifier ${secondaryClusterArn} --region ${primaryRegion}`,
          'Performs a planned Aurora global database switchover.',
        ),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: ['Planned switchover preserves data and should be preferred whenever the primary region is reachable.'],
      }),
      createStep({
        order: 2,
        title: 'Perform an unplanned detach-and-promote failover',
        description: 'Use this path only when the primary region is unreachable and you must promote the secondary cluster immediately.',
        command: awsCli(
          `aws rds remove-from-global-cluster --global-cluster-identifier ${globalId} --db-cluster-identifier ${secondaryClusterArn} --region ${secondaryRegion}`,
          'Detaches the secondary cluster from the global database so it can be promoted independently.',
        ),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: [
          'WARNING: This path detaches the old primary from the global database.',
          'Any writes not replicated before the outage are lost during an unplanned detach.',
        ],
      }),
      createStep({
        order: 3,
        title: 'Wait for the promoted cluster',
        description: 'Confirm that the promoted secondary cluster reports as available.',
        command: {
          type: 'aws_wait',
          command: `aws rds wait db-cluster-available --db-cluster-identifier ${secondaryClusterId} --region ${secondaryRegion}`,
          description: 'Blocks until the promoted cluster is available.',
        },
        estimatedMinutes: null,
        notes: ['Run this after whichever path you selected above.'],
      }),
      createStep({
        order: 4,
        title: 'Update DNS and application endpoints',
        description: 'Cut clients over to the promoted secondary cluster.',
        command: { type: 'manual', description: 'Update Route53 records, secrets, and application configuration.' },
        estimatedMinutes: 10,
        requiresApproval: true,
      }),
      createStep({
        order: 5,
        title: 'Verify connectivity to the promoted region',
        description: 'Run connectivity and application smoke tests against the new writer region.',
        command: awsCli(validateSecondary, 'Reads the promoted cluster status and endpoint.'),
        estimatedMinutes: 2,
        verification: verification(validateSecondary, 'The promoted cluster is available and exposes an endpoint in the DR region.'),
      }),
    ],
    rollback: rollback('This operation is partially irreversible once a cluster is detached from the global database.', [
      createStep({
        order: 1,
        title: 'Document the rejoin path',
        description: 'Rejoining a detached cluster requires building a new global database topology.',
        command: { type: 'manual', description: 'Create a fresh Aurora global database and reattach clusters using the AWS runbook for global database rebuilds.' },
        estimatedMinutes: null,
        requiresApproval: true,
        notes: ['Treat rollback as a separate migration exercise rather than an immediate failback.'],
      }),
    ]),
    finalValidation: verification(validateSecondary, 'The promoted cluster is available in the secondary region.'),
    warnings: ['Global Aurora failover can permanently change replication topology after an unplanned detach.'],
  });
}

registerRunbookStrategy(
  'aurora-cluster',
  'aurora_global_failover',
  {
    generate: generateAuroraGlobalFailoverRunbook,
    executionRisk: 'dangerous',
    riskReason: 'Global Aurora changes affect cross-region database topology and require explicit review.',
  },
);

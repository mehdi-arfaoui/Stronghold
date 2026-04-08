import { readString } from '../../../graph/analysis-helpers.js';
import {
  awsCli,
  componentRunbook,
  createStep,
  resolveIdentifier,
  resolveRegion,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateElastiCacheRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const replicationGroupId = resolveIdentifier(
    metadata,
    ['replicationGroupId', 'replicationGroup'],
    componentId,
  );
  const nodeGroupId = readString(metadata.nodeGroupId) ?? '0001';
  const region = resolveRegion(metadata);
  const verifyCommand =
    `aws elasticache describe-replication-groups --replication-group-id ${replicationGroupId} --query "ReplicationGroups[0].NodeGroups[0].NodeGroupMembers[?CurrentRole==\\\`primary\\\`]" --region ${region}`;
  const failoverCommand =
    `aws elasticache test-failover --replication-group-id ${replicationGroupId} --node-group-id ${nodeGroupId} --region ${region}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Confirm the ElastiCache replication group has at least one healthy replica.'],
    steps: [
      createStep({
        order: 1,
        title: 'Trigger replication group failover',
        description: 'Promote a replica node to primary.',
        command: awsCli(failoverCommand, 'Triggers an ElastiCache failover on the node group.'),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: [
          'WARNING: Despite the name test-failover, this command performs a real failover on the replication group.',
          'Use a maintenance window or a DR exercise because client reconnects may be visible to applications.',
        ],
      }),
      createStep({
        order: 2,
        title: 'Verify the new primary',
        description: 'Read the replication group topology and identify the promoted primary node.',
        command: awsCli(verifyCommand, 'Shows the current ElastiCache primary member.'),
        estimatedMinutes: 1,
        verification: verification(verifyCommand, 'A primary node entry is returned for the replication group.'),
      }),
    ],
    rollback: rollback('Trigger another failover after the original primary path is healthy again.', [
      createStep({
        order: 1,
        title: 'Fail over again',
        description: 'Promote the alternate node group primary once the old primary path is healthy.',
        command: awsCli(failoverCommand, 'Triggers another ElastiCache failover.'),
        estimatedMinutes: 1,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(verifyCommand, 'A primary node is visible in the replication group description.'),
  });
}

registerRunbookStrategy('elasticache', '*', {
  generate: generateElastiCacheRunbook,
  executionRisk: 'caution',
  riskReason: 'Replica and failover changes can trigger reconnects and should be scheduled.',
});

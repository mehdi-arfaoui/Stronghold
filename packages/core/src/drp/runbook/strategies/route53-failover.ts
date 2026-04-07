import { readString } from '../../../graph/analysis-helpers.js';
import {
  awsCli,
  componentRunbook,
  createStep,
  resolveIdentifier,
  resolveTtl,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateRoute53Runbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  return readString(metadata.healthCheckId)
    ? buildAutomaticFailoverRunbook(componentId, componentName, componentType, strategy, metadata)
    : buildManualFailoverRunbook(componentId, componentName, componentType, strategy, metadata);
}

function buildAutomaticFailoverRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const healthCheckId = resolveIdentifier(metadata, ['healthCheckId'], componentId);
  const statusCommand = `aws route53 get-health-check-status --health-check-id ${healthCheckId}`;
  const configCommand = `aws route53 get-health-check --health-check-id ${healthCheckId}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Confirm the Route53 failover policy and secondary target were configured before the incident.'],
    steps: [
      createStep({
        order: 1,
        title: 'Check health check status',
        description: 'Verify whether the Route53 health check has already marked the primary target unhealthy.',
        command: awsCli(statusCommand, 'Reads the health check status across Route53 checkers.'),
        estimatedMinutes: 1,
        notes: ['When automatic failover is configured, Route53 should shift traffic without a manual DNS change.'],
        verification: verification(statusCommand, 'The health check reflects the current target health state.'),
      }),
      createStep({
        order: 2,
        title: 'Inspect health check configuration',
        description: 'Review the Route53 health check configuration if failover did not trigger as expected.',
        command: awsCli(configCommand, 'Reads the health check configuration.'),
        estimatedMinutes: 1,
        verification: verification(configCommand, 'The health check configuration is returned for review.'),
      }),
    ],
    rollback: rollback('Restore the primary target health or Route53 routing policy once the primary path is healthy again.', [
      createStep({
        order: 1,
        title: 'Restore the primary route',
        description: 'Allow Route53 to resume normal routing by recovering the primary target and health check state.',
        command: { type: 'manual', description: 'Recover the primary target so Route53 can route traffic back automatically.' },
        estimatedMinutes: null,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(statusCommand, 'The health check reports the expected state for the active target.'),
  });
}

function buildManualFailoverRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const hostedZoneId = resolveIdentifier(metadata, ['hostedZoneId'], componentId);
  const recordName = readString(metadata.name) ?? componentName;
  const recordType = readString(metadata.type) ?? 'A';
  const ttl = resolveTtl(metadata, 60);
  const drTarget = readString(metadata.drTargetIp) ?? '<DR_TARGET_IP>';
  const originalTarget = readString(metadata.aliasTargetDnsName) ?? firstResourceValue(metadata) ?? '<ORIGINAL_TARGET>';
  const changeBatch = JSON.stringify({
    Changes: [
      {
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: recordName,
          Type: recordType,
          TTL: ttl,
          ResourceRecords: [{ Value: drTarget }],
        },
      },
    ],
  });
  const rollbackBatch = JSON.stringify({
    Changes: [
      {
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: recordName,
          Type: recordType,
          TTL: ttl,
          ResourceRecords: [{ Value: originalTarget }],
        },
      },
    ],
  });
  const changeCommand =
    `aws route53 change-resource-record-sets --hosted-zone-id ${hostedZoneId} --change-batch '${changeBatch}'`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Identify the DR target address or alias target that the record should point to during failover.'],
    steps: [
      createStep({
        order: 1,
        title: 'Update the DNS record manually',
        description: 'Upsert the Route53 record so traffic points to the DR target.',
        command: awsCli(changeCommand, 'Updates the Route53 record set for the DR target.'),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: ['Replace <DR_TARGET_IP> if the DR target was not discovered by the scan before running this command.'],
      }),
      createStep({
        order: 2,
        title: 'Verify DNS propagation',
        description: 'Check that resolvers return the new DNS target.',
        command: { type: 'manual', description: `Run dig ${recordName} and confirm the DR target is returned.` },
        estimatedMinutes: 5,
      }),
    ],
    rollback: rollback('Restore the original DNS record value after the primary target is healthy again.', [
      createStep({
        order: 1,
        title: 'Restore the original record',
        description: 'Upsert the original DNS target back into Route53.',
        command: awsCli(
          `aws route53 change-resource-record-sets --hosted-zone-id ${hostedZoneId} --change-batch '${rollbackBatch}'`,
          'Restores the original Route53 record target.',
        ),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: ['Replace <ORIGINAL_TARGET> if the original record value was not captured in scan metadata.'],
      }),
    ]),
    finalValidation: verification(
      `aws route53 list-resource-record-sets --hosted-zone-id ${hostedZoneId} --query "ResourceRecordSets[?Name==\\\`${recordName}.\\\`]"`,
      'The record set reflects the intended DR target.',
    ),
  });
}

function firstResourceValue(metadata: Record<string, unknown>): string | null {
  const values = metadata.resourceValues;
  if (!Array.isArray(values)) return null;
  const first = values.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof first === 'string' ? first : null;
}

registerRunbookStrategy('route53-record', '*', {
  generate: generateRoute53Runbook,
  executionRisk: 'safe',
  riskReason: 'Route53 health-check and failover settings can usually be updated without service interruption.',
});

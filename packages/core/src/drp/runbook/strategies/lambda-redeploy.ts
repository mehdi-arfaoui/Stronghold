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

function generateLambdaRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const functionName = resolveIdentifier(metadata, ['functionName'], componentId);
  const region = resolveRegion(metadata);
  const stateCommand =
    `aws lambda get-function --function-name ${functionName} --query "Configuration.[State,LastModified]" --region ${region}`;
  const dlqCommand =
    `aws lambda get-function-configuration --function-name ${functionName} --query "DeadLetterConfig" --region ${region}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Confirm the CI/CD pipeline or deployment package source for the function before redeploying.'],
    steps: [
      createStep({
        order: 1,
        title: 'Check current Lambda state',
        description: 'Verify whether the function is active, failed, or still updating.',
        command: awsCli(stateCommand, 'Reads the Lambda function state and last modification time.'),
        estimatedMinutes: 1,
        verification: verification(stateCommand, 'The function state is Active or the failure is understood.'),
      }),
      createStep({
        order: 2,
        title: 'Redeploy from CI/CD if needed',
        description: 'Redeploy the function through the existing deployment pipeline when the state indicates failure.',
        command: { type: 'manual', description: 'Trigger a redeploy from the approved CI/CD pipeline or release artifact.' },
        estimatedMinutes: 10,
        requiresApproval: true,
      }),
      createStep({
        order: 3,
        title: 'Inspect DLQ configuration',
        description: 'Confirm whether the function has a dead-letter queue configured for failed events.',
        command: awsCli(dlqCommand, 'Reads the function dead-letter queue configuration.'),
        estimatedMinutes: 1,
        verification: verification(dlqCommand, 'The DeadLetterConfig output is returned successfully.'),
      }),
      createStep({
        order: 4,
        title: 'Reprocess dead-letter messages if required',
        description: 'Replay or manually inspect DLQ messages after the function is healthy again.',
        command: { type: 'manual', description: 'Replay the dead-letter queue or process messages with the approved support procedure.' },
        estimatedMinutes: 10,
        requiresApproval: true,
      }),
    ],
    rollback: rollback('Redeploy the previously known-good version if the new deployment is faulty.', [
      createStep({
        order: 1,
        title: 'Redeploy the previous package',
        description: 'Update the function code back to the last known-good artifact.',
        command: awsCli(
          `aws lambda update-function-code --function-name ${functionName} --s3-bucket <PREVIOUS_VERSION_BUCKET> --s3-key <PREVIOUS_VERSION_KEY> --region ${region}`,
          'Redeploys the previous Lambda package from S3.',
        ),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: ['Replace the bucket and key placeholders with the previous approved artifact location.'],
      }),
    ]),
    finalValidation: verification(stateCommand, 'The function state is Active after redeploy.'),
  });
}

registerRunbookStrategy('lambda', '*', {
  generate: generateLambdaRunbook,
  executionRisk: 'safe',
  riskReason: 'Lambda resilience changes are usually additive and can be applied without downtime.',
});
registerRunbookStrategy('lambda-function', '*', {
  generate: generateLambdaRunbook,
  executionRisk: 'safe',
  riskReason: 'Lambda resilience changes are usually additive and can be applied without downtime.',
});

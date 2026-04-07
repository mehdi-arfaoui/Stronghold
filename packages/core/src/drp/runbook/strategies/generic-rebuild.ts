import {
  buildDescribeCommand,
  componentRunbook,
  createStep,
  detectIacTool,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateGenericRebuildRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const iacTool = detectIacTool(metadata);
  const verifyCommand = buildDescribeCommand(componentType, componentId, metadata);
  const finalValidation = verifyCommand
    ? verification(verifyCommand, 'The rebuilt resource is visible via a read-only describe command.')
    : null;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Confirm ownership of the rebuild procedure and the source of truth for this resource.'],
    steps: buildSteps(componentName, iacTool, verifyCommand),
    rollback: rollback(buildRollbackDescription(iacTool), [
      createStep({
        order: 1,
        title: 'Use the platform rollback procedure',
        description: buildRollbackStep(iacTool),
        command: { type: 'manual', description: buildRollbackStep(iacTool) },
        estimatedMinutes: null,
        requiresApproval: true,
      }),
    ]),
    finalValidation,
    warnings: ['No specialized executable strategy was available, so this runbook falls back to a rebuild-oriented procedure.'],
  });
}

function buildSteps(
  componentName: string,
  iacTool: string | null,
  verifyCommand: string | null,
): readonly ReturnType<typeof createStep>[] {
  const steps = [
    createStep({
      order: 1,
      title: iacTool ? 'Rebuild with infrastructure as code' : 'Perform a manual rebuild',
      description: iacTool
        ? `Rebuild ${componentName} using your ${iacTool} pipeline or deployment workflow.`
        : `Manual rebuild required for ${componentName}. No infrastructure-as-code signal was detected for this resource.`,
      command: {
        type: 'manual',
        description: iacTool
          ? `Run the approved ${iacTool} deployment or recovery pipeline for this resource.`
          : 'Follow the documented manual rebuild procedure for this resource.',
      },
      estimatedMinutes: null,
      requiresApproval: true,
      notes: [
        iacTool
          ? `Resource tags or metadata indicate this resource is managed by ${iacTool}.`
          : 'Document the rebuild procedure after the incident if no formal runbook exists yet.',
      ],
    }),
  ];

  if (verifyCommand) {
    steps.push(
      createStep({
        order: 2,
        title: 'Verify the rebuilt resource',
        description: 'Confirm that the resource is visible again through a read-only describe command.',
        command: { type: 'aws_cli', command: verifyCommand, description: 'Reads the rebuilt resource state.' },
        estimatedMinutes: 1,
        verification: verification(verifyCommand, 'The rebuilt resource is returned by AWS.'),
      }),
    );
  }

  return steps;
}

function buildRollbackDescription(iacTool: string | null): string {
  return iacTool
    ? `Rollback depends on the ${iacTool} deployment workflow used for the rebuild.`
    : 'Rollback depends on the manual rebuild method used for this resource.';
}

function buildRollbackStep(iacTool: string | null): string {
  return iacTool
    ? `Use ${iacTool} to destroy or roll back the partially rebuilt resource.`
    : 'Delete the partially rebuilt resource with the same manual procedure used to create it.';
}

registerRunbookStrategy('*', 'full_rebuild', {
  generate: generateGenericRebuildRunbook,
  executionRisk: 'dangerous',
  riskReason: 'Full rebuilds or foundational network changes can replace live infrastructure and need approval.',
});
registerRunbookStrategy('*', '*', {
  generate: generateGenericRebuildRunbook,
  executionRisk: 'dangerous',
  riskReason: 'Full rebuilds or foundational network changes can replace live infrastructure and need approval.',
});

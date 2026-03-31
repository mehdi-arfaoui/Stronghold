import { stringify } from 'yaml';

import type {
  ComponentRunbook,
  DRPRunbook,
  RunbookCommand,
  RunbookRollback,
  RunbookStep,
  RunbookVerification,
} from './runbook-types.js';

export type RunbookFormat = 'json' | 'yaml';

interface SerializedRunbook {
  readonly plan_id: string;
  readonly generated_at: string;
  readonly disclaimer: string;
  readonly confidentiality_warning: string;
  readonly components: readonly SerializedComponentRunbook[];
}

interface SerializedComponentRunbook {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly strategy: string;
  readonly prerequisites: readonly string[];
  readonly steps: readonly SerializedStep[];
  readonly rollback: SerializedRollback;
  readonly final_validation: SerializedVerification | null;
  readonly warnings: readonly string[];
}

interface SerializedStep {
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly command: SerializedCommand;
  readonly estimated_minutes: number | null;
  readonly verification: SerializedVerification | null;
  readonly approval_required: boolean;
  readonly notes: readonly string[];
}

interface SerializedRollback {
  readonly description: string;
  readonly steps: readonly SerializedStep[];
}

interface SerializedVerification {
  readonly command: string;
  readonly expected: string;
}

type SerializedCommand =
  | { readonly type: 'aws_cli'; readonly command: string; readonly description: string }
  | { readonly type: 'aws_wait'; readonly command: string; readonly description: string }
  | { readonly type: 'aws_console'; readonly description: string; readonly console_url: string }
  | { readonly type: 'manual'; readonly description: string }
  | { readonly type: 'script'; readonly description: string; readonly script_content: string };

/** Serializes a DR runbook to a human-friendly string representation. */
export function serializeRunbook(runbook: DRPRunbook, format: RunbookFormat): string {
  return format === 'json' ? serializeRunbookToJson(runbook) : serializeRunbookToYaml(runbook);
}

/** Serializes a DR runbook to canonical JSON. */
export function serializeRunbookToJson(runbook: DRPRunbook): string {
  return JSON.stringify(toSerializedRunbook(runbook), null, 2);
}

/** Serializes a DR runbook to YAML with a commented execution header. */
export function serializeRunbookToYaml(runbook: DRPRunbook): string {
  const document = stringify(toSerializedRunbook(runbook), null, { lineWidth: 0 });
  return `${buildYamlHeader(runbook)}\n${document}`;
}

function toSerializedRunbook(runbook: DRPRunbook): SerializedRunbook {
  return {
    plan_id: runbook.drpPlanId,
    generated_at: runbook.generatedAt,
    disclaimer: runbook.disclaimer,
    confidentiality_warning: runbook.confidentialityWarning,
    components: runbook.componentRunbooks.map((component) => serializeComponent(component)),
  };
}

function serializeComponent(component: ComponentRunbook): SerializedComponentRunbook {
  return {
    id: component.componentId,
    name: component.componentName,
    type: component.componentType,
    strategy: component.strategy,
    prerequisites: component.prerequisites,
    steps: component.steps.map((step) => serializeStep(step)),
    rollback: serializeRollback(component.rollback),
    final_validation: serializeVerification(component.finalValidation),
    warnings: component.warnings,
  };
}

function serializeRollback(rollback: RunbookRollback): SerializedRollback {
  return {
    description: rollback.description,
    steps: rollback.steps.map((step) => serializeStep(step)),
  };
}

function serializeStep(step: RunbookStep): SerializedStep {
  return {
    order: step.order,
    title: step.title,
    description: step.description,
    command: serializeCommand(step.command),
    estimated_minutes: step.estimatedMinutes,
    verification: serializeVerification(step.verification),
    approval_required: step.requiresApproval,
    notes: step.notes,
  };
}

function serializeVerification(
  verification: RunbookVerification | null,
): SerializedVerification | null {
  if (!verification) return null;
  return {
    command: verification.command,
    expected: verification.expectedResult,
  };
}

function serializeCommand(command: RunbookCommand): SerializedCommand {
  switch (command.type) {
    case 'aws_cli':
    case 'aws_wait':
    case 'manual':
      return command;
    case 'aws_console':
      return {
        type: 'aws_console',
        description: command.description,
        console_url: command.consoleUrl,
      };
    case 'script':
      return {
        type: 'script',
        description: command.description,
        script_content: command.scriptContent,
      };
  }
}

function buildYamlHeader(runbook: DRPRunbook): string {
  return `# Stronghold DR Runbook
# Generated: ${runbook.generatedAt}
# Plan: ${runbook.drpPlanId}
#
# WARNING: ALWAYS test in a non-production environment first.
# WARNING: Steps marked [APPROVAL REQUIRED] need human confirmation.
# WARNING: This file contains real resource identifiers - treat as confidential.
# WARNING: Stronghold does not execute these commands.`;
}

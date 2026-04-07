/** A single executable recovery step for a component runbook. */
export interface RunbookStep {
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly command: RunbookCommand;
  readonly estimatedMinutes: number | null;
  readonly verification: RunbookVerification | null;
  readonly requiresApproval: boolean;
  readonly notes: readonly string[];
}

/** Supported command payloads for generated runbooks. */
export type RunbookCommand =
  | { readonly type: 'aws_cli'; readonly command: string; readonly description: string }
  | { readonly type: 'aws_wait'; readonly command: string; readonly description: string }
  | { readonly type: 'aws_console'; readonly description: string; readonly consoleUrl: string }
  | { readonly type: 'manual'; readonly description: string }
  | { readonly type: 'script'; readonly description: string; readonly scriptContent: string };

/** Read-only verification attached to a step or a completed runbook. */
export interface RunbookVerification {
  readonly command: string;
  readonly expectedResult: string;
}

/** Rollback procedure attached to a component runbook. */
export interface RunbookRollback {
  readonly description: string;
  readonly steps: readonly RunbookStep[];
}

/** Full executable runbook for a single component in the DR plan. */
export interface ComponentRunbook {
  readonly componentId: string;
  readonly componentName: string;
  readonly componentType: string;
  readonly strategy: string;
  readonly prerequisites: readonly string[];
  readonly steps: readonly RunbookStep[];
  readonly rollback: RunbookRollback;
  readonly finalValidation: RunbookVerification | null;
  readonly warnings: readonly string[];
}

/** Full executable runbook document generated from a DR plan. */
export interface DRPRunbook {
  readonly drpPlanId: string;
  readonly generatedAt: string;
  readonly componentRunbooks: readonly ComponentRunbook[];
  readonly disclaimer: string;
  readonly confidentialityWarning: string;
}

export type ExecutionRisk = 'safe' | 'caution' | 'dangerous';

/** Strategy function used by the runbook registry. */
export type RunbookStrategyFn = (
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
) => ComponentRunbook;

export interface RunbookStrategyDefinition {
  readonly generate: RunbookStrategyFn;
  readonly executionRisk: ExecutionRisk;
  readonly riskReason: string;
}

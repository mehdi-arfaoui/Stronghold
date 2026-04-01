export type AuditAction =
  | 'scan'
  | 'report'
  | 'plan_generate'
  | 'plan_validate'
  | 'drift_check'
  | 'plan_runbook';

export interface AuditIdentity {
  readonly arn: string;
  readonly accountId: string;
  readonly userId: string;
}

export interface AuditEntry {
  readonly timestamp: string;
  readonly version: string;
  readonly action: AuditAction;
  readonly identity?: AuditIdentity;
  readonly parameters: {
    readonly regions?: readonly string[];
    readonly services?: readonly string[];
    readonly outputFormat?: string;
    readonly flags?: readonly string[];
  };
  readonly result: {
    readonly status: 'success' | 'failure' | 'partial';
    readonly duration_ms: number;
    readonly resourceCount?: number;
    readonly errorMessage?: string;
  };
}

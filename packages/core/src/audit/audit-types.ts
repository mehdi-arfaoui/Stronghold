export type AuditAction =
  | 'scan'
  | 'report'
  | 'plan_generate'
  | 'plan_validate'
  | 'drift_check'
  | 'plan_runbook'
  | 'evidence_add'
  | 'evidence_list'
  | 'evidence_show'
  | 'services_detect'
  | 'services_list'
  | 'services_show'
  | 'scenarios'
  | 'scenarios_list'
  | 'scenarios_show'
  | 'status';

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
    readonly profile?: string;
    readonly concurrency?: number;
    readonly scannerTimeoutSeconds?: number;
    readonly roleArn?: string;
    readonly accountName?: string;
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

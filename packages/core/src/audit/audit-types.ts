export type AuditAction =
  | 'scan'
  | 'report'
  | 'graph_export'
  | 'plan_generate'
  | 'plan_validate'
  | 'drift_check'
  | 'plan_runbook'
  | 'governance'
  | 'governance_validate'
  | 'evidence_add'
  | 'evidence_list'
  | 'evidence_show'
  | 'explain'
  | 'services_detect'
  | 'services_list'
  | 'services_show'
  | 'scenarios'
  | 'scenarios_list'
  | 'scenarios_show'
  | 'status'
  | 'history'
  | 'risk_accept'
  | 'risk_expire'
  | 'risk_supersede'
  | 'ownership_confirm'
  | 'ownership_review_due'
  | 'policy_violation'
  | 'governance_edit';

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
    readonly governancePath?: string;
    readonly findingKey?: string;
    readonly acceptanceId?: string;
    readonly acceptedBy?: string;
    readonly justification?: string;
    readonly expiresAt?: string;
    readonly policyId?: string;
    readonly policyName?: string;
    readonly serviceId?: string;
    readonly owner?: string;
    readonly confirmedAt?: string;
    readonly nextReviewAt?: string;
    readonly severity?: string;
    readonly note?: string;
  };
  readonly result: {
    readonly status: 'success' | 'failure' | 'partial';
    readonly duration_ms: number;
    readonly resourceCount?: number;
    readonly errorMessage?: string;
  };
}

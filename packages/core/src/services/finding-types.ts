import type { ExecutionRisk } from '../drp/runbook/runbook-types.js';
import type { DRCategory, ValidationSeverity } from '../validation/validation-types.js';
import type { ResourceRole } from './service-types.js';

export interface RemediationAction {
  readonly title: string;
  readonly description: string;
  readonly command: string;
  readonly requiresDowntime: boolean;
  readonly requiresMaintenanceWindow: boolean;
  readonly estimatedDuration: string;
  readonly prerequisites: readonly string[];
  readonly rollbackCommand?: string;
}

export type DRCapability =
  | 'backup'
  | 'redundancy'
  | 'failover'
  | 'detection'
  | 'recovery'
  | 'replication';

export interface ContextualFinding {
  readonly ruleId: string;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly severity: ValidationSeverity;
  readonly category: DRCategory;
  readonly passed: boolean;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly resourceRole: ResourceRole;
  readonly technicalImpact: {
    readonly observation: string;
    readonly metadataKey: string;
    readonly metadataValue: unknown;
    readonly expectedValue: string;
  };
  readonly drImpact: {
    readonly summary: string;
    readonly recoveryImplication: string;
    readonly affectedCapability: DRCapability;
  };
  readonly scenarioImpact: {
    readonly affectedScenarios: readonly string[];
    readonly worstCaseOutcome: string;
  } | null;
  readonly remediation: {
    readonly actions: readonly RemediationAction[];
    readonly estimatedScoreDelta: number;
    readonly risk: ExecutionRisk;
  } | null;
}

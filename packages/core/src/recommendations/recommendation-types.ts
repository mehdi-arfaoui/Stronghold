import type { DRPlan } from '../drp/drp-types.js';
import type { ExecutionRisk } from '../drp/runbook/runbook-types.js';
import type {
  DRCategory,
  InfraNode,
  ValidationReport,
  ValidationSeverity,
} from '../validation/validation-types.js';

export interface Recommendation {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: DRCategory;
  readonly severity: ValidationSeverity;
  readonly targetNode: string;
  readonly targetNodeName: string;
  readonly impact: {
    readonly scoreDelta: number;
    readonly affectedRules: readonly string[];
  };
  readonly risk: ExecutionRisk;
  readonly riskReason: string;
  readonly remediation: {
    readonly command: string;
    readonly requiresDowntime: boolean;
    readonly requiresMaintenanceWindow: boolean;
    readonly estimatedDuration: string;
    readonly prerequisites: readonly string[];
    readonly rollbackCommand?: string;
  };
}

export interface RecommendationGenerationInput {
  readonly nodes: readonly InfraNode[];
  readonly validationReport: ValidationReport;
  readonly drpPlan?: DRPlan;
  readonly isDemo?: boolean;
  readonly redact?: boolean;
}

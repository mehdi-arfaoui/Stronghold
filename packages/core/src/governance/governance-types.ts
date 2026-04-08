import path from 'node:path';

import type { Criticality, ResourceRole } from '../services/service-types.js';
import type { ValidationSeverity } from '../validation/validation-types.js';

export const GOVERNANCE_FILE_VERSION = 1;
export const DEFAULT_GOVERNANCE_FILE_PATH = path.join('.stronghold', 'governance.yml');
export const DEFAULT_OWNERSHIP_REVIEW_CYCLE_DAYS = 90;

export interface GovernanceOwnership {
  readonly owner: string;
  readonly contact?: string;
  readonly confirmed: boolean;
  readonly confirmedAt?: string;
  readonly reviewCycleDays: number;
}

export interface GovernanceRiskAcceptanceDefinition {
  readonly id: string;
  readonly findingKey: string;
  readonly acceptedBy: string;
  readonly justification: string;
  readonly acceptedAt: string;
  readonly expiresAt: string;
  readonly severityAtAcceptance: ValidationSeverity;
  readonly reviewNotes?: string;
}

export interface GovernancePolicyTagMatcher {
  readonly key: string;
  readonly value: string;
}

export interface GovernancePolicyScope {
  readonly serviceCriticality?: Criticality;
  readonly resourceRole?: ResourceRole;
  readonly tag?: GovernancePolicyTagMatcher;
  readonly serviceId?: string;
}

export interface GovernancePolicyDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rule: string;
  readonly appliesTo: GovernancePolicyScope;
  readonly severity: ValidationSeverity;
}

export interface GovernanceConfig {
  readonly version: typeof GOVERNANCE_FILE_VERSION;
  readonly ownership: Readonly<Record<string, GovernanceOwnership>>;
  readonly riskAcceptances: readonly GovernanceRiskAcceptanceDefinition[];
  readonly policies: readonly GovernancePolicyDefinition[];
}

export interface GovernanceValidationOptions {
  readonly filePath?: string;
  readonly onWarning?: (warning: string) => void;
  readonly asOf?: Date;
}

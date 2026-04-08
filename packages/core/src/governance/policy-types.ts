import type { GovernancePolicyDefinition, GovernancePolicyScope } from './governance-types.js';

export type DRPolicy = GovernancePolicyDefinition;
export type PolicyScope = GovernancePolicyScope;

export interface PolicyViolation {
  readonly policyId: string;
  readonly policyName: string;
  readonly findingKey: string;
  readonly nodeId: string;
  readonly serviceId?: string;
  readonly severity: string;
  readonly message: string;
}

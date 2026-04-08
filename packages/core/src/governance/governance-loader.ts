import fs from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import type { Criticality, ResourceRole } from '../services/service-types.js';
import { allValidationRules, type ValidationSeverity } from '../validation/index.js';
import {
  DEFAULT_GOVERNANCE_FILE_PATH,
  DEFAULT_OWNERSHIP_REVIEW_CYCLE_DAYS,
  GOVERNANCE_FILE_VERSION,
  type GovernanceConfig,
  type GovernanceOwnership,
  type GovernancePolicyDefinition,
  type GovernancePolicyScope,
  type GovernanceRiskAcceptanceDefinition,
  type GovernanceValidationOptions,
} from './governance-types.js';

type GovernanceRecord = Record<string, unknown>;

const VALID_SEVERITIES = new Set<ValidationSeverity>(['critical', 'high', 'medium', 'low']);
const VALID_CRITICALITIES = new Set<Criticality>(['critical', 'high', 'medium', 'low']);
const VALID_RESOURCE_ROLES = new Set<ResourceRole>([
  'datastore',
  'compute',
  'network',
  'queue',
  'storage',
  'monitoring',
  'dns',
  'other',
]);
const KNOWN_RULE_IDS = new Set(allValidationRules.map((rule) => rule.id));

export class GovernanceConfigValidationError extends Error {
  public readonly filePath: string;
  public readonly issues: readonly string[];

  public constructor(filePath: string, issues: readonly string[]) {
    super(`Invalid Stronghold governance config at ${filePath}:\n- ${issues.join('\n- ')}`);
    this.name = 'GovernanceConfigValidationError';
    this.filePath = filePath;
    this.issues = issues;
  }
}

export function loadGovernanceConfig(
  filePath = DEFAULT_GOVERNANCE_FILE_PATH,
  options: Omit<GovernanceValidationOptions, 'filePath'> = {},
): GovernanceConfig | null {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  try {
    const contents = fs.readFileSync(resolvedPath, 'utf8');
    return parseGovernanceConfig(contents, {
      ...options,
      filePath: resolvedPath,
    });
  } catch (error) {
    options.onWarning?.(error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function parseGovernanceConfig(
  contents: string,
  options: GovernanceValidationOptions = {},
): GovernanceConfig {
  const filePath = path.resolve(options.filePath ?? DEFAULT_GOVERNANCE_FILE_PATH);
  const document = parseDocument(contents);
  if (document.errors.length > 0) {
    throw new GovernanceConfigValidationError(
      filePath,
      document.errors.map((error) => error.message),
    );
  }

  return validateGovernanceConfig(document.toJSON() as unknown, {
    ...options,
    filePath,
  });
}

export function validateGovernanceConfig(
  value: unknown,
  options: GovernanceValidationOptions = {},
): GovernanceConfig {
  const filePath = path.resolve(options.filePath ?? DEFAULT_GOVERNANCE_FILE_PATH);
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new GovernanceConfigValidationError(filePath, [
      'Governance file must contain a YAML object.',
    ]);
  }

  const version = readInteger(value.version);
  if (version !== GOVERNANCE_FILE_VERSION) {
    issues.push(
      `version must be ${GOVERNANCE_FILE_VERSION}. Received ${String(value.version ?? 'undefined')}.`,
    );
  }

  const ownership =
    value.ownership == null ? {} : readOwnership(value.ownership, 'ownership', issues);
  const riskAcceptances =
    value.risk_acceptances == null
      ? []
      : readRiskAcceptances(value.risk_acceptances, 'risk_acceptances', issues, filePath, options);
  const policies =
    value.policies == null
      ? []
      : readPolicies(value.policies, 'policies', issues, filePath, options);

  if (issues.length > 0) {
    throw new GovernanceConfigValidationError(filePath, issues);
  }

  return {
    version: GOVERNANCE_FILE_VERSION,
    ownership,
    riskAcceptances,
    policies,
  };
}

function readOwnership(
  value: unknown,
  pathLabel: string,
  issues: string[],
): Readonly<Record<string, GovernanceOwnership>> {
  if (!isRecord(value)) {
    issues.push(`${pathLabel} must be an object keyed by service id.`);
    return {};
  }

  const ownership: Record<string, GovernanceOwnership> = {};
  for (const [serviceId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      issues.push(`${pathLabel}.${serviceId} must be an object.`);
      continue;
    }

    const owner = readRequiredString(entry.owner, `${pathLabel}.${serviceId}.owner`, issues);
    const contact = readOptionalString(entry.contact);
    const confirmed = readOptionalBoolean(
      entry.confirmed,
      `${pathLabel}.${serviceId}.confirmed`,
      issues,
    );
    const confirmedAt = readOptionalDateString(
      entry.confirmed_at ?? entry.confirmedAt,
      `${pathLabel}.${serviceId}.confirmed_at`,
      issues,
    );
    const reviewCycleDays = readOptionalInteger(
      entry.review_cycle_days ?? entry.reviewCycleDays,
      1,
      3650,
      `${pathLabel}.${serviceId}.review_cycle_days`,
      issues,
    );

    if (!owner) {
      continue;
    }

    if (confirmed === true && !confirmedAt) {
      issues.push(
        `${pathLabel}.${serviceId}.confirmed_at is required when confirmed is true.`,
      );
      continue;
    }

    ownership[serviceId] = {
      owner,
      ...(contact ? { contact } : {}),
      confirmed: confirmed ?? false,
      ...(confirmedAt ? { confirmedAt } : {}),
      reviewCycleDays: reviewCycleDays ?? DEFAULT_OWNERSHIP_REVIEW_CYCLE_DAYS,
    };
  }

  return ownership;
}

function readRiskAcceptances(
  value: unknown,
  pathLabel: string,
  issues: string[],
  filePath: string,
  options: GovernanceValidationOptions,
): readonly GovernanceRiskAcceptanceDefinition[] {
  if (!Array.isArray(value)) {
    issues.push(`${pathLabel} must be an array.`);
    return [];
  }

  const acceptances: GovernanceRiskAcceptanceDefinition[] = [];
  const seenIds = new Set<string>();

  value.forEach((entry, index) => {
    const label = `${pathLabel}[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${label} must be an object.`);
      return;
    }

    const id = readRequiredString(entry.id, `${label}.id`, issues);
    const findingKey = readRequiredString(entry.finding_key ?? entry.findingKey, `${label}.finding_key`, issues);
    const acceptedBy = readRequiredString(entry.accepted_by ?? entry.acceptedBy, `${label}.accepted_by`, issues);
    const justification = readRequiredString(entry.justification, `${label}.justification`, issues);
    const acceptedAt = readRequiredDateString(
      entry.accepted_at ?? entry.acceptedAt,
      `${label}.accepted_at`,
      issues,
    );
    const expiresAt = readRequiredDateString(
      entry.expires_at ?? entry.expiresAt,
      `${label}.expires_at`,
      issues,
    );
    const severityAtAcceptance = readSeverity(
      entry.severity_at_acceptance ?? entry.severityAtAcceptance,
      `${label}.severity_at_acceptance`,
      issues,
    );
    const reviewNotes = readOptionalString(entry.review_notes ?? entry.reviewNotes);

    if (!id || !findingKey || !acceptedBy || !justification || !acceptedAt || !expiresAt || !severityAtAcceptance) {
      return;
    }

    if (seenIds.has(id)) {
      issues.push(`${label}.id must be unique. Duplicate value "${id}".`);
      return;
    }
    seenIds.add(id);

    if (!isValidFindingKey(findingKey)) {
      issues.push(`${label}.finding_key must use ruleId::nodeId format.`);
      return;
    }

    if (Date.parse(expiresAt) <= (options.asOf ?? new Date()).getTime()) {
      options.onWarning?.(
        `Governance warning in ${filePath}: risk acceptance "${id}" is already expired (${expiresAt.slice(0, 10)}).`,
      );
    }

    acceptances.push({
      id,
      findingKey,
      acceptedBy,
      justification,
      acceptedAt,
      expiresAt,
      severityAtAcceptance,
      ...(reviewNotes !== undefined ? { reviewNotes } : {}),
    });
  });

  return acceptances;
}

function readPolicies(
  value: unknown,
  pathLabel: string,
  issues: string[],
  filePath: string,
  options: GovernanceValidationOptions,
): readonly GovernancePolicyDefinition[] {
  if (!Array.isArray(value)) {
    issues.push(`${pathLabel} must be an array.`);
    return [];
  }

  const policies: GovernancePolicyDefinition[] = [];
  const seenIds = new Set<string>();

  value.forEach((entry, index) => {
    const label = `${pathLabel}[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${label} must be an object.`);
      return;
    }

    const id = readRequiredString(entry.id, `${label}.id`, issues);
    const name = readRequiredString(entry.name, `${label}.name`, issues);
    const description = readRequiredString(entry.description, `${label}.description`, issues);
    const rule = readRequiredString(entry.rule, `${label}.rule`, issues);
    const appliesTo = readPolicyScope(entry.applies_to ?? entry.appliesTo, `${label}.applies_to`, issues);
    const severity = readSeverity(entry.severity, `${label}.severity`, issues);

    if (!id || !name || !description || !rule || !appliesTo || !severity) {
      return;
    }

    if (seenIds.has(id)) {
      issues.push(`${label}.id must be unique. Duplicate value "${id}".`);
      return;
    }
    seenIds.add(id);

    if (!KNOWN_RULE_IDS.has(rule)) {
      options.onWarning?.(
        `Governance warning in ${filePath}: policy "${id}" references unknown rule "${rule}".`,
      );
    }

    policies.push({
      id,
      name,
      description,
      rule,
      appliesTo,
      severity,
    });
  });

  return policies;
}

function readPolicyScope(
  value: unknown,
  pathLabel: string,
  issues: string[],
): GovernancePolicyScope | null {
  if (!isRecord(value)) {
    issues.push(`${pathLabel} must be an object.`);
    return null;
  }

  const serviceCriticality = readOptionalCriticality(
    value.service_criticality ?? value.serviceCriticality,
    `${pathLabel}.service_criticality`,
    issues,
  );
  const resourceRole = readOptionalResourceRole(
    value.resource_role ?? value.resourceRole,
    `${pathLabel}.resource_role`,
    issues,
  );
  const serviceId = readOptionalString(value.service_id ?? value.serviceId);
  const tag = readTagMatcher(value.tag, `${pathLabel}.tag`, issues);

  if (!serviceCriticality && !resourceRole && !serviceId && !tag) {
    issues.push(`${pathLabel} must define at least one scope criterion.`);
    return null;
  }

  return {
    ...(serviceCriticality ? { serviceCriticality } : {}),
    ...(resourceRole ? { resourceRole } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(tag ? { tag } : {}),
  };
}

function readTagMatcher(
  value: unknown,
  pathLabel: string,
  issues: string[],
): GovernancePolicyScope['tag'] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(`${pathLabel} must be an object with key and value.`);
    return undefined;
  }

  const key = readRequiredString(value.key, `${pathLabel}.key`, issues);
  const matcherValue = readRequiredString(value.value, `${pathLabel}.value`, issues);

  if (!key || !matcherValue) {
    return undefined;
  }

  return {
    key,
    value: matcherValue,
  };
}

function readSeverity(
  value: unknown,
  pathLabel: string,
  issues: string[],
): ValidationSeverity | null {
  if (typeof value !== 'string' || !VALID_SEVERITIES.has(value as ValidationSeverity)) {
    issues.push(`${pathLabel} must be one of critical, high, medium, or low.`);
    return null;
  }
  return value as ValidationSeverity;
}

function readOptionalCriticality(
  value: unknown,
  pathLabel: string,
  issues: string[],
): Criticality | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== 'string' || !VALID_CRITICALITIES.has(value as Criticality)) {
    issues.push(`${pathLabel} must be one of critical, high, medium, or low.`);
    return undefined;
  }
  return value as Criticality;
}

function readOptionalResourceRole(
  value: unknown,
  pathLabel: string,
  issues: string[],
): ResourceRole | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== 'string' || !VALID_RESOURCE_ROLES.has(value as ResourceRole)) {
    issues.push(
      `${pathLabel} must be one of datastore, compute, network, queue, storage, monitoring, dns, or other.`,
    );
    return undefined;
  }
  return value as ResourceRole;
}

function readOptionalBoolean(
  value: unknown,
  pathLabel: string,
  issues: string[],
): boolean | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    issues.push(`${pathLabel} must be a boolean.`);
    return undefined;
  }
  return value;
}

function readOptionalInteger(
  value: unknown,
  min: number,
  max: number,
  pathLabel: string,
  issues: string[],
): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    issues.push(`${pathLabel} must be an integer between ${min} and ${max}.`);
    return undefined;
  }
  return value;
}

function readRequiredString(
  value: unknown,
  pathLabel: string,
  issues: string[],
): string | null {
  const normalized = readOptionalString(value);
  if (!normalized) {
    issues.push(`${pathLabel} is required.`);
    return null;
  }
  return normalized;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequiredDateString(
  value: unknown,
  pathLabel: string,
  issues: string[],
): string | null {
  const normalized = readOptionalDateString(value, pathLabel, issues);
  if (!normalized) {
    issues.push(`${pathLabel} is required.`);
    return null;
  }
  return normalized;
}

function readOptionalDateString(
  value: unknown,
  pathLabel: string,
  issues: string[],
): string | undefined {
  const normalized = readOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (!Number.isFinite(Date.parse(normalized))) {
    issues.push(`${pathLabel} must be a valid ISO-8601 date string.`);
    return undefined;
  }
  return normalized;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function isValidFindingKey(findingKey: string): boolean {
  const separatorIndex = findingKey.indexOf('::');
  if (separatorIndex <= 0) {
    return false;
  }

  const nodeId = findingKey.slice(separatorIndex + 2);
  return nodeId.trim().length > 0;
}

function isRecord(value: unknown): value is GovernanceRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

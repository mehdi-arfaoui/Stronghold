import { parse, stringify } from 'yaml';

import type { DeserializeDrPlanResult, DRPlan } from './drp-types.js';

export type DrPlanFormat = 'json' | 'yaml';

/** Serializes a DR plan to canonical JSON. */
export function serializeDrPlanToJson(plan: DRPlan): string {
  return JSON.stringify(plan, null, 2);
}

/** Serializes a DR plan to YAML for DRP-as-Code storage. */
export function serializeDrPlanToYaml(plan: DRPlan): string {
  return stringify(plan, null, { lineWidth: 0 });
}

/** Parses a YAML or JSON document and validates its DRP schema. */
export function deserializeDrPlan(document: string): DeserializeDrPlanResult {
  const trimmed = document.trim();

  try {
    const parsed = trimmed.startsWith('{') ? JSON.parse(trimmed) : parse(trimmed);
    return validateParsedDrPlan(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`Invalid DRP document: ${message}`] };
  }
}

/** Serializes a DR plan using an explicit output format. */
export function serializeDRPlan(plan: DRPlan, format: DrPlanFormat): string {
  return format === 'json' ? serializeDrPlanToJson(plan) : serializeDrPlanToYaml(plan);
}

/** Deserializes a DR plan using an explicit or auto-detected format. */
export function deserializeDRPlan(
  document: string,
  format?: DrPlanFormat,
): DeserializeDrPlanResult {
  if (!format) return deserializeDrPlan(document);

  try {
    const parsed = format === 'json' ? JSON.parse(document.trim()) : parse(document.trim());
    return validateParsedDrPlan(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`Invalid DRP document: ${message}`] };
  }
}

/** Validates the runtime shape of a parsed DRP document. */
export function validateDrPlanShape(value: unknown): readonly string[] {
  if (!isRecord(value)) return ['DRP document must be an object.'];

  const errors: string[] = [];

  requireString(value.id, 'id', errors);
  requireString(value.version, 'version', errors);
  requireString(value.generated, 'generated', errors);
  requireString(value.infrastructureHash, 'infrastructureHash', errors);
  requireString(value.provider, 'provider', errors);
  requireStringArray(value.regions, 'regions', errors);

  if (!Array.isArray(value.services)) {
    errors.push('services must be an array.');
  } else {
    value.services.forEach((service, index) =>
      validateService(service, `services[${index}]`, errors),
    );
  }

  if (!isRecord(value.metadata)) {
    errors.push('metadata must be an object.');
  } else {
    requireNumber(value.metadata.totalResources, 'metadata.totalResources', errors);
    requireNumber(value.metadata.coveredResources, 'metadata.coveredResources', errors);
    requireStringArray(value.metadata.uncoveredResources, 'metadata.uncoveredResources', errors);
    requireString(value.metadata.worstCaseRTO, 'metadata.worstCaseRTO', errors);
    requireString(value.metadata.averageRPO, 'metadata.averageRPO', errors);
    requireBoolean(value.metadata.stale, 'metadata.stale', errors);
  }

  return errors;
}

function validateParsedDrPlan(value: unknown): DeserializeDrPlanResult {
  const errors = validateDrPlanShape(value);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: value as DRPlan };
}

function validateService(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireString(value.name, `${path}.name`, errors);
  requireString(value.criticality, `${path}.criticality`, errors);
  requireString(value.rtoTarget, `${path}.rtoTarget`, errors);
  requireString(value.rpoTarget, `${path}.rpoTarget`, errors);
  requireString(value.estimatedRTO, `${path}.estimatedRTO`, errors);
  requireString(value.estimatedRPO, `${path}.estimatedRPO`, errors);
  requireStringArray(value.recoveryOrder, `${path}.recoveryOrder`, errors);

  if (!Array.isArray(value.components)) {
    errors.push(`${path}.components must be an array.`);
  } else {
    value.components.forEach((component, index) =>
      validateComponent(component, `${path}.components[${index}]`, errors),
    );
  }

  if (!Array.isArray(value.validationTests)) {
    errors.push(`${path}.validationTests must be an array.`);
  } else {
    value.validationTests.forEach((test, index) =>
      validateValidationTest(test, `${path}.validationTests[${index}]`, errors),
    );
  }
}

function validateComponent(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireString(value.resourceId, `${path}.resourceId`, errors);
  requireString(value.resourceType, `${path}.resourceType`, errors);
  requireString(value.name, `${path}.name`, errors);
  requireString(value.region, `${path}.region`, errors);
  requireString(value.recoveryStrategy, `${path}.recoveryStrategy`, errors);
  requireString(value.estimatedRTO, `${path}.estimatedRTO`, errors);
  requireString(value.estimatedRPO, `${path}.estimatedRPO`, errors);
  requireStringArray(value.dependencies, `${path}.dependencies`, errors);
  requireStringArray(value.risks, `${path}.risks`, errors);

  if (!Array.isArray(value.recoverySteps)) {
    errors.push(`${path}.recoverySteps must be an array.`);
  } else {
    value.recoverySteps.forEach((step, index) =>
      validateRecoveryAction(step, `${path}.recoverySteps[${index}]`, errors),
    );
  }

  if (value.rtoEstimate !== undefined) {
    validateRtoEstimate(value.rtoEstimate, `${path}.rtoEstimate`, errors);
  }

  if (value.effectiveRTO !== undefined) {
    validateEffectiveRto(value.effectiveRTO, `${path}.effectiveRTO`, errors);
  }

  if (value.warnings !== undefined) {
    requireStringArray(value.warnings, `${path}.warnings`, errors);
  }
}

function validateRecoveryAction(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireString(value.action, `${path}.action`, errors);
  requireString(value.target, `${path}.target`, errors);
  requireString(value.description, `${path}.description`, errors);
  requireString(value.timeout, `${path}.timeout`, errors);
}

function validateValidationTest(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireString(value.name, `${path}.name`, errors);
  requireString(value.type, `${path}.type`, errors);
  requireString(value.target, `${path}.target`, errors);
  requireString(value.description, `${path}.description`, errors);
  requireString(value.timeout, `${path}.timeout`, errors);
}

function validateRtoEstimate(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireNullableNumber(value.rtoMinMinutes, `${path}.rtoMinMinutes`, errors);
  requireNullableNumber(value.rtoMaxMinutes, `${path}.rtoMaxMinutes`, errors);
  requireNullableNumber(value.rpoMinMinutes, `${path}.rpoMinMinutes`, errors);
  requireNullableNumber(value.rpoMaxMinutes, `${path}.rpoMaxMinutes`, errors);
  requireString(value.confidence, `${path}.confidence`, errors);
  requireString(value.method, `${path}.method`, errors);
  requireStringArray(value.limitations, `${path}.limitations`, errors);

  if (!Array.isArray(value.factors)) {
    errors.push(`${path}.factors must be an array.`);
    return;
  }

  value.factors.forEach((factor, index) => validateRtoFactor(factor, `${path}.factors[${index}]`, errors));
}

function validateRtoFactor(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireString(value.name, `${path}.name`, errors);
  requireString(value.value, `${path}.value`, errors);
  requireString(value.impact, `${path}.impact`, errors);

  if (!isRecord(value.source)) {
    errors.push(`${path}.source must be an object.`);
    return;
  }

  requireString(value.source.type, `${path}.source.type`, errors);
}

function validateEffectiveRto(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireNullableNumber(value.componentRTOMin, `${path}.componentRTOMin`, errors);
  requireNullableNumber(value.componentRTOMax, `${path}.componentRTOMax`, errors);
  requireNullableNumber(value.chainRTOMin, `${path}.chainRTOMin`, errors);
  requireNullableNumber(value.chainRTOMax, `${path}.chainRTOMax`, errors);
  requireNullableString(value.bottleneck, `${path}.bottleneck`, errors);
  requireBoolean(value.chainContainsUnverified, `${path}.chainContainsUnverified`, errors);
  requireString(value.assumption, `${path}.assumption`, errors);
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string.`);
  }
}

function requireStringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    errors.push(`${path} must be an array of strings.`);
  }
}

function requireNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a number.`);
  }
}

function requireNullableNumber(value: unknown, path: string, errors: string[]): void {
  if (value === null) return;
  requireNumber(value, path, errors);
}

function requireBoolean(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'boolean') errors.push(`${path} must be a boolean.`);
}

function requireNullableString(value: unknown, path: string, errors: string[]): void {
  if (value === null) return;
  requireString(value, path, errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

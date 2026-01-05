export type ValidationIssue = {
  field: string;
  message: string;
};

type StringOptions = {
  minLength?: number;
  allowNull?: boolean;
};

type NumberOptions = {
  min?: number;
  allowNull?: boolean;
};

type EnumOptions = {
  allowNull?: boolean;
};

export function buildValidationError(issues: ValidationIssue[]) {
  return {
    error: "Payload invalide",
    details: issues,
  };
}

function addIssue(issues: ValidationIssue[], field: string, message: string) {
  issues.push({ field, message });
}

export function parseRequiredString(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
  options: StringOptions = {}
) {
  if (value === null || value === undefined) {
    addIssue(issues, field, "champ requis");
    return undefined;
  }
  if (typeof value !== "string") {
    addIssue(issues, field, "doit être une chaîne de caractères");
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    addIssue(issues, field, "ne doit pas être vide");
    return undefined;
  }
  if (options.minLength && trimmed.length < options.minLength) {
    addIssue(issues, field, `doit contenir au moins ${options.minLength} caractères`);
    return undefined;
  }
  return trimmed;
}

export function parseOptionalString(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
  options: StringOptions = {}
) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    if (options.allowNull) {
      return null;
    }
    addIssue(issues, field, "ne peut pas être null");
    return undefined;
  }
  if (typeof value !== "string") {
    addIssue(issues, field, "doit être une chaîne de caractères");
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (options.minLength && trimmed.length < options.minLength) {
    addIssue(issues, field, `doit contenir au moins ${options.minLength} caractères`);
    return undefined;
  }
  return trimmed;
}

export function parseRequiredNumber(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
  options: NumberOptions = {}
) {
  if (value === null || value === undefined) {
    addIssue(issues, field, "champ requis");
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    addIssue(issues, field, "doit être un nombre");
    return undefined;
  }
  if (options.min !== undefined && parsed < options.min) {
    addIssue(issues, field, `doit être supérieur ou égal à ${options.min}`);
    return undefined;
  }
  return parsed;
}

export function parseOptionalNumber(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
  options: NumberOptions = {}
) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    if (options.allowNull) {
      return null;
    }
    addIssue(issues, field, "ne peut pas être null");
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    addIssue(issues, field, "doit être un nombre");
    return undefined;
  }
  if (options.min !== undefined && parsed < options.min) {
    addIssue(issues, field, `doit être supérieur ou égal à ${options.min}`);
    return undefined;
  }
  return parsed;
}

export function parseOptionalEnum(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
  allowed: string[],
  options: EnumOptions = {}
) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    if (options.allowNull) {
      return null;
    }
    addIssue(issues, field, "ne peut pas être vide");
    return undefined;
  }
  const normalized = String(value).toLowerCase();
  if (!allowed.includes(normalized)) {
    addIssue(issues, field, `doit être l'une des valeurs: ${allowed.join("|")}`);
    return undefined;
  }
  return normalized;
}

export function parseOptionalBoolean(
  value: unknown,
  field: string,
  issues: ValidationIssue[]
) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "false") {
    return value === "true";
  }
  if (value === 1 || value === 0) {
    return Boolean(value);
  }
  addIssue(issues, field, "doit être un booléen");
  return undefined;
}

export function parseStringArray(
  value: unknown,
  field: string,
  issues: ValidationIssue[]
) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    addIssue(issues, field, "doit être un tableau de chaînes");
    return undefined;
  }
  const ids: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      addIssue(issues, `${field}[${index}]`, "doit être une chaîne non vide");
      continue;
    }
    ids.push(item.trim());
  }
  return ids;
}

import {
  parseOptionalString,
  parseRequiredString,
  parseStringArray,
  type ValidationIssue,
} from "./common";

type ExerciseCreatePayload = {
  scenarioId: string | undefined;
  title: string | undefined;
  description: string | null | undefined;
  scheduledAt: Date | undefined;
  runbookIds: string[];
};

type ExerciseUpdatePayload = {
  title?: string | null;
  description?: string | null;
  scheduledAt?: Date | null;
  status?: string | null;
};

type ExerciseResultPayload = {
  summary?: string | null;
  findings?: string | null;
  improvementPlan?: string | null;
};

type ChecklistUpdatePayload = {
  items: Array<{ id: string; status: string }>;
};

const EXERCISE_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const CHECKLIST_STATUSES = ["PENDING", "DONE"];

function normalizeEnum(
  value: unknown,
  field: string,
  allowed: string[],
  issues: ValidationIssue[],
  required = false
) {
  const parsed = required
    ? parseRequiredString(value, field, issues, { minLength: 2 })
    : parseOptionalString(value, field, issues, { allowNull: true });
  if (parsed === undefined || parsed === null) {
    return parsed;
  }
  const normalized = parsed.toUpperCase();
  if (!allowed.includes(normalized)) {
    issues.push({ field, message: `doit être parmi ${allowed.join(", ")}` });
    return undefined;
  }
  return normalized;
}

function parseDate(value: unknown, field: string, issues: ValidationIssue[], required = false) {
  const parsed = required
    ? parseRequiredString(value, field, issues, { minLength: 6 })
    : parseOptionalString(value, field, issues, { allowNull: true });
  if (parsed === undefined || parsed === null) {
    return parsed;
  }
  const dateValue = new Date(parsed);
  if (Number.isNaN(dateValue.getTime())) {
    issues.push({ field, message: "doit être une date ISO valide" });
    return undefined;
  }
  return dateValue;
}

export function parseExerciseCreatePayload(payload: any) {
  const issues: ValidationIssue[] = [];
  const scenarioId = parseRequiredString(payload.scenarioId, "scenarioId", issues, { minLength: 3 });
  const title = parseRequiredString(payload.title, "title", issues, { minLength: 3 });
  const description = parseOptionalString(payload.description, "description", issues, { allowNull: true });
  const scheduledAt = parseDate(payload.scheduledAt, "scheduledAt", issues, true) as Date | undefined;
  const runbookIds = parseStringArray(payload.runbookIds, "runbookIds", issues) ?? [];

  return {
    issues,
    data: {
      scenarioId,
      title,
      description: description ?? null,
      scheduledAt,
      runbookIds,
    } as ExerciseCreatePayload,
  };
}

export function parseExerciseUpdatePayload(payload: any) {
  const issues: ValidationIssue[] = [];
  const title = parseOptionalString(payload.title, "title", issues, { allowNull: true });
  const description = parseOptionalString(payload.description, "description", issues, { allowNull: true });
  const scheduledAt = parseDate(payload.scheduledAt, "scheduledAt", issues) as Date | null | undefined;
  const status = normalizeEnum(payload.status, "status", EXERCISE_STATUSES, issues);

  return {
    issues,
    data: {
      title,
      description,
      scheduledAt,
      status: status ?? undefined,
    } as ExerciseUpdatePayload,
  };
}

export function parseExerciseResultPayload(payload: any) {
  const issues: ValidationIssue[] = [];
  const summary = parseOptionalString(payload.summary, "summary", issues, { allowNull: true });
  const findings = parseOptionalString(payload.findings, "findings", issues, { allowNull: true });
  const improvementPlan = parseOptionalString(payload.improvementPlan, "improvementPlan", issues, {
    allowNull: true,
  });

  return {
    issues,
    data: {
      summary,
      findings,
      improvementPlan,
    } as ExerciseResultPayload,
  };
}

export function parseChecklistUpdatePayload(payload: any) {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(payload?.items)) {
    issues.push({ field: "items", message: "doit être un tableau" });
    return { issues, data: { items: [] } as ChecklistUpdatePayload };
  }

  const items = payload.items
    .map((item: any, index: number) => {
      const id = parseRequiredString(item?.id, `items[${index}].id`, issues, { minLength: 3 });
      const status = normalizeEnum(item?.status, `items[${index}].status`, CHECKLIST_STATUSES, issues, true);
      if (!id || !status) return null;
      return { id, status };
    })
    .filter((item): item is { id: string; status: string } => item !== null);

  return {
    issues,
    data: { items } as ChecklistUpdatePayload,
  };
}

export const EXERCISE_STATUS_VALUES = EXERCISE_STATUSES;
export const CHECKLIST_STATUS_VALUES = CHECKLIST_STATUSES;

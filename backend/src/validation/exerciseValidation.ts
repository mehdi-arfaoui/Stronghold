import type { ValidationIssue } from "./common.js";
import {
  parseOptionalEnum,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
  parseStringArray,
} from "./common.js";

export const EXERCISE_STATUSES = ["planned", "in_progress", "completed", "canceled"] as const;
export const EXERCISE_RESULT_STATUSES = ["success", "failure", "partial"] as const;

export type ExerciseStatus = (typeof EXERCISE_STATUSES)[number];
export type ExerciseResultStatus = (typeof EXERCISE_RESULT_STATUSES)[number];

function parseRequiredDate(value: unknown, field: string, issues: ValidationIssue[]) {
  if (value === null || value === undefined) {
    issues.push({ field, message: "champ requis" });
    return undefined;
  }
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) {
    issues.push({ field, message: "doit être une date valide" });
    return undefined;
  }
  return date;
}

function parseOptionalDate(value: unknown, field: string, issues: ValidationIssue[]) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) {
    issues.push({ field, message: "doit être une date valide" });
    return undefined;
  }
  return date;
}

export function parseExerciseCreatePayload(payload: any) {
  const issues: ValidationIssue[] = [];
  const title = parseRequiredString(payload?.title, "title", issues, { minLength: 3 });
  const description = parseOptionalString(payload?.description, "description", issues, {
    allowNull: true,
  });
  const scenarioId = parseRequiredString(payload?.scenarioId, "scenarioId", issues);
  const scheduledAt = parseRequiredDate(payload?.scheduledAt, "scheduledAt", issues);
  const runbookIds = parseStringArray(payload?.runbookIds, "runbookIds", issues) ?? [];

  return { issues, data: { title, description, scenarioId, scheduledAt, runbookIds } };
}

export function parseExerciseUpdatePayload(payload: any) {
  const issues: ValidationIssue[] = [];
  const title = parseOptionalString(payload?.title, "title", issues, { minLength: 3 });
  const description = parseOptionalString(payload?.description, "description", issues, {
    allowNull: true,
  });
  const scheduledAt = parseOptionalDate(payload?.scheduledAt, "scheduledAt", issues);
  const status = parseOptionalEnum(payload?.status, "status", issues, [...EXERCISE_STATUSES]);
  const runbookIds = parseStringArray(payload?.runbookIds, "runbookIds", issues);

  return { issues, data: { title, description, scheduledAt, status, runbookIds } };
}

export function parseChecklistUpdatePayload(payload: any) {
  const issues: ValidationIssue[] = [];
  const notes = parseOptionalString(payload?.notes, "notes", issues, { allowNull: true });
  const isCompletedValue = payload?.isCompleted;
  let isCompleted: boolean | undefined = undefined;
  if (isCompletedValue !== undefined) {
    if (typeof isCompletedValue === "boolean") {
      isCompleted = isCompletedValue;
    } else if (isCompletedValue === "true" || isCompletedValue === "false") {
      isCompleted = isCompletedValue === "true";
    } else {
      issues.push({ field: "isCompleted", message: "doit être un booléen" });
    }
  }
  return { issues, data: { notes, isCompleted } };
}

export function parseExerciseResultPayload(payload: any) {
  const issues: ValidationIssue[] = [];
  const status = parseRequiredString(payload?.status, "status", issues);
  const normalizedStatus = status ? status.toLowerCase() : undefined;
  if (normalizedStatus && !EXERCISE_RESULT_STATUSES.includes(normalizedStatus as any)) {
    issues.push({ field: "status", message: `doit être l'une des valeurs: ${EXERCISE_RESULT_STATUSES.join("|")}` });
  }
  const rtoObservedHours = parseOptionalNumber(payload?.rtoObservedHours, "rtoObservedHours", issues, {
    min: 0,
    allowNull: true,
  });
  const comments = parseOptionalString(payload?.comments, "comments", issues, { allowNull: true });
  const startedAt = parseOptionalDate(payload?.startedAt, "startedAt", issues);
  const completedAt = parseOptionalDate(payload?.completedAt, "completedAt", issues);

  return {
    issues,
    data: {
      status: normalizedStatus,
      rtoObservedHours,
      comments,
      startedAt,
      completedAt,
    },
  };
}

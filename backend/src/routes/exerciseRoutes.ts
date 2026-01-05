import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import {
  buildValidationError,
  parseOptionalString,
  parseRequiredString,
  type ValidationIssue,
} from "../validation/common";

const router = Router();

const EXERCISE_TYPES = ["TABLETOP", "SIMULATION", "RESTORATION_TEST", "CRISIS", "TECHNICAL"];
const EXERCISE_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

function parseEnum(
  value: unknown,
  field: string,
  allowed: string[],
  issues: ValidationIssue[],
  required = false
) {
  const parsed = required
    ? parseRequiredString(value, field, issues, { minLength: 2 })
    : parseOptionalString(value, field, issues);
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

function parseOptionalDate(value: unknown, field: string, issues: ValidationIssue[]) {
  const parsed = parseOptionalString(value, field, issues, { allowNull: true });
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

router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const exercises = await prisma.exercise.findMany({
      where: { tenantId },
      orderBy: [{ conductedAt: "desc" }, { updatedAt: "desc" }],
    });

    return res.json(exercises);
  } catch (error) {
    console.error("Error fetching exercises", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: ValidationIssue[] = [];

    const title = parseRequiredString(payload.title, "title", issues, { minLength: 3 });
    const type = parseEnum(payload.type, "type", EXERCISE_TYPES, issues, true);
    const status = parseEnum(payload.status, "status", EXERCISE_STATUSES, issues, true);
    const scope = parseOptionalString(payload.scope, "scope", issues, { allowNull: true });
    const scenario = parseOptionalString(payload.scenario, "scenario", issues, { allowNull: true });
    const findings = parseOptionalString(payload.findings, "findings", issues, { allowNull: true });
    const improvementPlan = parseOptionalString(payload.improvementPlan, "improvementPlan", issues, {
      allowNull: true,
    });
    const conductedAt = parseOptionalDate(payload.conductedAt, "conductedAt", issues);

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const exercise = await prisma.exercise.create({
      data: {
        tenantId,
        title: title!,
        type: type!,
        status: status!,
        scope: scope ?? null,
        scenario: scenario ?? null,
        findings: findings ?? null,
        improvementPlan: improvementPlan ?? null,
        conductedAt: conductedAt ?? null,
      },
    });

    return res.status(201).json(exercise);
  } catch (error) {
    console.error("Error creating exercise", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { id } = req.params;
    const existing = await prisma.exercise.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const payload = req.body || {};
    const issues: ValidationIssue[] = [];

    const title = parseOptionalString(payload.title, "title", issues, { allowNull: true });
    const type = parseEnum(payload.type, "type", EXERCISE_TYPES, issues);
    const status = parseEnum(payload.status, "status", EXERCISE_STATUSES, issues);
    const scope = parseOptionalString(payload.scope, "scope", issues, { allowNull: true });
    const scenario = parseOptionalString(payload.scenario, "scenario", issues, { allowNull: true });
    const findings = parseOptionalString(payload.findings, "findings", issues, { allowNull: true });
    const improvementPlan = parseOptionalString(payload.improvementPlan, "improvementPlan", issues, {
      allowNull: true,
    });
    const conductedAt = parseOptionalDate(payload.conductedAt, "conductedAt", issues);

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const updated = await prisma.exercise.update({
      where: { id },
      data: {
        title: title !== undefined ? (title ?? null) : existing.title,
        type: type !== undefined ? (type ?? null) : existing.type,
        status: status !== undefined ? (status ?? null) : existing.status,
        scope: scope !== undefined ? scope : existing.scope,
        scenario: scenario !== undefined ? scenario : existing.scenario,
        findings: findings !== undefined ? findings : existing.findings,
        improvementPlan: improvementPlan !== undefined ? improvementPlan : existing.improvementPlan,
        conductedAt: conductedAt !== undefined ? conductedAt : existing.conductedAt,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("Error updating exercise", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

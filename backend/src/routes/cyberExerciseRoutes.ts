import { appLogger } from "../utils/logger.js";
import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import {
  buildValidationError,
  parseOptionalString,
  parseRequiredString,
  parseStringArray,
} from "../validation/common.js";
import prisma from "../prismaClient.js";
import { createCyberExercise, deleteCyberExercise, updateCyberExercise } from "../services/cyberExerciseService.js";

const router = Router();

function ensureTenant(req: TenantRequest, res: any) {
  const tenantId = req.tenantId;
  if (!tenantId) {
    res.status(500).json({ error: "Tenant not resolved" });
    return null;
  }
  return tenantId;
}

function parseDate(value: unknown, field: string, issues: { field: string; message: string }[]) {
  const raw = parseRequiredString(value, field, issues);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    issues.push({ field, message: "doit être une date valide" });
    return undefined;
  }
  return date;
}

function parseOptionalDate(
  value: unknown,
  field: string,
  issues: { field: string; message: string }[]
) {
  if (value === undefined) return undefined;
  const raw = parseOptionalString(value, field, issues);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    issues.push({ field, message: "doit être une date valide" });
    return undefined;
  }
  return date;
}

router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exercises = await prisma.cyberExercise.findMany({
      where: { tenantId },
      orderBy: { date: "desc" },
    });

    return res.json(exercises);
  } catch (error: any) {
    appLogger.error("Error listing cyber exercises", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const exercise = await prisma.cyberExercise.findFirst({
      where: { tenantId, id: exerciseId },
    });

    if (!exercise) {
      return res.status(404).json({ error: "Exercice cyber introuvable" });
    }

    return res.json(exercise);
  } catch (error: any) {
    appLogger.error("Error fetching cyber exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const scenarioId = parseRequiredString(payload.scenarioId, "scenarioId", issues);
    const date = parseDate(payload.date, "date", issues);
    const participants = parseStringArray(payload.participants, "participants", issues) ?? [];
    const simulator = parseOptionalString(payload.simulator, "simulator", issues, { allowNull: true });
    const connectorUrl = parseOptionalString(payload.connectorUrl, "connectorUrl", issues, { allowNull: true });
    const connectorType = parseOptionalString(payload.connectorType, "connectorType", issues, { allowNull: true });

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    if (!scenarioId || !date) {
      return res.status(400).json(buildValidationError(issues));
    }

    const created = await createCyberExercise(tenantId, {
      scenarioId,
      date,
      participants,
      simulator: simulator ?? null,
      connectorUrl: connectorUrl ?? null,
      connectorType: connectorType ?? null,
    });

    return res.status(201).json(created);
  } catch (error: any) {
    appLogger.error("Error creating cyber exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const scenarioId = parseOptionalString(payload.scenarioId, "scenarioId", issues);
    const date = parseOptionalDate(payload.date, "date", issues);
    const participants = parseStringArray(payload.participants, "participants", issues);
    const simulator = parseOptionalString(payload.simulator, "simulator", issues, { allowNull: true });

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const updated = await updateCyberExercise(tenantId, exerciseId, {
      ...(scenarioId !== undefined && scenarioId !== null ? { scenarioId } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(participants !== undefined ? { participants } : {}),
      ...(simulator !== undefined ? { simulator } : {}),
      ...(payload.results !== undefined ? { results: payload.results } : {}),
      ...(payload.runbook !== undefined ? { runbook: payload.runbook } : {}),
      ...(payload.report !== undefined ? { report: payload.report } : {}),
      ...(payload.logs !== undefined ? { logs: payload.logs } : {}),
    });

    return res.json(updated);
  } catch (error: any) {
    appLogger.error("Error updating cyber exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    await deleteCyberExercise(tenantId, exerciseId);
    return res.status(204).send();
  } catch (error: any) {
    appLogger.error("Error deleting cyber exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

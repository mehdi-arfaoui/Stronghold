import { Router } from "express";
import { appLogger } from "../utils/logger.js";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { requireFeature, requireValidLicense } from "../middleware/licenseMiddleware.js";
import { RunbookGeneratorService } from "../services/runbook-generator.service.js";

const router = Router();

router.use(requireValidLicense());
router.use(requireFeature("pra"));

const ALLOWED_STATUSES = new Set(["planned", "in_progress", "completed", "cancelled"]);
const ALLOWED_OUTCOMES = new Set(["success", "partial", "failure"]);

function ensureTenant(req: TenantRequest, res: any): string | null {
  const tenantId = req.tenantId;
  if (!tenantId) {
    res.status(500).json({ error: "Tenant not resolved" });
    return null;
  }
  return tenantId;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function parseInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

router.post("/", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const title =
      typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const scheduledAt = parseDate(req.body?.scheduledAt);
    if (!title) {
      return res.status(400).json({ error: "title est requis" });
    }
    if (!scheduledAt) {
      return res.status(400).json({ error: "scheduledAt est requis" });
    }

    const runbookId =
      typeof req.body?.runbookId === "string" && req.body.runbookId.trim().length > 0
        ? req.body.runbookId.trim()
        : null;
    const simulationId =
      typeof req.body?.simulationId === "string" && req.body.simulationId.trim().length > 0
        ? req.body.simulationId.trim()
        : null;

    let simulation: { id: string; result: unknown } | null = null;

    if (runbookId) {
      const runbook = await prisma.runbook.findFirst({
        where: { id: runbookId, tenantId },
        select: { id: true },
      });
      if (!runbook) {
        return res.status(404).json({ error: "Runbook introuvable pour ce tenant" });
      }
    }

    if (simulationId) {
      simulation = await prisma.simulation.findFirst({
        where: { id: simulationId, tenantId },
        select: { id: true, result: true },
      });
      if (!simulation) {
        return res.status(404).json({ error: "Simulation introuvable pour ce tenant" });
      }
    }

    const predictedRTO =
      parseInteger(req.body?.predictedRTO) ??
      (simulation ? RunbookGeneratorService.extractPredictedRTO(simulation.result) : null);
    const predictedRPO =
      parseInteger(req.body?.predictedRPO) ??
      (simulation ? RunbookGeneratorService.extractPredictedRPO(simulation.result) : null);

    const statusCandidate =
      typeof req.body?.status === "string" ? req.body.status.toLowerCase() : "planned";

    const exercise = await prisma.pRAExercise.create({
      data: {
        tenantId,
        title,
        description:
          typeof req.body?.description === "string" && req.body.description.trim().length > 0
            ? req.body.description.trim()
            : null,
        runbookId,
        simulationId,
        scheduledAt,
        status: ALLOWED_STATUSES.has(statusCandidate) ? statusCandidate : "planned",
        predictedRTO,
        predictedRPO,
      },
    });

    return res.status(201).json(exercise);
  } catch (error: any) {
    appLogger.error("Error creating PRA exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const existing = await prisma.pRAExercise.findFirst({
      where: { id: exerciseId, tenantId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const isCompleted = existing.status === "completed";
    const resultMutationFields = [
      "actualRTO",
      "actualRPO",
      "outcome",
      "findings",
      "duration",
      "executedAt",
      "deviationRTO",
      "deviationRPO",
      "predictedRTO",
      "predictedRPO",
    ];
    const triesToModifyResults = resultMutationFields.some(
      (field) => req.body?.[field] !== undefined
    );

    if (isCompleted && triesToModifyResults) {
      return res.status(409).json({
        error: "Exercise already completed. Create a new exercise to record new results.",
      });
    }

    const data: Record<string, unknown> = {};

    if (req.body?.title !== undefined) {
      const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
      if (!title) {
        return res.status(400).json({ error: "title invalide" });
      }
      data.title = title;
    }

    if (req.body?.description !== undefined) {
      data.description =
        typeof req.body.description === "string" && req.body.description.trim().length > 0
          ? req.body.description.trim()
          : null;
    }

    if (req.body?.runbookId !== undefined) {
      const runbookId =
        typeof req.body.runbookId === "string" && req.body.runbookId.trim().length > 0
          ? req.body.runbookId.trim()
          : null;
      if (runbookId) {
        const runbook = await prisma.runbook.findFirst({
          where: { id: runbookId, tenantId },
          select: { id: true },
        });
        if (!runbook) {
          return res.status(404).json({ error: "Runbook introuvable pour ce tenant" });
        }
      }
      data.runbookId = runbookId;
    }

    if (req.body?.simulationId !== undefined) {
      const simulationId =
        typeof req.body.simulationId === "string" && req.body.simulationId.trim().length > 0
          ? req.body.simulationId.trim()
          : null;
      if (simulationId) {
        const simulation = await prisma.simulation.findFirst({
          where: { id: simulationId, tenantId },
          select: { id: true, result: true },
        });
        if (!simulation) {
          return res.status(404).json({ error: "Simulation introuvable pour ce tenant" });
        }
      }
      data.simulationId = simulationId;
    }

    if (req.body?.scheduledAt !== undefined) {
      data.scheduledAt = parseDate(req.body.scheduledAt) || existing.scheduledAt;
    }
    if (req.body?.executedAt !== undefined) {
      data.executedAt = parseDate(req.body.executedAt);
    }
    if (req.body?.duration !== undefined) {
      data.duration = parseInteger(req.body.duration);
    }
    if (req.body?.status !== undefined) {
      const status = String(req.body.status).toLowerCase();
      data.status = ALLOWED_STATUSES.has(status) ? status : existing.status;
      if (status === "completed" && req.body?.executedAt === undefined) {
        data.executedAt = new Date();
      }
    }
    if (req.body?.outcome !== undefined) {
      const outcome = String(req.body.outcome).toLowerCase();
      data.outcome = ALLOWED_OUTCOMES.has(outcome) ? outcome : null;
    }
    if (req.body?.actualRTO !== undefined) {
      data.actualRTO = parseInteger(req.body.actualRTO);
    }
    if (req.body?.actualRPO !== undefined) {
      data.actualRPO = parseInteger(req.body.actualRPO);
    }
    if (req.body?.predictedRTO !== undefined) {
      data.predictedRTO = parseInteger(req.body.predictedRTO);
    }
    if (req.body?.predictedRPO !== undefined) {
      data.predictedRPO = parseInteger(req.body.predictedRPO);
    }
    if (req.body?.findings !== undefined) {
      data.findings =
        req.body.findings && typeof req.body.findings === "object"
          ? req.body.findings
          : null;
    }

    const actualRTO = (data.actualRTO as number | null | undefined) ?? existing.actualRTO;
    const actualRPO = (data.actualRPO as number | null | undefined) ?? existing.actualRPO;
    const predictedRTO = (data.predictedRTO as number | null | undefined) ?? existing.predictedRTO;
    const predictedRPO = (data.predictedRPO as number | null | undefined) ?? existing.predictedRPO;

    data.deviationRTO =
      actualRTO != null && predictedRTO != null ? actualRTO - predictedRTO : null;
    data.deviationRPO =
      actualRPO != null && predictedRPO != null ? actualRPO - predictedRPO : null;

    await prisma.pRAExercise.updateMany({
      where: { id: exerciseId, tenantId },
      data,
    });

    const updated = await prisma.pRAExercise.findFirst({
      where: { id: exerciseId, tenantId },
      include: {
        runbook: { select: { id: true, title: true, status: true } },
        simulation: { select: { id: true, name: true, scenarioType: true, createdAt: true } },
      },
    });

    if (!updated) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    return res.json(updated);
  } catch (error: any) {
    appLogger.error("Error updating PRA exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const statusFilter =
      typeof req.query.status === "string" ? req.query.status.toLowerCase() : undefined;

    const exercises = await prisma.pRAExercise.findMany({
      where: {
        tenantId,
        ...(statusFilter && ALLOWED_STATUSES.has(statusFilter)
          ? { status: statusFilter }
          : {}),
      },
      include: {
        runbook: { select: { id: true, title: true, status: true } },
        simulation: { select: { id: true, name: true, scenarioType: true, createdAt: true } },
      },
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    });

    return res.json(exercises);
  } catch (error: any) {
    appLogger.error("Error listing PRA exercises", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/comparison", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const exercise = await prisma.pRAExercise.findFirst({
      where: { id: exerciseId, tenantId },
      include: {
        runbook: { select: { id: true, title: true, status: true } },
        simulation: { select: { id: true, name: true, scenarioType: true } },
      },
    });

    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const predictedRTO = exercise.predictedRTO;
    const predictedRPO = exercise.predictedRPO;
    const actualRTO = exercise.actualRTO;
    const actualRPO = exercise.actualRPO;

    const deviationRTO =
      actualRTO != null && predictedRTO != null ? actualRTO - predictedRTO : null;
    const deviationRPO =
      actualRPO != null && predictedRPO != null ? actualRPO - predictedRPO : null;

    return res.json({
      id: exercise.id,
      title: exercise.title,
      status: exercise.status,
      scheduledAt: exercise.scheduledAt,
      executedAt: exercise.executedAt,
      duration: exercise.duration,
      outcome: exercise.outcome,
      predicted: {
        rto: predictedRTO,
        rpo: predictedRPO,
      },
      actual: {
        rto: actualRTO,
        rpo: actualRPO,
      },
      deviation: {
        rto: deviationRTO,
        rpo: deviationRPO,
      },
      findings: exercise.findings,
      runbook: exercise.runbook,
      simulation: exercise.simulation,
    });
  } catch (error: any) {
    appLogger.error("Error fetching PRA exercise comparison", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

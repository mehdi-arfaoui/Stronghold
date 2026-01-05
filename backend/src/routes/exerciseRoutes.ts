import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import { buildValidationError } from "../validation/common";
import {
  parseChecklistUpdatePayload,
  parseExerciseCreatePayload,
  parseExerciseResultPayload,
  parseExerciseUpdatePayload,
} from "../validation/exerciseValidation";
import { buildExerciseAnalysis } from "../services/exerciseAnalysisService";

const router = Router();

function ensureTenant(req: TenantRequest, res: any) {
  const tenantId = req.tenantId;
  if (!tenantId) {
    res.status(500).json({ error: "Tenant not resolved" });
    return null;
  }
  return tenantId;
}

router.post("/", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const { issues, data } = parseExerciseCreatePayload(req.body || {});
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const scenario = await prisma.scenario.findFirst({
      where: { id: data.scenarioId!, tenantId },
    });
    if (!scenario) {
      return res.status(404).json({ error: "Scenario introuvable" });
    }

    if (data.runbookIds.length > 0) {
      const runbooks = await prisma.runbook.findMany({
        where: { tenantId, id: { in: data.runbookIds } },
        select: { id: true },
      });
      if (runbooks.length !== data.runbookIds.length) {
        return res.status(400).json({ error: "Runbooks invalides pour ce tenant" });
      }
    }

    const steps = await prisma.runbookStep.findMany({
      where: { tenantId, scenarioId: data.scenarioId! },
      orderBy: { order: "asc" },
    });

    const exerciseId = await prisma.$transaction(async (tx) => {
      const created = await tx.exercise.create({
        data: {
          tenantId,
          scenarioId: data.scenarioId!,
          title: data.title!,
          description: data.description ?? null,
          scheduledAt: data.scheduledAt!,
          status: "PLANNED",
        },
      });

      if (data.runbookIds.length > 0) {
        await tx.exerciseRunbook.createMany({
          data: data.runbookIds.map((runbookId) => ({
            tenantId,
            exerciseId: created.id,
            runbookId,
          })),
        });
      }

      if (steps.length > 0) {
        await tx.exerciseChecklistItem.createMany({
          data: steps.map((step) => ({
            tenantId,
            exerciseId: created.id,
            runbookStepId: step.id,
            order: step.order,
            title: step.title,
            description: step.description,
            role: step.role,
            blocking: step.blocking,
          })),
        });
      }

      return created.id;
    });

    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, tenantId },
      include: {
        scenario: true,
        runbooks: { include: { runbook: true } },
        checklistItems: { orderBy: { order: "asc" } },
      },
    });

    return res.status(201).json(exercise);
  } catch (error: any) {
    console.error("Error creating exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exercises = await prisma.exercise.findMany({
      where: { tenantId },
      orderBy: { scheduledAt: "desc" },
      include: {
        scenario: true,
        runbooks: { include: { runbook: true } },
        results: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    return res.json(exercises);
  } catch (error: any) {
    console.error("Error listing exercises", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const existing = await prisma.exercise.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const { issues, data } = parseExerciseUpdatePayload(req.body || {});

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const updated = await prisma.exercise.update({
      where: { id },
      data: {
        title: data.title !== undefined ? (data.title ?? null) : existing.title,
        description: data.description !== undefined ? data.description : existing.description,
        scheduledAt: data.scheduledAt !== undefined ? data.scheduledAt : existing.scheduledAt,
        status: data.status !== undefined ? data.status : existing.status,
      },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error("Error updating exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id/checklist", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const exercise = await prisma.exercise.findFirst({ where: { id, tenantId } });
    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const { issues, data } = parseChecklistUpdatePayload(req.body || {});
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    await prisma.$transaction(
      data.items.map((item) =>
        prisma.exerciseChecklistItem.updateMany({
          where: { id: item.id, tenantId, exerciseId: id },
          data: { status: item.status },
        })
      )
    );

    const checklistItems = await prisma.exerciseChecklistItem.findMany({
      where: { tenantId, exerciseId: id },
      orderBy: { order: "asc" },
    });

    return res.json({ checklistItems });
  } catch (error: any) {
    console.error("Error updating exercise checklist", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/results", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const exercise = await prisma.exercise.findFirst({ where: { id, tenantId } });
    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const { issues, data } = parseExerciseResultPayload(req.body || {});
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const checklistItems = await prisma.exerciseChecklistItem.findMany({
      where: { tenantId, exerciseId: id },
    });
    const analysis = buildExerciseAnalysis(checklistItems);

    const result = await prisma.exerciseResult.create({
      data: {
        tenantId,
        exerciseId: id,
        summary: data.summary ?? null,
        findings: data.findings ?? null,
        improvementPlan: data.improvementPlan ?? null,
        analysis,
      },
    });

    await prisma.exercise.update({
      where: { id },
      data: { status: "COMPLETED" },
    });

    return res.status(201).json(result);
  } catch (error: any) {
    console.error("Error creating exercise result", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

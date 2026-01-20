import { Router } from "express";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import {
  buildValidationError,
} from "../validation/common.js";
import {
  parseChecklistUpdatePayload,
  parseExerciseCreatePayload,
  parseExerciseAssistantPayload,
  parseExerciseResultPayload,
  parseExerciseSimulationPayload,
  parseExerciseUpdatePayload,
} from "../validation/exerciseValidation.js";
import { buildExerciseAnalysis } from "../services/exerciseAnalysisService.js";
import { runCyberSimulation } from "../services/cyberSimulationService.js";
import { buildExerciseAssistantReport } from "../services/exerciseAssistantService.js";
import { getCyberScenarioDetails, resolveCyberScenarioFromType } from "../services/cyberScenarioService.js";

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

router.get("/:id", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, tenantId },
      include: {
        scenario: true,
        runbooks: { include: { runbook: true } },
        checklistItems: { orderBy: { order: "asc" } },
        results: { orderBy: { createdAt: "desc" } },
        analyses: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    return res.json(exercise);
  } catch (error: any) {
    console.error("Error fetching exercise", { message: error?.message });
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

    const { issues, data } = parseExerciseUpdatePayload(req.body || {});
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, tenantId },
      include: { runbooks: true },
    });

    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    if (data.runbookIds && data.runbookIds.length > 0) {
      const runbooks = await prisma.runbook.findMany({
        where: { tenantId, id: { in: data.runbookIds } },
        select: { id: true },
      });
      if (runbooks.length !== data.runbookIds.length) {
        return res.status(400).json({ error: "Runbooks invalides pour ce tenant" });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.exercise.updateMany({
        where: { id: exercise.id, tenantId },
        data: {
          ...(data.title !== undefined && data.title !== null ? { title: data.title } : {}),
          ...(data.description !== undefined ? { description: data.description ?? null } : {}),
          ...(data.scheduledAt !== undefined && data.scheduledAt !== null
            ? { scheduledAt: data.scheduledAt }
            : {}),
          ...(data.status ? { status: data.status.toUpperCase() } : {}),
        },
      });

      if (data.runbookIds) {
        await tx.exerciseRunbook.deleteMany({
          where: { tenantId, exerciseId: exercise.id },
        });
        if (data.runbookIds.length > 0) {
          await tx.exerciseRunbook.createMany({
            data: data.runbookIds.map((runbookId) => ({
              tenantId,
              exerciseId: exercise.id,
              runbookId,
            })),
          });
        }
      }
    });

    const updated = await prisma.exercise.findFirst({
      where: { id: exercise.id, tenantId },
      include: {
        scenario: true,
        runbooks: { include: { runbook: true } },
        checklistItems: { orderBy: { order: "asc" } },
      },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error("Error updating exercise", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch(
  "/:exerciseId/checklist/:itemId",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = ensureTenant(req, res);
      if (!tenantId) return;

      const exerciseId = req.params.exerciseId;
      const itemId = req.params.itemId;
      if (!exerciseId || !itemId) {
        return res.status(400).json({ error: "id est requis" });
      }

      const { issues, data } = parseChecklistUpdatePayload(req.body || {});
      if (issues.length > 0) {
        return res.status(400).json(buildValidationError(issues));
      }

      const item = await prisma.exerciseChecklistItem.findFirst({
        where: {
          id: itemId,
          tenantId,
          exerciseId,
        },
      });

      if (!item) {
        return res.status(404).json({ error: "Checklist introuvable" });
      }

      await prisma.exerciseChecklistItem.updateMany({
        where: { id: item.id, tenantId, exerciseId },
        data: {
          ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
          ...(data.isCompleted !== undefined ? { isCompleted: data.isCompleted } : {}),
          ...(data.isCompleted === true
            ? { completedAt: new Date() }
            : data.isCompleted === false
              ? { completedAt: null }
              : {}),
        },
      });

      const updated = await prisma.exerciseChecklistItem.findFirst({
        where: { id: item.id, tenantId, exerciseId },
      });

      return res.json(updated);
    } catch (error: any) {
      console.error("Error updating checklist item", { message: error?.message });
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post("/:id/results", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const { issues, data } = parseExerciseResultPayload(req.body || {});
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, tenantId },
    });
    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.exerciseResult.create({
        data: {
          tenantId,
          exerciseId: exercise.id,
          status: data.status!,
          rtoObservedHours: data.rtoObservedHours ?? null,
          comments: data.comments ?? null,
          startedAt: data.startedAt ?? null,
          completedAt: data.completedAt ?? null,
        },
      });

      await tx.exercise.updateMany({
        where: { id: exercise.id, tenantId },
        data: { status: "COMPLETED" },
      });

      return created;
    });

    return res.status(201).json(result);
  } catch (error: any) {
    console.error("Error recording exercise result", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/analysis", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, tenantId },
      include: {
        scenario: true,
        checklistItems: true,
        results: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const latestResult = exercise.results[0];
    if (!latestResult) {
      return res.status(400).json({ error: "Aucun résultat enregistré pour cet exercice" });
    }

    const totalChecklist = exercise.checklistItems.length;
    const completedChecklist = exercise.checklistItems.filter((item) => item.isCompleted).length;
    const incompleteTitles = exercise.checklistItems
      .filter((item) => !item.isCompleted)
      .map((item) => item.title);

    const analysis = buildExerciseAnalysis({
      resultStatus: latestResult.status,
      rtoObservedHours: latestResult.rtoObservedHours ?? null,
      targetRtoHours: exercise.scenario?.rtoTargetHours ?? null,
      checklistTotal: totalChecklist,
      checklistCompleted: completedChecklist,
      incompleteChecklistTitles: incompleteTitles,
    });

    const saved = await prisma.exerciseAnalysis.create({
      data: {
        tenantId,
        exerciseId: exercise.id,
        summary: analysis.summary,
        gaps: analysis.gaps,
        correctiveActions: analysis.correctiveActions,
      },
    });

    return res.status(201).json(saved);
  } catch (error: any) {
    console.error("Error generating exercise analysis", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/report", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, tenantId },
      include: {
        scenario: true,
        runbooks: { include: { runbook: true } },
        checklistItems: { orderBy: { order: "asc" } },
        results: { orderBy: { createdAt: "desc" } },
        analyses: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const latestResult = exercise.results[0] ?? null;
    const latestAnalysis = exercise.analyses[0] ?? null;
    const totalChecklist = exercise.checklistItems.length;
    const completedChecklist = exercise.checklistItems.filter((item) => item.isCompleted).length;
    const completionRate = totalChecklist > 0 ? Math.round((completedChecklist / totalChecklist) * 100) : 100;
    const targetRto = exercise.scenario?.rtoTargetHours ?? null;
    const rtoObserved = latestResult?.rtoObservedHours ?? null;
    const rtoDelta = targetRto !== null && rtoObserved !== null ? rtoObserved - targetRto : null;

    return res.json({
      exercise,
      summary: {
        checklist: {
          total: totalChecklist,
          completed: completedChecklist,
          completionRate,
        },
        rto: {
          targetHours: targetRto,
          observedHours: rtoObserved,
          deltaHours: rtoDelta,
        },
        latestResult,
        latestAnalysis,
      },
    });
  } catch (error: any) {
    console.error("Error generating exercise report", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/assistant", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const { issues, data } = parseExerciseAssistantPayload(req.body || {});
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, tenantId },
      include: { scenario: true },
    });

    if (!exercise) {
      return res.status(404).json({ error: "Exercice introuvable" });
    }

    const scenario = data.scenarioLibraryId
      ? getCyberScenarioDetails(data.scenarioLibraryId)
      : resolveCyberScenarioFromType(exercise.scenario?.type);

    const output = buildExerciseAssistantReport(
      scenario,
      {
        durationHours: data.durationHours ?? null,
        targets: data.targets,
        participants: data.participants,
        objectives: data.objectives,
      },
      exercise.title
    );

    return res.json({
      exerciseId: exercise.id,
      scenarioLibraryId: scenario?.id ?? null,
      ...output,
    });
  } catch (error: any) {
    console.error("Error generating exercise assistant report", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/simulations", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const { issues, data } = parseExerciseSimulationPayload(req.body || {});
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const simulation = await runCyberSimulation(tenantId, exerciseId, {
      simulator: data.simulator!,
      durationHours: data.durationHours ?? null,
      targets: data.targets,
      participants: data.participants,
      objectives: data.objectives,
      scenarioLibraryId: data.scenarioLibraryId ?? null,
      connectorUrl: data.connectorUrl ?? null,
      connectorType: data.connectorType ?? null,
    });

    return res.status(201).json(simulation);
  } catch (error: any) {
    console.error("Error running cyber simulation", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/simulations", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const exerciseId = req.params.id;
    if (!exerciseId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const simulations = await prisma.exerciseSimulation.findMany({
      where: { tenantId, exerciseId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(simulations);
  } catch (error: any) {
    console.error("Error fetching simulations", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

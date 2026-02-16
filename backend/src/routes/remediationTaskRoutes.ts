import { Router } from "express";
import { appLogger } from "../utils/logger.js";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { requireFeature, requireValidLicense } from "../middleware/licenseMiddleware.js";

const router = Router();

router.use(requireValidLicense());
router.use(requireFeature("pra"));

const ALLOWED_STATUSES = new Set([
  "todo",
  "in_progress",
  "done",
  "blocked",
  "cancelled",
]);
const ALLOWED_PRIORITIES = new Set(["critical", "high", "medium", "low"]);

function ensureTenant(req: TenantRequest, res: any): string | null {
  const tenantId = req.tenantId;
  if (!tenantId) {
    res.status(500).json({ error: "Tenant not resolved" });
    return null;
  }
  return tenantId;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

router.post("/", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const title =
      typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const recommendationId =
      typeof req.body?.recommendationId === "string"
        ? req.body.recommendationId.trim()
        : "";

    if (!title) {
      return res.status(400).json({ error: "title est requis" });
    }
    if (!recommendationId) {
      return res.status(400).json({ error: "recommendationId est requis" });
    }

    const statusCandidate =
      typeof req.body?.status === "string" ? req.body.status.toLowerCase() : "todo";
    const priorityCandidate =
      typeof req.body?.priority === "string" ? req.body.priority.toLowerCase() : "medium";

    const task = await prisma.remediationTask.create({
      data: {
        tenantId,
        title,
        description:
          typeof req.body?.description === "string" ? req.body.description.trim() : null,
        recommendationId,
        status: ALLOWED_STATUSES.has(statusCandidate) ? statusCandidate : "todo",
        priority: ALLOWED_PRIORITIES.has(priorityCandidate) ? priorityCandidate : "medium",
        assignee:
          typeof req.body?.assignee === "string" ? req.body.assignee.trim() : null,
        dueDate: asDate(req.body?.dueDate),
        completedAt: asDate(req.body?.completedAt),
        estimatedCost: asPositiveNumber(req.body?.estimatedCost),
        actualCost: asPositiveNumber(req.body?.actualCost),
        riskReduction: asPositiveNumber(req.body?.riskReduction),
      },
    });

    return res.status(201).json(task);
  } catch (error: any) {
    appLogger.error("Error creating remediation task", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const statusFilter =
      typeof req.query.status === "string" ? req.query.status.toLowerCase() : undefined;
    const priorityFilter =
      typeof req.query.priority === "string" ? req.query.priority.toLowerCase() : undefined;

    const tasks = await prisma.remediationTask.findMany({
      where: {
        tenantId,
        ...(statusFilter && ALLOWED_STATUSES.has(statusFilter)
          ? { status: statusFilter }
          : {}),
        ...(priorityFilter && ALLOWED_PRIORITIES.has(priorityFilter)
          ? { priority: priorityFilter }
          : {}),
      },
      orderBy: [{ priority: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    });

    return res.json(tasks);
  } catch (error: any) {
    appLogger.error("Error listing remediation tasks", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const taskId = req.params.id;
    if (!taskId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const existing = await prisma.remediationTask.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Tache introuvable" });
    }

    const data: Record<string, unknown> = {};

    if (req.body?.title !== undefined) {
      const title =
        typeof req.body.title === "string" ? req.body.title.trim() : "";
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

    if (req.body?.recommendationId !== undefined) {
      data.recommendationId =
        typeof req.body.recommendationId === "string" && req.body.recommendationId.trim().length > 0
          ? req.body.recommendationId.trim()
          : existing.recommendationId;
    }

    if (req.body?.status !== undefined) {
      const status = String(req.body.status).toLowerCase();
      data.status = ALLOWED_STATUSES.has(status) ? status : existing.status;
      if (status === "done" && req.body?.completedAt === undefined) {
        data.completedAt = new Date();
      }
    }

    if (req.body?.priority !== undefined) {
      const priority = String(req.body.priority).toLowerCase();
      data.priority = ALLOWED_PRIORITIES.has(priority) ? priority : existing.priority;
    }

    if (req.body?.assignee !== undefined) {
      data.assignee =
        typeof req.body.assignee === "string" && req.body.assignee.trim().length > 0
          ? req.body.assignee.trim()
          : null;
    }

    if (req.body?.dueDate !== undefined) {
      data.dueDate = asDate(req.body.dueDate);
    }

    if (req.body?.completedAt !== undefined) {
      data.completedAt = asDate(req.body.completedAt);
    }

    if (req.body?.estimatedCost !== undefined) {
      data.estimatedCost = asPositiveNumber(req.body.estimatedCost);
    }

    if (req.body?.actualCost !== undefined) {
      data.actualCost = asPositiveNumber(req.body.actualCost);
    }

    if (req.body?.riskReduction !== undefined) {
      data.riskReduction = asPositiveNumber(req.body.riskReduction);
    }

    await prisma.remediationTask.updateMany({
      where: { id: taskId, tenantId },
      data,
    });

    const updated = await prisma.remediationTask.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!updated) {
      return res.status(404).json({ error: "Tache introuvable" });
    }

    return res.json(updated);
  } catch (error: any) {
    appLogger.error("Error updating remediation task", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/summary", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = ensureTenant(req, res);
    if (!tenantId) return;

    const tasks = await prisma.remediationTask.findMany({
      where: { tenantId },
      select: {
        id: true,
        status: true,
        priority: true,
        estimatedCost: true,
        actualCost: true,
      },
    });

    const byStatus: Record<string, number> = {
      todo: 0,
      in_progress: 0,
      done: 0,
      blocked: 0,
      cancelled: 0,
    };
    const byPriority: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    let estimatedCostTotal = 0;
    let actualCostTotal = 0;

    for (const task of tasks) {
      if (task.status in byStatus) {
        byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
      }
      if (task.priority in byPriority) {
        byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1;
      }
      estimatedCostTotal += task.estimatedCost || 0;
      actualCostTotal += task.actualCost || 0;
    }

    const total = tasks.length;
    const doneCount = byStatus.done || 0;
    const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    return res.json({
      total,
      byStatus,
      byPriority,
      doneCount,
      completionRate,
      estimatedCostTotal,
      actualCostTotal,
    });
  } catch (error: any) {
    appLogger.error("Error building remediation summary", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

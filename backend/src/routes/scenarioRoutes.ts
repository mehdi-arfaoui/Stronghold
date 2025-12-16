import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest } from "../middleware/tenantMiddleware";

const router = Router();

/**
 * GET /scenarios
 * Liste tous les scénarios du tenant avec services impactés + steps
 */
router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const scenarios = await prisma.scenario.findMany({
      where: { tenantId },
      include: {
        services: {
          include: {
            service: true,
          },
        },
        steps: {
          orderBy: {
            order: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(scenarios);
  } catch (error) {
    console.error("Error fetching scenarios:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /scenarios
 * body: { name, type, description?, impactLevel?, rtoTargetHours?, serviceIds?: string[] }
 */
router.post("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const {
      name,
      type,
      description,
      impactLevel,
      rtoTargetHours,
      serviceIds,
    } = req.body;

    if (!name || typeof name !== "string" || name.trim().length < 3) {
      return res
        .status(400)
        .json({ error: "name is required and must be at least 3 characters" });
    }

    if (!type || typeof type !== "string") {
      return res.status(400).json({ error: "type is required" });
    }

    let impact: string | null = null;
    if (impactLevel) {
      const lvl = String(impactLevel).toLowerCase();
      const allowed = ["low", "medium", "high"];
      if (!allowed.includes(lvl)) {
        return res.status(400).json({
          error: "impactLevel must be one of low|medium|high when provided",
        });
      }
      impact = lvl;
    }

    let rtoHours: number | null = null;
    if (rtoTargetHours !== undefined && rtoTargetHours !== null) {
      const parsed = Number(rtoTargetHours);
      if (isNaN(parsed) || parsed < 0) {
        return res
          .status(400)
          .json({ error: "rtoTargetHours must be a number >= 0 when provided" });
      }
      rtoHours = parsed;
    }

    const scenario = await prisma.scenario.create({
      data: {
        tenantId,
        name: name.trim(),
        type: type.trim(),
        description: description ? String(description).trim() : null,
        impactLevel: impact,
        rtoTargetHours: rtoHours,
      },
    });

    // Lier aux services impactés
    if (Array.isArray(serviceIds) && serviceIds.length > 0) {
      const ids = serviceIds.map((id: any) => String(id));

      const services = await prisma.service.findMany({
        where: {
          tenantId,
          id: { in: ids },
        },
        select: { id: true },
      });

      if (services.length !== ids.length) {
        return res.status(400).json({
          error:
            "One or more serviceIds do not belong to this tenant or do not exist",
        });
      }

      await prisma.scenarioService.createMany({
        data: ids.map((serviceId) => ({
          tenantId,
          scenarioId: scenario.id,
          serviceId,
        })),
      });
    }

    const fullScenario = await prisma.scenario.findUnique({
      where: { id: scenario.id },
      include: {
        services: {
          include: { service: true },
        },
        steps: {
          orderBy: { order: "asc" },
        },
      },
    });

    return res.status(201).json(fullScenario);
  } catch (error) {
    console.error("Error creating scenario:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /scenarios/:id/steps
 * body: { order, title, description?, estimatedDurationMinutes?, role?, blocking? }
 */
router.post("/:id/steps", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const scenarioId = req.params.id;
    const { order, title, description, estimatedDurationMinutes, role, blocking } =
      req.body;

    const scenario = await prisma.scenario.findFirst({
      where: { id: scenarioId, tenantId },
    });

    if (!scenario) {
      return res
        .status(404)
        .json({ error: "Scenario not found for this tenant" });
    }

    const ord = Number(order);
    if (!Number.isInteger(ord) || ord < 1) {
      return res
        .status(400)
        .json({ error: "order must be an integer >= 1" });
    }

    if (!title || typeof title !== "string" || title.trim().length < 3) {
      return res.status(400).json({
        error: "title is required and must be at least 3 characters",
      });
    }

    let estMinutes: number | null = null;
    if (
      estimatedDurationMinutes !== undefined &&
      estimatedDurationMinutes !== null
    ) {
      const parsed = Number(estimatedDurationMinutes);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({
          error:
            "estimatedDurationMinutes must be a number >= 0 when provided",
        });
      }
      estMinutes = parsed;
    }

    const step = await prisma.runbookStep.create({
      data: {
        tenantId,
        scenarioId: scenario.id,
        order: ord,
        title: title.trim(),
        description: description ? String(description).trim() : null,
        estimatedDurationMinutes: estMinutes,
        role: role ? String(role).trim() : null,
        blocking: Boolean(blocking),
      },
    });

    return res.status(201).json(step);
  } catch (error) {
    console.error("Error creating runbook step:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import {
  buildValidationError,
  parseOptionalBoolean,
  parseOptionalEnum,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredNumber,
  parseRequiredString,
  parseStringArray,
} from "../validation/common";

const router = Router();

/**
 * GET /scenarios
 * Liste tous les scénarios du tenant avec services impactés + steps
 */
router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
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
        catalogScenario: true,
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
router.post("/", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const name = parseRequiredString(payload.name, "name", issues, { minLength: 3 });
    const type = parseRequiredString(payload.type, "type", issues);
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const impact = parseOptionalEnum(
      payload.impactLevel,
      "impactLevel",
      issues,
      ["low", "medium", "high"],
      { allowNull: true }
    );
    const catalogScenarioId = parseOptionalString(
      payload.catalogScenarioId,
      "catalogScenarioId",
      issues,
      { allowNull: true }
    );
    const rtoHours = parseOptionalNumber(
      payload.rtoTargetHours,
      "rtoTargetHours",
      issues,
      { allowNull: true, min: 0 }
    );
    const serviceIds = parseStringArray(payload.serviceIds, "serviceIds", issues);
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    if (catalogScenarioId) {
      const catalog = await prisma.scenarioCatalog.findFirst({
        where: { id: catalogScenarioId, tenantId },
        select: { id: true },
      });
      if (!catalog) {
        return res
          .status(400)
          .json({ error: "catalogScenarioId does not belong to this tenant" });
      }
    }

    const scenario = await prisma.scenario.create({
      data: {
        tenantId,
        catalogScenarioId: catalogScenarioId ?? null,
        name,
        type,
        description,
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
        catalogScenario: true,
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
 * PUT /scenarios/:id
 * body: { name?, type?, description?, impactLevel?, rtoTargetHours?, serviceIds?: string[] }
 */
router.put("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const scenarioId = req.params.id;
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const name =
      payload.name !== undefined
        ? parseRequiredString(payload.name, "name", issues, { minLength: 3 })
        : undefined;
    const type =
      payload.type !== undefined
        ? parseRequiredString(payload.type, "type", issues)
        : undefined;
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const impactLevel = parseOptionalEnum(
      payload.impactLevel,
      "impactLevel",
      issues,
      ["low", "medium", "high"],
      { allowNull: true }
    );
    const catalogScenarioId = parseOptionalString(
      payload.catalogScenarioId,
      "catalogScenarioId",
      issues,
      { allowNull: true }
    );
    const rtoTargetHours = parseOptionalNumber(
      payload.rtoTargetHours,
      "rtoTargetHours",
      issues,
      { allowNull: true, min: 0 }
    );
    const serviceIds = parseStringArray(payload.serviceIds, "serviceIds", issues);
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const scenario = await prisma.scenario.findFirst({ where: { id: scenarioId, tenantId } });
    if (!scenario) {
      return res.status(404).json({ error: "Scenario not found for this tenant" });
    }

    const data: any = {};

    if (name !== undefined) {
      data.name = name;
    }

    if (type !== undefined) {
      data.type = type;
    }

    if (description !== undefined) {
      data.description = description;
    }

    if (impactLevel !== undefined) {
      data.impactLevel = impactLevel;
    }

    if (catalogScenarioId !== undefined) {
      if (catalogScenarioId) {
        const catalog = await prisma.scenarioCatalog.findFirst({
          where: { id: catalogScenarioId, tenantId },
          select: { id: true },
        });
        if (!catalog) {
          return res
            .status(400)
            .json({ error: "catalogScenarioId does not belong to this tenant" });
        }
      }
      data.catalogScenarioId = catalogScenarioId ?? null;
    }

    if (rtoTargetHours !== undefined) {
      data.rtoTargetHours = rtoTargetHours;
    }

    const updates: Promise<any>[] = [];
    updates.push(
      prisma.scenario.update({
        where: { id: scenarioId },
        data,
      })
    );

    if (Array.isArray(serviceIds)) {
      const ids = serviceIds.map((id: any) => String(id));
      if (ids.length > 0) {
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
      }

      updates.push(prisma.scenarioService.deleteMany({ where: { tenantId, scenarioId } }));
      if (ids.length > 0) {
        updates.push(
          prisma.scenarioService.createMany({
            data: ids.map((serviceId) => ({
              tenantId,
              scenarioId,
              serviceId,
            })),
          })
        );
      }
    }

    await prisma.$transaction(updates);

    const fullScenario = await prisma.scenario.findUnique({
      where: { id: scenarioId },
      include: {
        services: {
          include: { service: true },
        },
        catalogScenario: true,
        steps: {
          orderBy: { order: "asc" },
        },
      },
    });

    return res.json(fullScenario);
  } catch (error) {
    console.error("Error updating scenario:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /scenarios/:id
 */
router.delete("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const scenarioId = req.params.id;
    const scenario = await prisma.scenario.findFirst({ where: { id: scenarioId, tenantId } });
    if (!scenario) {
      return res.status(404).json({ error: "Scenario not found for this tenant" });
    }

    await prisma.$transaction([
      prisma.runbookStep.deleteMany({ where: { tenantId, scenarioId } }),
      prisma.scenarioService.deleteMany({ where: { tenantId, scenarioId } }),
      prisma.runbook.updateMany({ where: { tenantId, scenarioId }, data: { scenarioId: null } }),
      prisma.scenario.deleteMany({ where: { id: scenarioId, tenantId } }),
    ]);

    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting scenario:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /scenarios/:id/steps
 * body: { order, title, description?, estimatedDurationMinutes?, role?, blocking? }
 */
router.post("/:id/steps", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const scenarioId = req.params.id;
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const order = parseRequiredNumber(payload.order, "order", issues);
    const title = parseRequiredString(payload.title, "title", issues, { minLength: 3 });
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const estimatedDurationMinutes = parseOptionalNumber(
      payload.estimatedDurationMinutes,
      "estimatedDurationMinutes",
      issues,
      { allowNull: true, min: 0 }
    );
    const role = parseOptionalString(payload.role, "role", issues, { allowNull: true });
    const blocking = parseOptionalBoolean(payload.blocking, "blocking", issues);

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

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

    let estMinutes: number | null = null;
    if (estimatedDurationMinutes !== undefined) {
      estMinutes = estimatedDurationMinutes === null ? null : estimatedDurationMinutes;
    }

    const step = await prisma.runbookStep.create({
      data: {
        tenantId,
        scenarioId: scenario.id,
        order: ord,
        title,
        description,
        estimatedDurationMinutes: estMinutes,
        role,
        blocking: Boolean(blocking),
      },
    });

    return res.status(201).json(step);
  } catch (error) {
    console.error("Error creating runbook step:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /scenarios/:id/steps/:stepId
 */
router.put("/:id/steps/:stepId", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const scenarioId = req.params.id;
    const stepId = req.params.stepId;
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const order =
      payload.order !== undefined
        ? parseRequiredNumber(payload.order, "order", issues)
        : undefined;
    const title =
      payload.title !== undefined
        ? parseRequiredString(payload.title, "title", issues, { minLength: 3 })
        : undefined;
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const estimatedDurationMinutes = parseOptionalNumber(
      payload.estimatedDurationMinutes,
      "estimatedDurationMinutes",
      issues,
      { allowNull: true, min: 0 }
    );
    const role = parseOptionalString(payload.role, "role", issues, { allowNull: true });
    const blocking = parseOptionalBoolean(payload.blocking, "blocking", issues);
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const step = await prisma.runbookStep.findFirst({
      where: { id: stepId, scenarioId, tenantId },
    });

    if (!step) {
      return res.status(404).json({ error: "Étape introuvable pour ce tenant" });
    }

    const data: any = {};

    if (order !== undefined) {
      const ord = Number(order);
      if (!Number.isInteger(ord) || ord < 1) {
        return res.status(400).json({ error: "order must be an integer >= 1" });
      }
      data.order = ord;
    }

    if (title !== undefined) {
      data.title = title;
    }

    if (description !== undefined) {
      data.description = description;
    }

    if (estimatedDurationMinutes !== undefined) {
      data.estimatedDurationMinutes = estimatedDurationMinutes;
    }

    if (role !== undefined) {
      data.role = role;
    }

    if (blocking !== undefined) {
      data.blocking = Boolean(blocking);
    }

    const updated = await prisma.runbookStep.update({
      where: { id: stepId },
      data,
    });

    return res.json(updated);
  } catch (error) {
    console.error("Error updating runbook step:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /scenarios/:id/steps/:stepId
 */
router.delete("/:id/steps/:stepId", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const scenarioId = req.params.id;
    const stepId = req.params.stepId;

    const step = await prisma.runbookStep.findFirst({
      where: { id: stepId, scenarioId, tenantId },
    });

    if (!step) {
      return res.status(404).json({ error: "Étape introuvable pour ce tenant" });
    }

    await prisma.runbookStep.delete({ where: { id: stepId } });
    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting runbook step:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

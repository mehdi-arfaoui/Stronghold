import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import {
  buildValidationError,
  parseOptionalEnum,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredNumber,
  parseRequiredString,
} from "../validation/common";

const router = Router();

function buildContinuityAdvisory(rtoHours: number, rpoMinutes: number, mtpdHours: number) {
  const parts: string[] = [];
  parts.push(
    "RTO (Recovery Time Objective) = durée maximale d'interruption acceptée avant reprise du service (référence f5.com)."
  );
  parts.push(
    "RPO (Recovery Point Objective) = perte de données maximale acceptable exprimée en minutes ou heures (référence tierpoint.com)."
  );
  parts.push(
    "MTPD (Maximum Tolerable Period of Disruption) = durée totale au-delà de laquelle l'impact devient inacceptable (référence riskythinking.com)."
  );
  parts.push(
    `Ce service vise RTO=${rtoHours}h, RPO=${rpoMinutes} min, MTPD=${mtpdHours}h. Vérifier que les dépendances et backups respectent ces bornes.`
  );
  return parts.join(" \n");
}

/**
 * GET /services
 * Retourne la liste des services du tenant courant,
 * avec continuité, dépendances et liens infra.
 */
router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const services = await prisma.service.findMany({
      where: { tenantId },
      include: {
        continuity: true,
        dependenciesFrom: {
          include: {
            toService: true,
          },
        },
        dependenciesTo: {
          include: {
            fromService: true,
          },
        },
        infraLinks: {
          include: {
            infra: true,
          },
        },
        backupStrategies: true,
        policyLinks: {
          include: {
            policy: true,
          },
        },
        dependencyCycles: {
          include: {
            cycle: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    return res.json(services);
  } catch (error) {
    console.error("Error in GET /services:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /services/:id
 * Met à jour un service et ses critères de continuité.
 */
router.put("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const serviceId = req.params.id;
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const name =
      payload.name !== undefined
        ? parseRequiredString(payload.name, "name", issues)
        : undefined;
    const type =
      payload.type !== undefined
        ? parseRequiredString(payload.type, "type", issues)
        : undefined;
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const criticality = parseOptionalEnum(
      payload.criticality,
      "criticality",
      issues,
      ["low", "medium", "high"]
    );
    const businessPriority = parseOptionalString(
      payload.businessPriority,
      "businessPriority",
      issues,
      { allowNull: true }
    );
    const recoveryPriority = parseOptionalNumber(
      payload.recoveryPriority,
      "recoveryPriority",
      issues,
      { allowNull: true }
    );
    const domain = parseOptionalString(payload.domain, "domain", issues, {
      allowNull: true,
    });
    const rtoHours = parseOptionalNumber(payload.rtoHours, "rtoHours", issues);
    const rpoMinutes = parseOptionalNumber(payload.rpoMinutes, "rpoMinutes", issues);
    const mtpdHours = parseOptionalNumber(payload.mtpdHours, "mtpdHours", issues);
    const notes = parseOptionalString(payload.notes, "notes", issues, {
      allowNull: true,
    });

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const service = await prisma.service.findFirst({
      where: { id: serviceId, tenantId },
      include: { continuity: true },
    });

    if (!service) {
      return res.status(404).json({ error: "Service introuvable pour ce tenant" });
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

    if (criticality !== undefined) {
      data.criticality = criticality;
    }

    if (businessPriority !== undefined) {
      data.businessPriority = businessPriority;
    }

    if (recoveryPriority !== undefined) {
      data.recoveryPriority = recoveryPriority;
    }

    if (domain !== undefined) {
      data.domain = domain ? domain.toUpperCase() : null;
    }

    const continuityPayload: any = {};
    if (rtoHours !== undefined) {
      continuityPayload.rtoHours = rtoHours;
    }
    if (rpoMinutes !== undefined) {
      continuityPayload.rpoMinutes = rpoMinutes;
    }
    if (mtpdHours !== undefined) {
      continuityPayload.mtpdHours = mtpdHours;
    }
    if (notes !== undefined) {
      continuityPayload.notes = notes;
    }

    if (Object.keys(continuityPayload).length > 0) {
      const existingContinuity = service.continuity;
      const nextRto = continuityPayload.rtoHours ?? existingContinuity?.rtoHours;
      const nextRpo = continuityPayload.rpoMinutes ?? existingContinuity?.rpoMinutes;
      const nextMtpd = continuityPayload.mtpdHours ?? existingContinuity?.mtpdHours;

      if (!existingContinuity && (nextRto == null || nextRpo == null || nextMtpd == null)) {
        return res.status(400).json({
          error: "rtoHours, rpoMinutes et mtpdHours sont requis pour créer la continuité",
        });
      }

      if (nextRto != null && nextRpo != null && nextMtpd != null) {
        continuityPayload.advisoryNotes = buildContinuityAdvisory(nextRto, nextRpo, nextMtpd);
      }

      data.continuity = existingContinuity
        ? { update: continuityPayload }
        : {
            create: {
              rtoHours: Number(nextRto),
              rpoMinutes: Number(nextRpo),
              mtpdHours: Number(nextMtpd),
              notes: continuityPayload.notes ?? null,
              advisoryNotes: continuityPayload.advisoryNotes,
            },
          };
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data,
      include: {
        continuity: true,
        dependenciesFrom: true,
        dependenciesTo: true,
        infraLinks: { include: { infra: true } },
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("Error in PUT /services/:id:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /services/:id
 * Supprime un service et ses liens.
 */
router.delete("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const serviceId = req.params.id;
    const service = await prisma.service.findFirst({ where: { id: serviceId, tenantId } });
    if (!service) {
      return res.status(404).json({ error: "Service introuvable pour ce tenant" });
    }

    await prisma.$transaction([
      prisma.serviceDependency.deleteMany({
        where: { tenantId, OR: [{ fromServiceId: serviceId }, { toServiceId: serviceId }] },
      }),
      prisma.serviceInfraLink.deleteMany({ where: { tenantId, serviceId } }),
      prisma.scenarioService.deleteMany({ where: { tenantId, serviceId } }),
      prisma.backupStrategy.deleteMany({ where: { tenantId, serviceId } }),
      prisma.securityPolicyService.deleteMany({ where: { tenantId, serviceId } }),
      prisma.dependencyCycleService.deleteMany({ where: { tenantId, serviceId } }),
      prisma.serviceContinuity.deleteMany({ where: { serviceId } }),
      prisma.service.deleteMany({ where: { id: serviceId, tenantId } }),
    ]);

    return res.status(204).send();
  } catch (error) {
    console.error("Error in DELETE /services/:id:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /services
 * Crée un service avec ses critères de continuité.
 * Body attendu :
 * {
 *   name, type, description?, criticality,
 *   recoveryPriority?, domain?,
 *   rtoHours, rpoMinutes, mtpdHours, notes?
 * }
 */
router.post("/", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const name = parseRequiredString(payload.name, "name", issues);
    const type = parseRequiredString(payload.type, "type", issues);
    const criticalityRaw = parseRequiredString(
      payload.criticality,
      "criticality",
      issues
    );
    const criticality = criticalityRaw ? criticalityRaw.toLowerCase() : criticalityRaw;
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const businessPriority = parseOptionalString(
      payload.businessPriority,
      "businessPriority",
      issues,
      { allowNull: true }
    );
    const recoveryPriority = parseOptionalNumber(
      payload.recoveryPriority,
      "recoveryPriority",
      issues,
      { allowNull: true }
    );
    const domain = parseOptionalString(payload.domain, "domain", issues, {
      allowNull: true,
    });
    const rtoHours = parseRequiredNumber(payload.rtoHours, "rtoHours", issues);
    const rpoMinutes = parseRequiredNumber(payload.rpoMinutes, "rpoMinutes", issues);
    const mtpdHours = parseRequiredNumber(payload.mtpdHours, "mtpdHours", issues);
    const notes = parseOptionalString(payload.notes, "notes", issues, {
      allowNull: true,
    });

    if (criticality && !["low", "medium", "high"].includes(criticality)) {
      issues.push({
        field: "criticality",
        message: "doit être l'une des valeurs: low|medium|high",
      });
    }

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const service = await prisma.service.create({
      data: {
        tenantId,
        name,
        type,
        description,
        criticality,
        businessPriority,
        recoveryPriority,
        domain: domain ? domain.toUpperCase() : null,
        continuity: {
          create: {
            rtoHours,
            rpoMinutes,
            mtpdHours,
            notes,
            advisoryNotes: buildContinuityAdvisory(
              rtoHours,
              rpoMinutes,
              mtpdHours
            ),
          },
        },
      },
      include: {
        continuity: true,
        dependenciesFrom: true,
        dependenciesTo: true,
        infraLinks: {
          include: { infra: true },
        },
      },
    });

    return res.status(201).json(service);
  } catch (error) {
    console.error("Error in POST /services:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /services/:id/dependencies
 * Crée une dépendance entre deux services.
 * Body attendu :
 * {
 *   toServiceId: string,
 *   dependencyType: string
 * }
 */
router.post(
  "/:id/dependencies",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const fromServiceId = req.params.id;
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const toServiceId = parseRequiredString(payload.toServiceId, "toServiceId", issues);
    const dependencyType = parseRequiredString(
      payload.dependencyType,
      "dependencyType",
      issues
    );
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    // Vérifier que les deux services appartiennent bien au même tenant
    const [fromService, toService] = await Promise.all([
      prisma.service.findFirst({ where: { id: fromServiceId, tenantId } }),
      prisma.service.findFirst({ where: { id: toServiceId, tenantId } }),
    ]);

    if (!fromService || !toService) {
      return res
        .status(404)
        .json({ error: "Service source ou cible introuvable pour ce tenant" });
    }

    const dependency = await prisma.serviceDependency.create({
      data: {
        tenantId,
        fromServiceId,
        toServiceId,
        dependencyType,
      },
    });

    return res.status(201).json(dependency);
  } catch (error) {
    console.error("Error in POST /services/:id/dependencies:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /services/graph
 * Retourne une vue graphe (nodes + edges) pour le front.
 */
router.get("/graph", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const services = await prisma.service.findMany({
      where: { tenantId },
      include: {
        continuity: true,
        dependenciesFrom: {
          include: {
            toService: true,
          },
        },
      },
    });

    const nodes = services.map((s) => ({
      id: s.id,
      label: s.name,
      type: s.type,
      domain: s.domain,
      criticality: s.criticality,
      rtoHours: s.continuity?.rtoHours ?? null,
      rpoMinutes: s.continuity?.rpoMinutes ?? null,
      mtpdHours: s.continuity?.mtpdHours ?? null,
    }));

    const edges: { from: string; to: string; type: string }[] = [];
    for (const s of services) {
      for (const dep of s.dependenciesFrom) {
        if (!dep.toServiceId) continue;
        edges.push({
          from: s.id,
          to: dep.toServiceId,
          type: dep.dependencyType,
        });
      }
    }

    return res.json({ nodes, edges });
  } catch (error) {
    console.error("Error in GET /services/graph:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

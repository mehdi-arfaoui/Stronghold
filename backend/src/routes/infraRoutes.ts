import { Router } from "express";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import {
  buildValidationError,
  parseOptionalBoolean,
  parseOptionalEnum,
  parseOptionalString,
  parseRequiredString,
} from "../validation/common.js";

const router = Router();

// POST /infra/components : créer un composant d'infra (LZ)
router.post("/components", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const name = parseRequiredString(payload.name, "name", issues, { minLength: 2 });
    const type = parseRequiredString(payload.type, "type", issues);
    const provider = parseOptionalString(payload.provider, "provider", issues, {
      allowNull: true,
    });
    const location = parseOptionalString(payload.location, "location", issues, {
      allowNull: true,
    });
    const criticality = parseOptionalEnum(
      payload.criticality,
      "criticality",
      issues,
      ["low", "medium", "high"],
      { allowNull: true }
    );
    const isSingleAz = parseOptionalBoolean(payload.isSingleAz, "isSingleAz", issues);
    const notes = parseOptionalString(payload.notes, "notes", issues, {
      allowNull: true,
    });

    if (issues.length > 0 || !name || !type) {
      return res.status(400).json(buildValidationError(issues));
    }

    const infra = await prisma.infraComponent.create({
      data: {
        tenantId,
        name,
        type,
        provider: provider ?? null,
        location: location ?? null,
        criticality: criticality ?? null,
        isSingleAz: isSingleAz ?? false,
        notes: notes ?? null,
      },
    });

    return res.json(infra);
  } catch (error) {
    console.error("Error creating infra component:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /infra/components/:id : mettre à jour un composant d'infra
router.put("/components/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const infraId = req.params.id;
    if (!infraId) {
      return res.status(400).json({ error: "id est requis" });
    }
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const name =
      payload.name !== undefined
        ? parseRequiredString(payload.name, "name", issues, { minLength: 2 })
        : undefined;
    const type =
      payload.type !== undefined
        ? parseRequiredString(payload.type, "type", issues)
        : undefined;
    const provider = parseOptionalString(payload.provider, "provider", issues, {
      allowNull: true,
    });
    const location = parseOptionalString(payload.location, "location", issues, {
      allowNull: true,
    });
    const criticality = parseOptionalEnum(
      payload.criticality,
      "criticality",
      issues,
      ["low", "medium", "high"],
      { allowNull: true }
    );
    const isSingleAz = parseOptionalBoolean(payload.isSingleAz, "isSingleAz", issues);
    const notes = parseOptionalString(payload.notes, "notes", issues, {
      allowNull: true,
    });

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const infra = await prisma.infraComponent.findFirst({ where: { id: infraId, tenantId } });
    if (!infra) {
      return res.status(404).json({ error: "InfraComponent introuvable pour ce tenant" });
    }

    const data: any = {};

    if (name !== undefined) {
      data.name = name;
    }

    if (type !== undefined) {
      data.type = type;
    }

    if (provider !== undefined) {
      data.provider = provider ?? null;
    }

    if (location !== undefined) {
      data.location = location ?? null;
    }

    if (criticality !== undefined) {
      data.criticality = criticality ?? null;
    }

    if (isSingleAz !== undefined) {
      data.isSingleAz = Boolean(isSingleAz);
    }

    if (notes !== undefined) {
      data.notes = notes ?? null;
    }

    const updated = await prisma.infraComponent.update({
      where: { id: infraId },
      data,
    });

    return res.json(updated);
  } catch (error) {
    console.error("Error updating infra component:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});


router.get("/components", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const infra = await prisma.infraComponent.findMany({
      where: { tenantId },
      include: {
        services: {
          include: {
            service: true,
          },
        },
      },
    });

    return res.json(infra);
  } catch (error) {
    console.error("Error fetching infra components:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});



// POST /infra/link : lier un service à un composant d'infra
router.post("/link", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const serviceId = parseRequiredString(payload.serviceId, "serviceId", issues);
    const infraId = parseRequiredString(payload.infraId, "infraId", issues);
    if (issues.length > 0 || !serviceId || !infraId) {
      return res.status(400).json(buildValidationError(issues));
    }

    const [service, infra] = await Promise.all([
      prisma.service.findFirst({ where: { id: serviceId, tenantId } }),
      prisma.infraComponent.findFirst({ where: { id: infraId, tenantId } }),
    ]);

    if (!service || !infra) {
      return res.status(404).json({ error: "Service or InfraComponent not found for this tenant" });
    }

    const link = await prisma.serviceInfraLink.create({
      data: {
        tenantId,
        serviceId,
        infraId,
      },
    });

    return res.json(link);
  } catch (error) {
    console.error("Error linking service to infra:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /infra/components/:id : supprimer un composant d'infra
router.delete("/components/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const infraId = req.params.id;
    if (!infraId) {
      return res.status(400).json({ error: "id est requis" });
    }
    const infra = await prisma.infraComponent.findFirst({ where: { id: infraId, tenantId } });
    if (!infra) {
      return res.status(404).json({ error: "InfraComponent introuvable pour ce tenant" });
    }

    await prisma.$transaction([
      prisma.serviceInfraLink.deleteMany({ where: { tenantId, infraId } }),
      prisma.infraComponent.deleteMany({ where: { id: infraId, tenantId } }),
    ]);

    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting infra component:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});


export default router;

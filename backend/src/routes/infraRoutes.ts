import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";

const router = Router();

// POST /infra/components : créer un composant d'infra (LZ)
router.post("/components", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const {
      name,
      type,
      provider,
      location,
      criticality,
      isSingleAz,
      notes,
    } = req.body;

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res
        .status(400)
        .json({ error: "name is required and must be at least 2 characters" });
    }

    if (!type || typeof type !== "string") {
      return res.status(400).json({ error: "type is required" });
    }

    const allowedCrit = ["low", "medium", "high", "", null, undefined];
    const critNorm = criticality ? String(criticality).toLowerCase() : null;
    if (critNorm && !["low", "medium", "high"].includes(critNorm)) {
      return res.status(400).json({
        error: "criticality must be one of low|medium|high when provided",
      });
    }

    const infra = await prisma.infraComponent.create({
      data: {
        tenantId,
        name: name.trim(),
        type: type.trim(),
        provider: provider ? String(provider).trim() : null,
        location: location ? String(location).trim() : null,
        criticality: critNorm,
        isSingleAz: Boolean(isSingleAz),
        notes: notes ? String(notes).trim() : null,
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
    const {
      name,
      type,
      provider,
      location,
      criticality,
      isSingleAz,
      notes,
    } = req.body || {};

    const infra = await prisma.infraComponent.findFirst({ where: { id: infraId, tenantId } });
    if (!infra) {
      return res.status(404).json({ error: "InfraComponent introuvable pour ce tenant" });
    }

    const data: any = {};

    if (name !== undefined) {
      if (!name || typeof name !== "string" || name.trim().length < 2) {
        return res
          .status(400)
          .json({ error: "name is required and must be at least 2 characters" });
      }
      data.name = name.trim();
    }

    if (type !== undefined) {
      if (!type || typeof type !== "string") {
        return res.status(400).json({ error: "type is required" });
      }
      data.type = type.trim();
    }

    if (provider !== undefined) {
      data.provider = provider ? String(provider).trim() : null;
    }

    if (location !== undefined) {
      data.location = location ? String(location).trim() : null;
    }

    if (criticality !== undefined) {
      const critNorm = criticality ? String(criticality).toLowerCase() : null;
      if (critNorm && !["low", "medium", "high"].includes(critNorm)) {
        return res.status(400).json({
          error: "criticality must be one of low|medium|high when provided",
        });
      }
      data.criticality = critNorm;
    }

    if (isSingleAz !== undefined) {
      data.isSingleAz = Boolean(isSingleAz);
    }

    if (notes !== undefined) {
      data.notes = notes ? String(notes).trim() : null;
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

    const { serviceId, infraId } = req.body;

    if (!serviceId || !infraId) {
      return res.status(400).json({ error: "serviceId and infraId are required" });
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

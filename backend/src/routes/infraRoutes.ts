import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest } from "../middleware/tenantMiddleware";

const router = Router();

// POST /infra/components : créer un composant d'infra (LZ)
router.post("/components", async (req: TenantRequest, res) => {
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
router.post("/link", async (req: TenantRequest, res) => {
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


export default router;

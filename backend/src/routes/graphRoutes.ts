import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest } from "../middleware/tenantMiddleware";

const router = Router();

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
        dependenciesFrom: true,
        dependenciesTo: true,
      },
    });

    const nodes = services.map((s) => ({
      id: s.id,
      label: s.name,
      type: s.type,
      criticality: s.criticality,
      rtoHours: s.continuity?.rtoHours ?? null,
      rpoMinutes: s.continuity?.rpoMinutes ?? null,
      mtpdHours: s.continuity?.mtpdHours ?? null,
    }));

    const edges = services.flatMap((s) =>
      s.dependenciesFrom.map((d) => ({
        id: d.id,
        from: d.fromServiceId,
        to: d.toServiceId,
        type: d.dependencyType,
      }))
    );

    return res.json({ nodes, edges });
  } catch (error) {
    console.error("Error building graph:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});


export default router;

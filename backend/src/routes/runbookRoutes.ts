import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest } from "../middleware/tenantMiddleware";
import { generateRunbook } from "../services/runbookGenerator";

const router = Router();

router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const runbooks = await prisma.runbook.findMany({
      where: { tenantId },
      orderBy: { generatedAt: "desc" },
    });
    return res.json(runbooks);
  } catch (error) {
    console.error("Error fetching runbooks", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const runbook = await prisma.runbook.findFirst({ where: { id: req.params.id, tenantId } });
    if (!runbook) return res.status(404).json({ error: "Runbook introuvable" });

    return res.json(runbook);
  } catch (error) {
    console.error("Error fetching runbook", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/generate", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const { scenarioId, title, summary, owner } = req.body || {};
    if (scenarioId) {
      const scenario = await prisma.scenario.findFirst({ where: { id: scenarioId, tenantId } });
      if (!scenario) {
        return res.status(404).json({ error: "Scénario introuvable pour ce tenant" });
      }
    }

    const output = await generateRunbook(tenantId, { scenarioId, title, summary, owner });
    return res.status(201).json(output);
  } catch (error: any) {
    console.error("Error generating runbook", {
      message: error?.message,
    });
    return res.status(500).json({ error: "Internal server error", details: error?.message });
  }
});

export default router;

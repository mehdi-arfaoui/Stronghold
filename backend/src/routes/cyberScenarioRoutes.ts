import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { getCyberScenarioDetails, listCyberScenarioLibrary } from "../services/cyberScenarioService.js";

const router = Router();

router.get("/", requireRole("READER"), async (_req: TenantRequest, res) => {
  const scenarios = listCyberScenarioLibrary();
  return res.json(scenarios);
});

router.get("/:id", requireRole("READER"), async (req: TenantRequest, res) => {
  const scenarioId = req.params.id;
  if (!scenarioId) {
    return res.status(400).json({ error: "id est requis" });
  }
  const scenario = getCyberScenarioDetails(scenarioId);
  if (!scenario) {
    return res.status(404).json({ error: "Scénario cyber introuvable" });
  }
  return res.json(scenario);
});

export default router;

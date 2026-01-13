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
  const scenario = getCyberScenarioDetails(req.params.id);
  if (!scenario) {
    return res.status(404).json({ error: "Scénario cyber introuvable" });
  }
  return res.json(scenario);
});

export default router;

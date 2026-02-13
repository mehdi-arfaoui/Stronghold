import { appLogger } from "../utils/logger.js";
import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { listScenarioCatalog, syncScenarioCatalog } from "../services/scenarioCatalogService.js";

const router = Router();

/**
 * GET /scenario-catalog
 * Liste le catalogue de scénarios disponibles pour le tenant.
 */
router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const catalog = await listScenarioCatalog(tenantId);
    return res.json(catalog);
  } catch (error) {
    appLogger.error("Error fetching scenario catalog:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /scenario-catalog/sync
 * Synchronise la bibliothèque depuis la source interne.
 */
router.post("/sync", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const result = await syncScenarioCatalog(tenantId);
    return res.status(200).json(result);
  } catch (error) {
    appLogger.error("Error syncing scenario catalog:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

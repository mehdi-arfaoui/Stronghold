import { Router } from "express";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import {
  ComplianceService,
  UnknownComplianceFrameworkError,
} from "../services/compliance/complianceService.js";
import { appLogger } from "../utils/logger.js";

const router = Router();
const complianceService = new ComplianceService(prisma);

router.get("/:framework", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const framework = String(req.params.framework || "").trim().toLowerCase();
    if (!framework) {
      return res.status(400).json({ error: "framework parameter is required" });
    }

    const report = await complianceService.evaluate(framework, tenantId);
    return res.json(report);
  } catch (error) {
    if (error instanceof UnknownComplianceFrameworkError) {
      return res.status(404).json({
        error: "Unsupported compliance framework",
        framework: error.frameworkId,
        supportedFrameworks: complianceService.listSupportedFrameworks(),
      });
    }

    appLogger.error("Error in GET /compliance/:framework", {
      framework: req.params.framework,
      tenantId: req.tenantId,
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

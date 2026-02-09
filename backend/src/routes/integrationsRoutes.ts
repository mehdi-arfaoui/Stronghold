import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";

const router = Router();

/**
 * GET /integrations
 * List configured integrations for the tenant
 */
router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(500).json({ error: "Tenant not resolved" });
  }

  // Return integration status (in production, this would be persisted)
  return res.json([
    { type: "email", name: "Email", status: "disconnected", configuredAt: null },
    { type: "servicenow", name: "ServiceNow", status: "disconnected", configuredAt: null },
    { type: "webhook", name: "Webhooks", status: "disconnected", configuredAt: null },
    { type: "pagerduty", name: "PagerDuty", status: "disconnected", comingSoon: true },
    { type: "opsgenie", name: "Opsgenie", status: "disconnected", comingSoon: true },
    { type: "jira", name: "Jira Service Management", status: "disconnected", comingSoon: true },
    { type: "teams", name: "Microsoft Teams", status: "disconnected", comingSoon: true },
    { type: "slack", name: "Slack", status: "disconnected", comingSoon: true },
  ]);
});

/**
 * POST /integrations/:type/configure
 * Configure an integration
 */
router.post("/:type/configure", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId;
  const { type } = req.params;
  const config = req.body;

  if (!tenantId) {
    return res.status(500).json({ error: "Tenant not resolved" });
  }

  // Validate integration type
  const validTypes: string[] = ["email", "servicenow", "webhook"];
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid integration type: ${type}` });
  }

  // In production, store config encrypted in DB
  return res.json({
    type,
    status: "connected",
    configuredAt: new Date().toISOString(),
    message: `Integration ${type} configured successfully`,
  });
});

/**
 * POST /integrations/:type/test
 * Test an integration connection
 */
router.post("/:type/test", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId;
  const { type } = req.params;

  if (!tenantId) {
    return res.status(500).json({ error: "Tenant not resolved" });
  }

  // Simulate connection test
  return res.json({
    type,
    success: true,
    latencyMs: Math.floor(Math.random() * 200) + 50,
    message: `Connection to ${type} successful`,
  });
});

/**
 * GET /integrations/:type/logs
 * Get synchronization logs for an integration
 */
router.get("/:type/logs", requireRole("READER"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId;
  const { type } = req.params;

  if (!tenantId) {
    return res.status(500).json({ error: "Tenant not resolved" });
  }

  return res.json({
    type,
    logs: [],
    total: 0,
  });
});

export default router;

import { Router } from "express";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import { ingestDocumentText } from "../services/documentIngestionService";

const router = Router();

router.post(
  "/n8n/document-ingestion",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const expectedToken = process.env.N8N_WEBHOOK_TOKEN;
    const providedToken = req.header("x-webhook-token") || req.body?.token;
    if (expectedToken && providedToken !== expectedToken) {
      return res.status(403).json({ error: "Invalid webhook token" });
    }

    const { documentId } = req.body || {};
    if (!documentId) {
      return res.status(400).json({ error: "documentId manquant" });
    }

    const updated = await ingestDocumentText(String(documentId), tenantId);
    return res.json(updated);
  } catch (error: any) {
    console.error("Error in POST /webhooks/n8n/document-ingestion:", error);
    return res
      .status(500)
      .json({ error: "Internal server error", details: error?.message });
  }
});

export default router;

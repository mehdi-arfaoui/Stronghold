import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { ingestDocumentText } from "../services/documentIngestionService.js";

const router = Router();

router.get("/catalog", requireRole("READER"), async (req: TenantRequest, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(500).json({ error: "Tenant not resolved" });
  }

  return res.json({
    tenantId,
    events: [
      {
        key: "incident.created",
        description: "Déclenché lors de la création d'un incident.",
        payloadExample: {
          event: "incident.created",
          tenantId,
          incident: {
            id: "inc_123",
            title: "Perte d'une AZ",
            status: "OPEN",
          },
          changeSummary: ["Incident créé"],
        },
      },
      {
        key: "incident.updated",
        description: "Déclenché lors d'une mise à jour d'incident.",
        payloadExample: {
          event: "incident.updated",
          tenantId,
          incident: {
            id: "inc_123",
            title: "Perte d'une AZ",
            status: "IN_PROGRESS",
          },
          changeSummary: ["Statut: OPEN → IN_PROGRESS"],
        },
      },
    ],
    delivery: {
      headers: ["Content-Type: application/json"],
      authentication: "Webhook URL protégée par vos mécanismes (secret/token).",
    },
    notes: [
      "Utilisez les canaux de notification pour intégrer SIEM, ticketing ou chatops.",
      "Personnalisez les payloads via l'objet configuration des canaux.",
    ],
  });
});

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

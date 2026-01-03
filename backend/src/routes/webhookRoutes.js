"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const documentIngestionService_1 = require("../services/documentIngestionService");
const router = (0, express_1.Router)();
router.post("/n8n/document-ingestion", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
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
        const updated = await (0, documentIngestionService_1.ingestDocumentText)(String(documentId), tenantId);
        return res.json(updated);
    }
    catch (error) {
        console.error("Error in POST /webhooks/n8n/document-ingestion:", error);
        return res
            .status(500)
            .json({ error: "Internal server error", details: error?.message });
    }
});
exports.default = router;
//# sourceMappingURL=webhookRoutes.js.map
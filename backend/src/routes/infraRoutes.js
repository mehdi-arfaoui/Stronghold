"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const router = (0, express_1.Router)();
// POST /infra/components : créer un composant d'infra (LZ)
router.post("/components", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { name, type, provider, location, criticality, isSingleAz, notes, } = req.body;
        if (!name || typeof name !== "string" || name.trim().length < 2) {
            return res
                .status(400)
                .json({ error: "name is required and must be at least 2 characters" });
        }
        if (!type || typeof type !== "string") {
            return res.status(400).json({ error: "type is required" });
        }
        const allowedCrit = ["low", "medium", "high", "", null, undefined];
        const critNorm = criticality ? String(criticality).toLowerCase() : null;
        if (critNorm && !["low", "medium", "high"].includes(critNorm)) {
            return res.status(400).json({
                error: "criticality must be one of low|medium|high when provided",
            });
        }
        const infra = await prismaClient_1.default.infraComponent.create({
            data: {
                tenantId,
                name: name.trim(),
                type: type.trim(),
                provider: provider ? String(provider).trim() : null,
                location: location ? String(location).trim() : null,
                criticality: critNorm,
                isSingleAz: Boolean(isSingleAz),
                notes: notes ? String(notes).trim() : null,
            },
        });
        return res.json(infra);
    }
    catch (error) {
        console.error("Error creating infra component:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/components", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const infra = await prismaClient_1.default.infraComponent.findMany({
            where: { tenantId },
            include: {
                services: {
                    include: {
                        service: true,
                    },
                },
            },
        });
        return res.json(infra);
    }
    catch (error) {
        console.error("Error fetching infra components:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
// POST /infra/link : lier un service à un composant d'infra
router.post("/link", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { serviceId, infraId } = req.body;
        if (!serviceId || !infraId) {
            return res.status(400).json({ error: "serviceId and infraId are required" });
        }
        const [service, infra] = await Promise.all([
            prismaClient_1.default.service.findFirst({ where: { id: serviceId, tenantId } }),
            prismaClient_1.default.infraComponent.findFirst({ where: { id: infraId, tenantId } }),
        ]);
        if (!service || !infra) {
            return res.status(404).json({ error: "Service or InfraComponent not found for this tenant" });
        }
        const link = await prismaClient_1.default.serviceInfraLink.create({
            data: {
                tenantId,
                serviceId,
                infraId,
            },
        });
        return res.json(link);
    }
    catch (error) {
        console.error("Error linking service to infra:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
//# sourceMappingURL=infraRoutes.js.map
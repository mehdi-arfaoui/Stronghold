"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const router = (0, express_1.Router)();
const BACKUP_TYPES = [
    "full",
    "differential",
    "incremental",
    "continuous",
    "snapshot",
];
router.post("/backup-strategies", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { serviceId, type, frequencyMinutes, retentionDays, storageLocation, encryptionLevel, compression, immutability, rtoImpactHours, rpoImpactMinutes, notes, } = req.body || {};
        if (!type || !BACKUP_TYPES.includes(String(type).toLowerCase())) {
            return res.status(400).json({
                error: `type doit être parmi ${BACKUP_TYPES.join(", ")}`,
            });
        }
        if (!frequencyMinutes || !retentionDays) {
            return res
                .status(400)
                .json({ error: "frequencyMinutes et retentionDays sont requis" });
        }
        if (serviceId) {
            const service = await prismaClient_1.default.service.findFirst({ where: { id: serviceId, tenantId } });
            if (!service) {
                return res.status(404).json({ error: "Service introuvable pour ce tenant" });
            }
        }
        const strategy = await prismaClient_1.default.backupStrategy.create({
            data: {
                tenantId,
                serviceId: serviceId || null,
                type: String(type).toLowerCase(),
                frequencyMinutes: Number(frequencyMinutes),
                retentionDays: Number(retentionDays),
                storageLocation: storageLocation ? String(storageLocation) : null,
                encryptionLevel: encryptionLevel ? String(encryptionLevel) : null,
                compression: Boolean(compression),
                immutability: Boolean(immutability),
                rtoImpactHours: rtoImpactHours != null ? Number(rtoImpactHours) : null,
                rpoImpactMinutes: rpoImpactMinutes != null ? Number(rpoImpactMinutes) : null,
                notes: notes ? String(notes) : null,
            },
        });
        return res.status(201).json(strategy);
    }
    catch (error) {
        console.error("Error creating backup strategy", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/backup-strategies", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { serviceId } = req.query;
        const filters = { tenantId };
        if (serviceId)
            filters.serviceId = String(serviceId);
        const strategies = await prismaClient_1.default.backupStrategy.findMany({
            where: filters,
            include: {
                service: true,
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(strategies);
    }
    catch (error) {
        console.error("Error fetching backup strategies", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/security-policies", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { name, policyType, classification, scope, controls, reviewFrequencyDays, owner, serviceIds } = req.body || {};
        if (!name || !policyType) {
            return res.status(400).json({ error: "name et policyType sont requis" });
        }
        const validatedServices = [];
        if (Array.isArray(serviceIds)) {
            const services = await prismaClient_1.default.service.findMany({
                where: { tenantId, id: { in: serviceIds } },
                select: { id: true },
            });
            validatedServices.push(...services.map((s) => s.id));
            if (validatedServices.length !== serviceIds.length) {
                return res.status(400).json({ error: "Certaines références de services sont invalides" });
            }
        }
        const policy = await prismaClient_1.default.securityPolicy.create({
            data: {
                tenantId,
                name: String(name).trim(),
                policyType: String(policyType).trim(),
                classification: classification ? String(classification) : null,
                scope: scope ? String(scope) : null,
                controls: controls ? String(controls) : null,
                reviewFrequencyDays: reviewFrequencyDays ? Number(reviewFrequencyDays) : null,
                owner: owner ? String(owner) : null,
                services: {
                    create: validatedServices.map((id) => ({ tenantId, serviceId: id })),
                },
            },
            include: { services: true },
        });
        return res.status(201).json(policy);
    }
    catch (error) {
        console.error("Error creating security policy", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/security-policies", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const policies = await prismaClient_1.default.securityPolicy.findMany({
            where: { tenantId },
            include: {
                services: {
                    include: { service: true },
                },
            },
            orderBy: { updatedAt: "desc" },
        });
        return res.json(policies);
    }
    catch (error) {
        console.error("Error fetching security policies", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/dependency-cycles", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { label, severity, notes, services } = req.body || {};
        if (!label || !Array.isArray(services) || services.length < 2) {
            return res.status(400).json({
                error: "label est requis et au moins 2 services doivent être fournis",
            });
        }
        const serviceIds = services.map((s) => s.serviceId).filter(Boolean);
        const existing = await prismaClient_1.default.service.findMany({
            where: { tenantId, id: { in: serviceIds } },
            select: { id: true },
        });
        if (existing.length !== serviceIds.length) {
            return res.status(400).json({ error: "Certaines références de services sont invalides" });
        }
        const cycle = await prismaClient_1.default.dependencyCycle.create({
            data: {
                tenantId,
                label: String(label).trim(),
                severity: severity ? String(severity) : null,
                notes: notes ? String(notes) : null,
                services: {
                    create: services.map((s) => ({
                        tenantId,
                        serviceId: s.serviceId,
                        roleInCycle: s.roleInCycle ? String(s.roleInCycle) : null,
                    })),
                },
            },
            include: {
                services: {
                    include: {
                        service: true,
                    },
                },
            },
        });
        return res.status(201).json(cycle);
    }
    catch (error) {
        console.error("Error creating dependency cycle", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/dependency-cycles", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const cycles = await prismaClient_1.default.dependencyCycle.findMany({
            where: { tenantId },
            include: {
                services: {
                    include: {
                        service: true,
                    },
                },
            },
            orderBy: { updatedAt: "desc" },
        });
        return res.json(cycles);
    }
    catch (error) {
        console.error("Error fetching dependency cycles", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
//# sourceMappingURL=continuityRoutes.js.map
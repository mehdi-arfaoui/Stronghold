"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const router = (0, express_1.Router)();
function buildContinuityAdvisory(rtoHours, rpoMinutes, mtpdHours) {
    const parts = [];
    parts.push("RTO (Recovery Time Objective) = durée maximale d'interruption acceptée avant reprise du service (référence f5.com).");
    parts.push("RPO (Recovery Point Objective) = perte de données maximale acceptable exprimée en minutes ou heures (référence tierpoint.com).");
    parts.push("MTPD (Maximum Tolerable Period of Disruption) = durée totale au-delà de laquelle l'impact devient inacceptable (référence riskythinking.com).");
    parts.push(`Ce service vise RTO=${rtoHours}h, RPO=${rpoMinutes} min, MTPD=${mtpdHours}h. Vérifier que les dépendances et backups respectent ces bornes.`);
    return parts.join(" \n");
}
/**
 * GET /services
 * Retourne la liste des services du tenant courant,
 * avec continuité, dépendances et liens infra.
 */
router.get("/", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const services = await prismaClient_1.default.service.findMany({
            where: { tenantId },
            include: {
                continuity: true,
                dependenciesFrom: {
                    include: {
                        toService: true,
                    },
                },
                dependenciesTo: {
                    include: {
                        fromService: true,
                    },
                },
                infraLinks: {
                    include: {
                        infra: true,
                    },
                },
                backupStrategies: true,
                policyLinks: {
                    include: {
                        policy: true,
                    },
                },
                dependencyCycles: {
                    include: {
                        cycle: true,
                    },
                },
            },
            orderBy: {
                name: "asc",
            },
        });
        return res.json(services);
    }
    catch (error) {
        console.error("Error in GET /services:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/**
 * POST /services
 * Crée un service avec ses critères de continuité.
 * Body attendu :
 * {
 *   name, type, description?, criticality,
 *   recoveryPriority?, domain?,
 *   rtoHours, rpoMinutes, mtpdHours, notes?
 * }
 */
router.post("/", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { name, type, description, criticality, businessPriority, recoveryPriority, domain, rtoHours, rpoMinutes, mtpdHours, notes, } = req.body || {};
        // Champs obligatoires minimum pour créer un service
        if (!name || !type || !criticality) {
            return res.status(400).json({
                error: "name, type et criticality sont obligatoires pour créer un service",
            });
        }
        if (rtoHours == null ||
            rpoMinutes == null ||
            mtpdHours == null ||
            isNaN(Number(rtoHours)) ||
            isNaN(Number(rpoMinutes)) ||
            isNaN(Number(mtpdHours))) {
            return res.status(400).json({
                error: "rtoHours, rpoMinutes et mtpdHours doivent être renseignés",
            });
        }
        const service = await prismaClient_1.default.service.create({
            data: {
                tenantId,
                name: String(name).trim(),
                type: String(type).trim(),
                description: description ? String(description).trim() : null,
                criticality: String(criticality).toLowerCase(),
                businessPriority: businessPriority
                    ? String(businessPriority).trim()
                    : null,
                recoveryPriority: recoveryPriority != null ? Number(recoveryPriority) : null,
                domain: domain ? String(domain).toUpperCase() : null,
                continuity: {
                    create: {
                        rtoHours: Number(rtoHours),
                        rpoMinutes: Number(rpoMinutes),
                        mtpdHours: Number(mtpdHours),
                        notes: notes ? String(notes).trim() : null,
                        advisoryNotes: buildContinuityAdvisory(Number(rtoHours), Number(rpoMinutes), Number(mtpdHours)),
                    },
                },
            },
            include: {
                continuity: true,
                dependenciesFrom: true,
                dependenciesTo: true,
                infraLinks: {
                    include: { infra: true },
                },
            },
        });
        return res.status(201).json(service);
    }
    catch (error) {
        console.error("Error in POST /services:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/**
 * POST /services/:id/dependencies
 * Crée une dépendance entre deux services.
 * Body attendu :
 * {
 *   toServiceId: string,
 *   dependencyType: string
 * }
 */
router.post("/:id/dependencies", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const fromServiceId = req.params.id;
        const { toServiceId, dependencyType } = req.body || {};
        if (!toServiceId || !dependencyType) {
            return res.status(400).json({
                error: "toServiceId et dependencyType sont obligatoires",
            });
        }
        // Vérifier que les deux services appartiennent bien au même tenant
        const [fromService, toService] = await Promise.all([
            prismaClient_1.default.service.findFirst({ where: { id: fromServiceId, tenantId } }),
            prismaClient_1.default.service.findFirst({ where: { id: toServiceId, tenantId } }),
        ]);
        if (!fromService || !toService) {
            return res
                .status(404)
                .json({ error: "Service source ou cible introuvable pour ce tenant" });
        }
        const dependency = await prismaClient_1.default.serviceDependency.create({
            data: {
                tenantId,
                fromServiceId,
                toServiceId,
                dependencyType: String(dependencyType).trim(),
            },
        });
        return res.status(201).json(dependency);
    }
    catch (error) {
        console.error("Error in POST /services/:id/dependencies:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/**
 * GET /services/graph
 * Retourne une vue graphe (nodes + edges) pour le front.
 */
router.get("/graph", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const services = await prismaClient_1.default.service.findMany({
            where: { tenantId },
            include: {
                continuity: true,
                dependenciesFrom: {
                    include: {
                        toService: true,
                    },
                },
            },
        });
        const nodes = services.map((s) => ({
            id: s.id,
            label: s.name,
            type: s.type,
            domain: s.domain,
            criticality: s.criticality,
            rtoHours: s.continuity?.rtoHours ?? null,
            rpoMinutes: s.continuity?.rpoMinutes ?? null,
            mtpdHours: s.continuity?.mtpdHours ?? null,
        }));
        const edges = [];
        for (const s of services) {
            for (const dep of s.dependenciesFrom) {
                if (!dep.toServiceId)
                    continue;
                edges.push({
                    from: s.id,
                    to: dep.toServiceId,
                    type: dep.dependencyType,
                });
            }
        }
        return res.json({ nodes, edges });
    }
    catch (error) {
        console.error("Error in GET /services/graph:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
//# sourceMappingURL=serviceRoutes.js.map
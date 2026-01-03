"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const criticalityScore = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};
function normalizeCriticality(value) {
    const normalized = (value || "").toLowerCase();
    if (normalized === "critical")
        return "critical";
    if (normalized === "high")
        return "high";
    if (normalized === "medium")
        return "medium";
    return "low";
}
function resolveCategory(domain, type) {
    const normalizedDomain = (domain || "").toUpperCase();
    const normalizedType = (type || "").toUpperCase();
    if (normalizedDomain.includes("NETWORK") || normalizedType.includes("NETWORK")) {
        return "Network";
    }
    if (normalizedDomain.includes("SECURITY") || normalizedDomain.includes("GOV")) {
        return "Foundation";
    }
    if (normalizedDomain.includes("DATA") || normalizedDomain.includes("DB")) {
        return "Platform";
    }
    if (normalizedDomain.includes("IAC") || normalizedDomain.includes("PLATFORM")) {
        return "Platform";
    }
    if (normalizedDomain.includes("APP")) {
        return "Application";
    }
    return "Application";
}
function resolveNodeKind(type) {
    const normalizedType = (type || "").toLowerCase();
    if (normalizedType.includes("app"))
        return "application";
    return "service";
}
const router = (0, express_1.Router)();
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
                dependenciesFrom: true,
                dependenciesTo: true,
            },
        });
        const nodes = services.map((s) => {
            const category = resolveCategory(s.domain, s.type);
            const crit = normalizeCriticality(s.criticality);
            return {
                id: s.id,
                label: s.name,
                type: s.type,
                nodeKind: resolveNodeKind(s.type),
                category,
                criticality: crit,
                businessPriority: s.businessPriority,
                domain: s.domain,
                isLandingZone: category === "Foundation" || category === "Network" || category === "Platform",
                rtoHours: s.continuity?.rtoHours ?? null,
                rpoMinutes: s.continuity?.rpoMinutes ?? null,
                mtpdHours: s.continuity?.mtpdHours ?? null,
                dependsOnCount: s.dependenciesFrom.length,
                usedByCount: s.dependenciesTo.length,
            };
        });
        const edges = services.flatMap((s) => s.dependenciesFrom.map((d) => ({
            id: d.id,
            from: d.fromServiceId,
            to: d.toServiceId,
            type: d.dependencyType,
            strength: (d.dependencyType || "").toLowerCase().includes("fort") ? "strong" : "normal",
        })));
        const categorySummary = nodes.reduce((acc, node) => {
            const current = acc[node.category] || { count: 0, scoreSum: 0 };
            current.count += 1;
            current.scoreSum += criticalityScore[node.criticality] || 1;
            acc[node.category] = current;
            return acc;
        }, {});
        const nodeById = nodes.reduce((acc, node) => {
            acc[node.id] = node;
            return acc;
        }, {});
        const categoryLinks = edges.reduce((acc, edge) => {
            const sourceCategory = nodeById[edge.from]?.category;
            const targetCategory = nodeById[edge.to]?.category;
            if (!sourceCategory || !targetCategory)
                return acc;
            const key = `${sourceCategory}::${targetCategory}`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const categoryBubbles = Object.entries(categorySummary).map(([category, stats]) => {
            const dependencyTargets = Object.entries(categoryLinks)
                .filter(([key]) => key.startsWith(`${category}::`))
                .map(([key, count]) => ({
                target: key.split("::")[1],
                count,
            }));
            const averageScore = stats.scoreSum / Math.max(1, stats.count);
            const normalizedAverage = averageScore >= 3.5 ? "critical" : averageScore >= 2.5 ? "high" : averageScore >= 1.5 ? "medium" : "low";
            return {
                category,
                serviceCount: stats.count,
                averageCriticality: normalizedAverage,
                dependencies: dependencyTargets,
            };
        });
        return res.json({
            nodes,
            edges,
            views: {
                categories: categoryBubbles,
            },
        });
    }
    catch (error) {
        console.error("Error building graph:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
//# sourceMappingURL=graphRoutes.js.map
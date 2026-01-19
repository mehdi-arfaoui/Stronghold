"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const praRecommender_1 = require("../analysis/praRecommender");
const drStrategyEngine_1 = require("../analysis/drStrategyEngine");
const dependencyRiskEngine_1 = require("../analysis/dependencyRiskEngine");
const extractedFactService_1 = require("../services/extractedFactService");
const extractedFactSchema_1 = require("../ai/extractedFactSchema");
const ragService_1 = require("../ai/ragService");
const ragExperimentService_1 = require("../services/ragExperimentService");
const userFeedbackService_1 = require("../services/userFeedbackService");
const router = (0, express_1.Router)();
const CLASSIFICATION_CATEGORY_OPTIONS = extractedFactSchema_1.EXTRACTED_FACT_CATEGORIES.map((category) => category.toLowerCase());
function addIssue(issues, field, message) {
    issues.push({ field, message });
}
function parseRequiredString(value, field, issues) {
    if (value === null || value === undefined) {
        addIssue(issues, field, "champ requis");
        return undefined;
    }
    if (typeof value !== "string") {
        addIssue(issues, field, "doit être une chaîne de caractères");
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        addIssue(issues, field, "ne doit pas être vide");
        return undefined;
    }
    return trimmed;
}
function parseOptionalString(value, field, issues, allowNull = false) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        if (allowNull) {
            return null;
        }
        addIssue(issues, field, "ne peut pas être null");
        return undefined;
    }
    if (typeof value !== "string") {
        addIssue(issues, field, "doit être une chaîne de caractères");
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return allowNull ? null : undefined;
    }
    return trimmed;
}
function parseOptionalNumber(value, field, issues) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        addIssue(issues, field, "doit être un nombre");
        return undefined;
    }
    return parsed;
}
function parseOptionalCategory(value, field, issues) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        addIssue(issues, field, "ne peut pas être vide");
        return undefined;
    }
    const normalized = String(value).toLowerCase();
    if (!CLASSIFICATION_CATEGORY_OPTIONS.includes(normalized)) {
        addIssue(issues, field, `doit être l'une des valeurs: ${CLASSIFICATION_CATEGORY_OPTIONS.join("|")}`);
        return undefined;
    }
    return normalized.toUpperCase();
}
function parseFeedbackPayload(body) {
    const issues = [];
    const factId = parseRequiredString(body?.factId, "factId", issues);
    const category = parseOptionalCategory(body?.category, "category", issues);
    const type = parseOptionalString(body?.type, "type", issues);
    const label = parseOptionalString(body?.label, "label", issues);
    const service = parseOptionalString(body?.service, "service", issues, true);
    const infra = parseOptionalString(body?.infra, "infra", issues, true);
    const sla = parseOptionalString(body?.sla, "sla", issues, true);
    if (!category &&
        !type &&
        !label &&
        service === undefined &&
        infra === undefined &&
        sla === undefined) {
        addIssue(issues, "payload", "au moins un champ de correction doit être fourni");
    }
    if (issues.length > 0) {
        return { issues };
    }
    return {
        payload: {
            factId: factId,
            category,
            type,
            label,
            service,
            infra,
            sla,
        },
        issues,
    };
}
/* ========= Helpers d'analyse applicative ========= */
// Analyse basique de cohérence RTO/RPO/criticité
function buildAppContinuityWarnings(services) {
    const warnings = [];
    for (const service of services) {
        const sName = service.name;
        const sCrit = service.criticality;
        const sRto = service.continuity?.rtoHours ?? null;
        const sRpo = service.continuity?.rpoMinutes ?? null;
        for (const dep of service.dependenciesFrom) {
            const target = dep.toService;
            if (!target)
                continue;
            const tName = target.name;
            const tRto = target.continuity?.rtoHours ?? null;
            const tRpo = target.continuity?.rpoMinutes ?? null;
            if (sRto != null && tRto != null && sRto < tRto) {
                warnings.push({
                    type: "RTO_INCONSISTENCY",
                    service: sName,
                    dependsOn: tName,
                    details: {
                        serviceRto: sRto,
                        dependsOnRto: tRto,
                    },
                    message: `RTO du service ${sName} (${sRto}h) est inférieur à celui de ${tName} (${tRto}h).`,
                });
            }
            if (sRpo != null && tRpo != null && sRpo < tRpo) {
                warnings.push({
                    type: "RPO_INCONSISTENCY",
                    service: sName,
                    dependsOn: tName,
                    details: {
                        serviceRpo: sRpo,
                        dependsOnRpo: tRpo,
                    },
                    message: `RPO du service ${sName} (${sRpo} min) est inférieur à celui de ${tName} (${tRpo} min).`,
                });
            }
        }
        if (sCrit === "high" && sRto != null && sRto > 24) {
            warnings.push({
                type: "HIGH_CRITICALITY_LONG_RTO",
                service: sName,
                dependsOn: null,
                details: { serviceRto: sRto, criticality: sCrit },
                message: `Le service ${sName} est de criticité HIGH mais a un RTO de ${sRto}h.`,
            });
        }
    }
    return warnings;
}
/* ========= Helpers d'analyse infra ========= */
function buildInfraFindings(infraList) {
    const findings = [];
    for (const infra of infraList) {
        const compName = infra.name;
        const compType = infra.type;
        const location = infra.location;
        const servicesCount = infra.services?.length ?? 0;
        const highCritCount = infra.services?.filter((link) => link.service?.criticality === "high")
            .length ?? 0;
        findings.push({
            type: "INFRA_SUMMARY",
            infra: compName,
            infraType: compType,
            location,
            details: {
                totalServices: servicesCount,
                highCritCount,
            },
            message: `Le composant ${compName} (${compType}) héberge ${servicesCount} services dont ${highCritCount} à criticité HIGH.`,
        });
        if (infra.isSingleAz && highCritCount > 0) {
            findings.push({
                type: "SINGLE_AZ_HIGH_CRIT",
                infra: compName,
                infraType: compType,
                location,
                details: {
                    highCritServices: highCritCount,
                },
                message: `Le composant ${compName} est en single-AZ et héberge ${highCritCount} service(s) HIGH : risque de SPOF.`,
            });
        }
    }
    return findings;
}
function normalizeCrit(value) {
    const v = (value || "").toLowerCase();
    if (v === "critical")
        return "critical";
    if (v === "high")
        return "high";
    if (v === "medium")
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
router.get("/pra-dashboard", (0, tenantMiddleware_1.requireRole)("READER"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const [services, infra] = await Promise.all([
            prismaClient_1.default.service.findMany({
                where: { tenantId },
                include: {
                    continuity: true,
                    dependenciesFrom: {
                        include: { toService: { include: { continuity: true } } },
                    },
                    dependenciesTo: true,
                },
            }),
            prismaClient_1.default.infraComponent.findMany({
                where: { tenantId },
                include: { services: { include: { service: true } } },
            }),
        ]);
        const warnings = buildAppContinuityWarnings(services);
        const infraFindings = buildInfraFindings(infra);
        const drServices = services.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            domain: s.domain,
            criticality: s.criticality,
            rtoHours: s.continuity?.rtoHours ?? undefined,
            rpoMinutes: s.continuity?.rpoMinutes ?? undefined,
        }));
        const dependencies = services.flatMap((s) => s.dependenciesFrom.map((d) => ({
            from: d.fromServiceId,
            to: d.toServiceId,
            type: d.dependencyType,
        })));
        const globalCriticality = (() => {
            const critical = services.some((s) => normalizeCrit(s.criticality) === "critical");
            if (critical)
                return "critical";
            const high = services.some((s) => normalizeCrit(s.criticality) === "high");
            if (high)
                return "high";
            return "medium";
        })();
        const targetRtoHours = services
            .map((s) => s.continuity?.rtoHours)
            .filter((v) => v != null)
            .sort((a, b) => a - b)[0] ?? (globalCriticality === "critical" ? 2 : 8);
        const targetRpoMinutes = services
            .map((s) => s.continuity?.rpoMinutes)
            .filter((v) => v != null)
            .sort((a, b) => a - b)[0] ?? (globalCriticality === "critical" ? 15 : 120);
        const drRecommendations = (0, drStrategyEngine_1.getSuggestedDRStrategy)(drServices, dependencies, targetRtoHours, targetRpoMinutes, globalCriticality);
        const scenarioComparison = drRecommendations.map((rec) => (0, drStrategyEngine_1.summarizeScenarioForTable)(rec));
        const categories = services.reduce((acc, s) => {
            const category = resolveCategory(s.domain, s.type);
            const crit = normalizeCrit(s.criticality);
            if (!acc[category])
                acc[category] = { count: 0, scoreSum: 0 };
            acc[category].count += 1;
            acc[category].scoreSum += crit === "critical" ? 4 : crit === "high" ? 3 : crit === "medium" ? 2 : 1;
            return acc;
        }, {});
        const categoryView = Object.entries(categories).map(([category, stats]) => {
            const average = stats.scoreSum / Math.max(1, stats.count);
            const normalizedAverage = average >= 3.5 ? "critical" : average >= 2.5 ? "high" : average >= 1.5 ? "medium" : "low";
            return { category, count: stats.count, averageCriticality: normalizedAverage };
        });
        const ragQuestion = req.query?.question && typeof req.query.question === "string"
            ? req.query.question
            : `Recommandations PRA pour ${tenantId}`;
        const ragReport = await (0, ragService_1.generatePraReport)({
            tenantId,
            question: ragQuestion,
            documentTypes: Array.isArray(req.query?.docTypes) ? req.query.docTypes : undefined,
            serviceFilter: typeof req.query?.service === "string" ? req.query.service : null,
            maxChunks: 6,
            maxFacts: 8,
        });
        return res.json({
            meta: { tenantId, targetRtoHours, targetRpoMinutes, globalCriticality },
            warnings,
            infraFindings,
            dr: {
                recommendations: drRecommendations,
                comparison: scenarioComparison,
            },
            categories: categoryView,
            rag: ragReport,
        });
    }
    catch (error) {
        console.error("Error in /analysis/pra-dashboard:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/* ========= Service RAG simple ========= */
router.post("/rag-query", (0, tenantMiddleware_1.requireRole)("READER"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { question, documentIds, documentTypes, serviceFilter, maxChunks, maxFacts } = req.body || {};
        if (!question || typeof question !== "string" || question.trim().length < 4) {
            return res.status(400).json({ error: "Question manquante ou trop courte" });
        }
        const ragResult = await (0, ragService_1.retrieveRagContext)({
            tenantId,
            question,
            documentIds: Array.isArray(documentIds) ? documentIds : undefined,
            documentTypes: Array.isArray(documentTypes) ? documentTypes : undefined,
            serviceFilter: typeof serviceFilter === "string" ? serviceFilter : null,
            maxChunks: typeof maxChunks === "number" ? maxChunks : undefined,
            maxFacts: typeof maxFacts === "number" ? maxFacts : undefined,
        });
        const prompt = (0, ragService_1.buildRagPrompt)({ question, context: ragResult.context });
        const answerHint = (0, ragService_1.draftAnswerFromContext)(question, ragResult.context);
        return res.json({
            question: question.trim(),
            context: ragResult.context,
            prompt: prompt.prompt,
            promptSize: prompt.totalChars,
            draftAnswer: answerHint,
            usedDocumentIds: ragResult.usedDocumentIds,
        });
    }
    catch (error) {
        console.error("Error in /analysis/rag-query:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/pra-rag-report", (0, tenantMiddleware_1.requireRole)("READER"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { question, documentIds, documentTypes, serviceFilter } = req.body || {};
        if (!question || typeof question !== "string" || question.trim().length < 4) {
            return res.status(400).json({ error: "Question manquante ou trop courte" });
        }
        const report = await (0, ragService_1.generatePraReport)({
            tenantId,
            question,
            documentIds: Array.isArray(documentIds) ? documentIds : undefined,
            documentTypes: Array.isArray(documentTypes) ? documentTypes : undefined,
            serviceFilter: typeof serviceFilter === "string" ? serviceFilter : null,
            maxChunks: 8,
            maxFacts: 10,
        });
        return res.json(report);
    }
    catch (error) {
        console.error("Error in /analysis/pra-rag-report:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/runbook-draft", (0, tenantMiddleware_1.requireRole)("READER"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { question, documentIds, documentTypes, serviceFilter } = req.body || {};
        const draft = await (0, ragService_1.generateRunbookDraft)({
            tenantId,
            question: typeof question === "string" && question.trim().length > 0 ? question : undefined,
            documentIds: Array.isArray(documentIds) ? documentIds : undefined,
            documentTypes: Array.isArray(documentTypes) ? documentTypes : undefined,
            serviceFilter: typeof serviceFilter === "string" ? serviceFilter : null,
        });
        return res.json(draft);
    }
    catch (error) {
        console.error("Error in /analysis/runbook-draft:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/* ========= 1. Analyse simple applicative ========= */
router.get("/basic", async (req, res) => {
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
                        toService: {
                            include: { continuity: true },
                        },
                    },
                },
                dependenciesTo: true,
            },
        });
        const warnings = buildAppContinuityWarnings(services);
        return res.json(warnings);
    }
    catch (error) {
        console.error("Error in /analysis/basic:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/* ========= 2. Analyse simple infra ========= */
router.get("/infra-basic", async (req, res) => {
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
        const findings = buildInfraFindings(infra);
        return res.json(findings);
    }
    catch (error) {
        console.error("Error in /analysis/infra-basic:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/* ========= 3. Rapport texte simple ========= */
router.get("/report", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).send("Tenant not resolved");
        }
        const [services, infra] = await Promise.all([
            prismaClient_1.default.service.findMany({
                where: { tenantId },
                include: {
                    continuity: true,
                    dependenciesFrom: {
                        include: {
                            toService: {
                                include: { continuity: true },
                            },
                        },
                    },
                    dependenciesTo: true,
                },
            }),
            prismaClient_1.default.infraComponent.findMany({
                where: { tenantId },
                include: {
                    services: {
                        include: { service: true },
                    },
                },
            }),
        ]);
        const depsWarnings = buildAppContinuityWarnings(services);
        const infraFindings = buildInfraFindings(infra);
        let text = "=== Rapport PRA/PCA – Synthèse technique ===\n\n";
        text += `Nombre de services recensés : ${services.length}\n`;
        const depCount = services.reduce((sum, s) => sum + s.dependenciesFrom.length, 0);
        text += `Nombre de dépendances : ${depCount}\n\n`;
        text += "1. Catalogue des services\n";
        text += "-------------------------\n";
        for (const s of services) {
            text += `- ${s.name} [${s.type}] (criticité : ${s.criticality}`;
            if (s.businessPriority) {
                text += ` | priorité métier : ${s.businessPriority}`;
            }
            text += ")\n";
            if (s.continuity) {
                text += `  RTO : ${s.continuity.rtoHours} h | RPO : ${s.continuity.rpoMinutes} min | MTPD : ${s.continuity.mtpdHours} h\n`;
            }
            if (s.description) {
                text += `  Description : ${s.description}\n`;
            }
            text += "\n";
        }
        text += "\n2. Chaînes de dépendances\n";
        text += "-------------------------\n";
        for (const s of services) {
            for (const dep of s.dependenciesFrom) {
                const target = dep.toService;
                if (!target)
                    continue;
                text += `- ${s.name} dépend de ${target.name} (type de dépendance : ${dep.dependencyType}) \n`;
            }
        }
        text += "\n3. Analyse de cohérence PRA\n";
        text += "---------------------------\n";
        if (depsWarnings.length === 0) {
            text += "Aucune incohérence PRA détectée.\n";
        }
        else {
            text += "Les incohérences suivantes ont été détectées :\n\n";
            for (const w of depsWarnings) {
                text += `- ${w.message}\n`;
            }
        }
        text += "\n4. Synthèse Landing Zone / Infra\n";
        text += "--------------------------------\n";
        for (const f of infraFindings) {
            text += `- ${f.message}\n`;
        }
        res.type("text/plain").send(text);
    }
    catch (error) {
        console.error("Error in /analysis/report:", error);
        return res.status(500).send("Internal server error");
    }
});
/* ========= 4. Moteur de reco PRA (endpoint direct) ========= */
router.post("/pra-options", (0, tenantMiddleware_1.requireRole)("READER"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { environment, maxRtoHours, maxRpoMinutes, criticality, budgetLevel, complexityTolerance, } = req.body || {};
        const env = environment === "onprem" || environment === "hybrid" ? environment : "cloud";
        const crit = criticality === "low" || criticality === "medium" || criticality === "high"
            ? criticality
            : "high";
        const budget = budgetLevel === "low" || budgetLevel === "medium" || budgetLevel === "high"
            ? budgetLevel
            : "medium";
        const cxTol = complexityTolerance === "low" ||
            complexityTolerance === "medium" ||
            complexityTolerance === "high"
            ? complexityTolerance
            : "medium";
        const rto = maxRtoHours != null ? Number(maxRtoHours) : 4;
        const rpo = maxRpoMinutes != null ? Number(maxRpoMinutes) : 60;
        const input = {
            environment: env,
            maxRtoHours: rto,
            maxRpoMinutes: rpo,
            criticality: crit,
            budgetLevel: budget,
            complexityTolerance: cxTol,
        };
        const recs = (0, praRecommender_1.recommendPraOptions)(input);
        return res.json({
            input,
            recommendations: recs,
        });
    }
    catch (error) {
        console.error("Error in /analysis/pra-options:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/* ========= 5. Rapport JSON complet ========= */
router.get("/full-report-json", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const [tenant, services, infra, scenarios] = await Promise.all([
            prismaClient_1.default.tenant.findUnique({ where: { id: tenantId } }),
            prismaClient_1.default.service.findMany({
                where: { tenantId },
                include: {
                    continuity: true,
                    dependenciesFrom: {
                        include: {
                            toService: {
                                include: { continuity: true },
                            },
                        },
                    },
                    dependenciesTo: {
                        include: {
                            fromService: {
                                include: { continuity: true },
                            },
                        },
                    },
                    infraLinks: {
                        include: {
                            infra: true,
                        },
                    },
                },
            }),
            prismaClient_1.default.infraComponent.findMany({
                where: { tenantId },
                include: {
                    services: {
                        include: {
                            service: true,
                        },
                    },
                },
            }),
            prismaClient_1.default.scenario.findMany({
                where: { tenantId },
                include: {
                    services: {
                        include: {
                            service: true,
                        },
                    },
                    steps: {
                        orderBy: {
                            order: "asc",
                        },
                    },
                },
            }),
        ]);
        const appWarnings = buildAppContinuityWarnings(services);
        const infraFindings = buildInfraFindings(infra);
        // Couverture scénarios
        const allServiceIds = services.map((s) => s.id);
        const serviceIdsWithScenario = new Set();
        for (const sc of scenarios) {
            for (const link of sc.services) {
                if (link.serviceId) {
                    serviceIdsWithScenario.add(link.serviceId);
                }
            }
        }
        const servicesWithoutScenario = allServiceIds.filter((id) => !serviceIdsWithScenario.has(id));
        // Input global pour les recos PRA (basé sur les services high crit)
        const highCritServices = services.filter((s) => s.criticality === "high");
        const effectiveRto = highCritServices.length > 0
            ? (() => {
                const vals = highCritServices
                    .map((s) => s.continuity?.rtoHours)
                    .filter((v) => v != null);
                return vals.length > 0 ? Math.min(...vals) : 4;
            })()
            : 4;
        const effectiveRpo = highCritServices.length > 0
            ? (() => {
                const vals = highCritServices
                    .map((s) => s.continuity?.rpoMinutes)
                    .filter((v) => v != null);
                return vals.length > 0 ? Math.min(...vals) : 60;
            })()
            : 60;
        const hasCloud = infra.some((i) => (i.provider || "").toLowerCase().match(/aws|azure|gcp|cloud/));
        const hasOnPrem = infra.some((i) => (i.provider || "").toLowerCase().match(/onprem|on-prem|datacenter|dc/));
        let env = "cloud";
        if (hasCloud && hasOnPrem)
            env = "hybrid";
        else if (!hasCloud && hasOnPrem)
            env = "onprem";
        const praInput = {
            environment: env,
            maxRtoHours: effectiveRto,
            maxRpoMinutes: effectiveRpo,
            criticality: highCritServices.length > 0 ? "high" : "medium",
            budgetLevel: "medium",
            complexityTolerance: "medium",
        };
        const praRecs = (0, praRecommender_1.recommendPraOptions)(praInput);
        const drStrategyInputServices = services.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            domain: s.domain,
            criticality: s.criticality,
            rtoHours: s.continuity?.rtoHours,
            rpoMinutes: s.continuity?.rpoMinutes,
        }));
        const drStrategyDeps = services.flatMap((s) => s.dependenciesFrom.map((d) => ({
            from: d.fromServiceId,
            to: d.toServiceId,
            type: d.dependencyType,
        })));
        const drSuggestions = (0, drStrategyEngine_1.getSuggestedDRStrategy)(drStrategyInputServices, drStrategyDeps, praInput.maxRtoHours, praInput.maxRpoMinutes, praInput.criticality);
        const ragQuestion = tenant?.name && tenant.name.length > 0
            ? `Synthèse PRA/PCA pour ${tenant.name} (tenant ${tenantId})`
            : `Synthèse PRA/PCA pour le tenant ${tenantId}`;
        const ragContextResult = await (0, ragService_1.retrieveRagContext)({
            tenantId,
            question: ragQuestion,
            maxChunks: 4,
            maxFacts: 6,
        });
        const ragPrompt = (0, ragService_1.buildRagPrompt)({
            question: `${ragQuestion} avec rappel des risques et services prioritaires.`,
            context: ragContextResult.context,
            maxTotalLength: 3800,
        });
        const ragScenarioRecs = await (0, ragService_1.recommendScenariosWithRag)({
            tenantId,
            question: ragQuestion,
            services: drStrategyInputServices,
            scenarios,
            context: ragContextResult.context,
            maxResults: 5,
        });
        const report = {
            meta: {
                tenantId,
                tenantName: tenant?.name ?? null,
                generatedAt: new Date().toISOString(),
            },
            catalog: {
                serviceCount: services.length,
                infraCount: infra.length,
                services: services.map((s) => ({
                    id: s.id,
                    name: s.name,
                    type: s.type,
                    description: s.description,
                    criticality: s.criticality,
                    businessPriority: s.businessPriority,
                    recoveryPriority: s.recoveryPriority,
                    domain: s.domain,
                    continuity: s.continuity
                        ? {
                            rtoHours: s.continuity.rtoHours,
                            rpoMinutes: s.continuity.rpoMinutes,
                            mtpdHours: s.continuity.mtpdHours,
                            notes: s.continuity.notes,
                        }
                        : null,
                    dependencies: {
                        dependsOn: s.dependenciesFrom.map((d) => ({
                            id: d.toService?.id,
                            name: d.toService?.name,
                            type: d.toService?.type,
                            dependencyType: d.dependencyType,
                        })),
                        usedBy: s.dependenciesTo.map((d) => ({
                            id: d.fromService?.id,
                            name: d.fromService?.name,
                            type: d.fromService?.type,
                            dependencyType: d.dependencyType,
                        })),
                    },
                    infra: s.infraLinks.map((link) => ({
                        id: link.infra.id,
                        name: link.infra.name,
                        type: link.infra.type,
                        provider: link.infra.provider,
                        location: link.infra.location,
                        isSingleAz: link.infra.isSingleAz,
                    })),
                })),
            },
            continuityAnalysis: {
                warningCount: appWarnings.length,
                warnings: appWarnings,
            },
            landingZone: {
                componentCount: infra.length,
                components: infra.map((i) => ({
                    id: i.id,
                    name: i.name,
                    type: i.type,
                    provider: i.provider,
                    location: i.location,
                    criticality: i.criticality,
                    isSingleAz: i.isSingleAz,
                    services: i.services.map((link) => ({
                        id: link.service.id,
                        name: link.service.name,
                        criticality: link.service.criticality,
                    })),
                })),
                findings: infraFindings,
            },
            scenarios: {
                count: scenarios.length,
                items: scenarios.map((sc) => ({
                    id: sc.id,
                    name: sc.name,
                    type: sc.type,
                    description: sc.description,
                    impactLevel: sc.impactLevel,
                    rtoTargetHours: sc.rtoTargetHours,
                    services: sc.services.map((link) => ({
                        id: link.service.id,
                        name: link.service.name,
                        criticality: link.service.criticality,
                    })),
                    steps: sc.steps.map((st) => ({
                        id: st.id,
                        order: st.order,
                        title: st.title,
                        description: st.description,
                        estimatedDurationMinutes: st.estimatedDurationMinutes,
                        role: st.role,
                        blocking: st.blocking,
                    })),
                })),
                coverage: {
                    servicesWithScenario: serviceIdsWithScenario.size,
                    servicesWithoutScenario: servicesWithoutScenario.length,
                    serviceIdsWithoutScenario: servicesWithoutScenario,
                },
            },
            praOptions: {
                input: praInput,
                recommendations: praRecs,
                drStrategies: {
                    scenarios: drStrategyEngine_1.DR_SCENARIOS,
                    suggestions: drSuggestions.map((rec) => ({
                        id: rec.scenario.id,
                        label: rec.scenario.label,
                        score: rec.score,
                        rationale: rec.rationale,
                        summary: (0, drStrategyEngine_1.summarizeScenarioForTable)(rec),
                    })),
                },
            },
            ragSupport: {
                question: ragQuestion,
                prompt: ragPrompt.prompt,
                promptSize: ragPrompt.totalChars,
                context: ragContextResult.context,
                scenarioRecommendations: ragScenarioRecs,
            },
        };
        return res.json(report);
    }
    catch (error) {
        console.error("Error in /analysis/full-report-json:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/* ========= 6. Analyse IA d'un document ========= */
router.post("/documents/:id/extracted-facts", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { id } = req.params;
        const force = String(req.query.force ?? "false").toLowerCase() === "true";
        const result = await (0, extractedFactService_1.getOrCreateExtractedFacts)(id, tenantId, force);
        return res.json(result);
    }
    catch (error) {
        if (error instanceof extractedFactService_1.DocumentNotFoundError) {
            return res.status(error.status).json({ error: error.message });
        }
        if (error instanceof extractedFactService_1.MissingExtractedTextError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error("Error in POST /analysis/documents/:id/extracted-facts:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/documents/:id/classification-feedback", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { id } = req.params;
        const { payload, issues } = parseFeedbackPayload(req.body);
        if (!payload) {
            return res.status(400).json({ error: "Payload invalide", details: issues });
        }
        const updated = await (0, extractedFactService_1.applyClassificationFeedback)(id, tenantId, payload);
        return res.json({ documentId: id, fact: updated });
    }
    catch (error) {
        if (error instanceof extractedFactService_1.ExtractedFactNotFoundError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error("Error in POST /analysis/documents/:id/classification-feedback:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/feedback/user", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const issues = [];
        const resourceId = parseRequiredString(req.body?.resourceId, "resourceId", issues);
        const type = parseRequiredString(req.body?.type, "type", issues);
        const rating = parseOptionalNumber(req.body?.rating, "rating", issues);
        const comment = parseOptionalString(req.body?.comment, "comment", issues, true);
        const timestamp = parseOptionalString(req.body?.timestamp, "timestamp", issues, true);
        let parsedTimestamp = null;
        if (timestamp) {
            const parsed = new Date(timestamp);
            if (Number.isNaN(parsed.getTime())) {
                addIssue(issues, "timestamp", "format de date invalide");
            }
            else {
                parsedTimestamp = parsed;
            }
        }
        if (issues.length > 0) {
            return res.status(400).json({ error: "Payload invalide", details: issues });
        }
        const feedback = await (0, userFeedbackService_1.recordUserFeedback)({
            tenantId,
            resourceId: resourceId,
            type: type,
            rating,
            comment,
            timestamp: parsedTimestamp,
        });
        return res.status(201).json({ feedback });
    }
    catch (error) {
        console.error("Error in POST /analysis/feedback/user:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/feedback/rag-experiments", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const issues = [];
        const experimentKey = parseOptionalString(req.body?.experimentKey, "experimentKey", issues, true);
        const subjectId = parseOptionalString(req.body?.subjectId, "subjectId", issues, true);
        const variant = parseOptionalString(req.body?.variant, "variant", issues, true);
        const rating = parseOptionalNumber(req.body?.rating, "rating", issues);
        const comment = parseOptionalString(req.body?.comment, "comment", issues, true);
        if (rating === undefined) {
            addIssue(issues, "rating", "champ requis");
        }
        if (issues.length > 0) {
            return res.status(400).json({ error: "Payload invalide", details: issues });
        }
        const { assignment } = await (0, ragExperimentService_1.getOrCreateRagExperimentAssignment)({
            tenantId,
            subjectId,
            experimentKey: experimentKey ?? undefined,
        });
        const feedback = await (0, ragExperimentService_1.recordRagExperimentFeedback)({
            tenantId,
            experimentKey: assignment.experimentKey,
            subjectId: assignment.subjectId,
            variant: variant ?? assignment.variant,
            rating,
            comment,
        });
        return res.status(201).json({ feedback });
    }
    catch (error) {
        console.error("Error in POST /analysis/feedback/rag-experiments:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
//# sourceMappingURL=analysisRoutes.js.map

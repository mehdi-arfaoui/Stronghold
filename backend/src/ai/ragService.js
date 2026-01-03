"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.retrieveRagContext = retrieveRagContext;
exports.draftAnswerFromContext = draftAnswerFromContext;
exports.buildRagPrompt = buildRagPrompt;
exports.recommendScenariosWithRag = recommendScenariosWithRag;
exports.generatePraReport = generatePraReport;
exports.generateRunbookDraft = generateRunbookDraft;
const prismaClient_1 = __importDefault(require("../prismaClient"));
const client_1 = require("@prisma/client");
const drStrategyEngine_1 = require("../analysis/drStrategyEngine");
const MAX_CHARS_PER_CHUNK = 900;
const MAX_CHARS_PER_FACT = 320;
const DEFAULT_MAX_CHUNKS = 6;
const DEFAULT_MAX_FACTS = 8;
const PROMPT_MAX_TOTAL = 4_000;
function sanitizeText(text) {
    return (text ?? "").replace(/\s+/g, " ").trim();
}
function clampText(text, limit) {
    if (text.length <= limit)
        return text;
    return `${text.slice(0, Math.max(0, limit - 3))}...`;
}
function tokenize(text) {
    return sanitizeText(text)
        .toLowerCase()
        .replace(/[^a-z0-9à-ÿ\s]/gi, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2);
}
function buildTokenSet(text) {
    return new Set(tokenize(text));
}
function similarityScore(queryTokens, targetText) {
    const targetTokens = buildTokenSet(targetText);
    if (targetTokens.size === 0 || queryTokens.size === 0)
        return 0;
    let overlap = 0;
    targetTokens.forEach((token) => {
        if (queryTokens.has(token)) {
            overlap += 1;
        }
    });
    const precision = overlap / queryTokens.size;
    const coverage = overlap / targetTokens.size;
    return Number((precision * 0.6 + coverage * 0.4).toFixed(4));
}
function splitIntoChunks(text, maxChunks) {
    const cleaned = sanitizeText(text);
    if (!cleaned)
        return [];
    const rawParts = cleaned.split(/\n{2,}/).filter(Boolean);
    const chunks = [];
    for (const part of rawParts) {
        if (chunks.length >= maxChunks * 2)
            break;
        if (part.length <= MAX_CHARS_PER_CHUNK) {
            chunks.push(part);
            continue;
        }
        for (let i = 0; i < part.length && chunks.length < maxChunks * 2; i += MAX_CHARS_PER_CHUNK) {
            chunks.push(part.slice(i, i + MAX_CHARS_PER_CHUNK));
        }
    }
    return chunks.slice(0, maxChunks);
}
function buildFactPreview(fact) {
    const parsed = fact.data && fact.data.length > 0
        ? (() => {
            try {
                return JSON.parse(fact.data);
            }
            catch (_err) {
                return { raw: fact.data };
            }
        })()
        : {};
    const serialized = clampText(JSON.stringify(parsed), MAX_CHARS_PER_FACT);
    return {
        id: fact.id,
        documentId: fact.documentId,
        label: clampText(fact.label, 160),
        category: fact.category,
        dataPreview: serialized,
        confidence: fact.confidence ?? null,
        score: 0,
    };
}
async function retrieveRagContext(options) {
    const prismaClient = options.prismaClient ?? prismaClient_1.default;
    const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
    const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;
    const questionTokens = buildTokenSet(`${options.question} ${options.serviceFilter || ""}`);
    const docFilter = {
        ...(options.documentIds && options.documentIds.length > 0 ? { id: { in: options.documentIds } } : {}),
        ...(options.documentTypes && options.documentTypes.length > 0
            ? { docType: { in: options.documentTypes.map((d) => d.toUpperCase()) } }
            : {}),
    };
    const [documents, facts] = await Promise.all([
        prismaClient.document.findMany({
            where: {
                tenantId: options.tenantId,
                extractionStatus: "SUCCESS",
                ...docFilter,
            },
            select: {
                id: true,
                originalName: true,
                docType: true,
                textContent: true,
            },
            take: 25,
        }),
        prismaClient.extractedFact.findMany({
            where: {
                tenantId: options.tenantId,
                ...(docFilter.id ? { documentId: docFilter.id.in } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 120,
        }),
    ]);
    const chunkCandidates = [];
    for (const doc of documents) {
        const chunks = splitIntoChunks(doc.textContent || "", maxChunks);
        for (const chunk of chunks) {
            chunkCandidates.push({
                documentId: doc.id,
                documentName: doc.originalName,
                documentType: doc.docType,
                text: clampText(chunk, MAX_CHARS_PER_CHUNK),
                score: similarityScore(questionTokens, chunk),
            });
        }
    }
    const allowedDocIds = new Set(documents.map((d) => d.id));
    const factCandidates = facts
        .filter((fact) => allowedDocIds.has(fact.documentId))
        .map(buildFactPreview)
        .map((fact) => {
        const basis = `${fact.label} ${fact.dataPreview} ${fact.category}`;
        return { ...fact, score: similarityScore(questionTokens, basis) };
    });
    const sortedChunks = chunkCandidates.sort((a, b) => b.score - a.score).slice(0, maxChunks);
    const sortedFacts = factCandidates.sort((a, b) => b.score - a.score).slice(0, maxFacts);
    return {
        context: {
            chunks: sortedChunks,
            extractedFacts: sortedFacts,
        },
        usedDocumentIds: documents.map((d) => d.id),
        questionTokens,
    };
}
function draftAnswerFromContext(question, context) {
    const facts = context.extractedFacts.slice(0, 3);
    const chunks = context.chunks.slice(0, 2);
    if (facts.length === 0 && chunks.length === 0) {
        return "Aucun contexte pertinent trouvé pour cette question. Revoir les documents indexés ou préciser le périmètre (documentId, type).";
    }
    const factLines = facts.length > 0
        ? facts.map((f) => `- ${f.label} (cat: ${f.category}, confiance: ${f.confidence ?? "?"})`).join("\n")
        : "- Aucun fait structuré disponible.";
    const chunkLines = chunks.length > 0
        ? chunks
            .map((c) => `- ${c.documentName} (${c.documentType || "doc"}) → ${clampText(c.text, 180)}`)
            .join("\n")
        : "- Aucun extrait textuel retenu.";
    return [
        `Question: ${question}`,
        "Indices structurés:",
        factLines,
        "Extraits textuels:",
        chunkLines,
        "Proposez une réponse concise en français en utilisant uniquement ces éléments.",
    ].join("\n");
}
function buildRagPrompt(params) {
    const maxTotal = params.maxTotalLength ?? PROMPT_MAX_TOTAL;
    const header = `Tu es un assistant PRA/PCA. Réponds en français de manière concise et factuelle.\n` +
        `Utilise UNIQUEMENT le contexte fourni (chunks + faits) et cite l'origine sous la forme [doc=<id>].\n` +
        `Question: ${params.question}\n` +
        `Inclure: (1) résumé des dépendances clés, (2) stratégies DR adaptées (Backup & Restore, Pilot Light, Warm Standby, Multi-AZ, Active/Active, Active/Passive, CDP), ` +
        `(3) estimation RTO/RPO, coût et complexité, (4) mini-runbook étape par étape.`;
    const chunkLines = params.context.chunks
        .map((c) => `- [${c.documentId}] ${c.documentName} (${c.documentType || "doc"}): ${clampText(c.text, 260)}`)
        .join("\n");
    const factLines = params.context.extractedFacts
        .map((f) => `- (${f.category}) ${f.label} -> ${clampText(f.dataPreview, 220)} [doc=${f.documentId}]`)
        .join("\n");
    const parts = [
        header,
        "Contexte textuel (chunks):",
        chunkLines || "- Aucun chunk sélectionné.",
        "Faits extraits:",
        factLines || "- Aucun fait structuré disponible.",
        "Règles: ignore les documents hors tenant, ne divulgue pas de données personnelles, ne fabrique pas de faits.",
    ];
    let prompt = "";
    for (const part of parts) {
        if ((prompt + "\n" + part).length > maxTotal)
            break;
        prompt = prompt ? `${prompt}\n${part}` : part;
    }
    return { prompt, totalChars: prompt.length };
}
async function recommendScenariosWithRag(params) {
    const prismaClient = params.prismaClient ?? prismaClient_1.default;
    const maxResults = params.maxResults ?? 5;
    const dbScenarios = params.scenarios ??
        (await prismaClient.scenario.findMany({
            where: { tenantId: params.tenantId },
            include: { services: { include: { service: true } } },
        }));
    const scenarioPool = [
        ...dbScenarios,
        ...drStrategyEngine_1.DR_SCENARIOS.map((s) => ({
            ...s,
            name: s.label,
            type: s.id,
            services: [],
        })),
    ];
    const queryTokens = new Set();
    tokenize(params.question || "").forEach((t) => queryTokens.add(t));
    (params.services || []).forEach((s) => {
        tokenize(`${s.name} ${s.type} ${s.criticality ?? ""}`).forEach((t) => queryTokens.add(t));
    });
    if (params.context) {
        params.context.extractedFacts.forEach((fact) => {
            tokenize(`${fact.label} ${fact.dataPreview} ${fact.category}`).forEach((t) => queryTokens.add(t));
        });
        params.context.chunks.forEach((chunk) => {
            tokenize(chunk.text).forEach((t) => queryTokens.add(t));
        });
    }
    const candidates = scenarioPool.map((scenario) => {
        const serviceNames = "services" in scenario
            ? scenario.services?.map((link) => link.service?.name).filter(Boolean) ?? []
            : [];
        const basis = `${scenario.name ?? scenario.label} ${scenario.type ?? ""} ${scenario.description ?? ""} ${serviceNames.join(" ")}`;
        const score = similarityScore(queryTokens, basis);
        const reasons = [];
        if (score > 0.4) {
            reasons.push("Similarité élevée avec les risques/faits détectés.");
        }
        else if (score > 0.2) {
            reasons.push("Alignement partiel avec le contexte RAG.");
        }
        else {
            reasons.push("Peu de correspondances détectées, tri conservateur.");
        }
        if (serviceNames.length > 0) {
            reasons.push(`Services concernés: ${serviceNames.slice(0, 3).join(", ")}`);
        }
        return {
            scenarioId: scenario.id,
            name: scenario.name ?? scenario.label,
            score,
            reason: reasons,
            matchedServices: serviceNames.slice(0, 5),
        };
    });
    return candidates.sort((a, b) => b.score - a.score).slice(0, maxResults);
}
async function generatePraReport(params) {
    const contextResult = await retrieveRagContext({
        tenantId: params.tenantId,
        question: params.question,
        documentIds: params.documentIds,
        documentTypes: params.documentTypes,
        serviceFilter: params.serviceFilter,
        maxChunks: params.maxChunks ?? 6,
        maxFacts: params.maxFacts ?? 8,
        prismaClient: params.prismaClient,
    });
    const prompt = buildRagPrompt({
        question: params.question,
        context: contextResult.context,
    });
    const scenarioRecommendations = await recommendScenariosWithRag({
        tenantId: params.tenantId,
        question: params.question,
        context: contextResult.context,
        maxResults: 6,
        prismaClient: params.prismaClient,
    });
    return {
        prompt: prompt.prompt,
        promptSize: prompt.totalChars,
        context: contextResult.context,
        draftAnswer: draftAnswerFromContext(params.question, contextResult.context),
        scenarioRecommendations,
        usedDocumentIds: contextResult.usedDocumentIds,
    };
}
async function generateRunbookDraft(params) {
    const baseQuestion = params.question ||
        "Génère un runbook PRA détaillé incluant dépendances, sauvegardes et étapes de reprise.";
    const report = await generatePraReport({
        tenantId: params.tenantId,
        question: baseQuestion,
        documentIds: params.documentIds,
        documentTypes: params.documentTypes,
        serviceFilter: params.serviceFilter,
        maxChunks: 8,
        maxFacts: 10,
    });
    const sources = [
        ...new Set(report.context.chunks.map((c) => c.documentName)),
        ...report.context.extractedFacts.map((f) => f.documentId),
    ];
    return {
        ...report,
        sources,
        draftRunbook: [
            "# Runbook PRA (brouillon)",
            `Question utilisateur: ${baseQuestion}`,
            "## Services et dépendances clés",
            report.context.extractedFacts.slice(0, 5).map((f) => `- ${f.label} (${f.category})`).join("\n") ||
                "- Aucun fait structuré détecté.",
            "## Étapes de reprise (esquisse)",
            "- Déclencher la cellule de crise et confirmer le périmètre du sinistre.",
            "- Activer la stratégie DR recommandée (Pilot Light / Warm Standby / Multi-AZ) selon les contraintes RTO/RPO.",
            "- Restaurer les sauvegardes critiques ou promouvoir les réplicas.",
            "- Vérifier l'application et les dépendances (DB, messaging, réseau).",
            "- Communiquer la reprise et clôturer avec un post-mortem.",
            "",
            "## Sources utilisées",
            sources.map((s) => `- ${s || "document inconnu"}`).join("\n"),
        ].join("\n"),
    };
}
//# sourceMappingURL=ragService.js.map
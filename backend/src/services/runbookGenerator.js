"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRunbook = generateRunbook;
const prismaClient_1 = __importDefault(require("../prismaClient"));
const praRecommender_1 = require("../analysis/praRecommender");
const crypto = __importStar(require("crypto"));
const ragService_1 = require("../ai/ragService");
const docx_1 = require("docx");
const pdf_lib_1 = require("pdf-lib");
const client_1 = require("@prisma/client");
const runbookTemplateService_1 = require("./runbookTemplateService");
const s3Client_1 = require("../clients/s3Client");
function toMarkdownList(items) {
    return items.map((i) => `- ${i}`).join("\n");
}
function describeBackup(type) {
    const normalized = type.toLowerCase();
    if (normalized === "full") {
        return "Full backup : stockage élevé, restauration rapide, idéal quand la fenêtre de sauvegarde est acceptée.";
    }
    if (normalized === "differential") {
        return "Differential : compromis, stockage modéré, restauration plus rapide qu'incrémentale.";
    }
    if (normalized === "incremental") {
        return "Incremental : sauvegarde rapide et peu volumineuse, restauration plus lente (chaînage).";
    }
    if (normalized === "continuous") {
        return "Continuous/streaming : capture quasi temps réel, excellente RPO mais coûts plus élevés.";
    }
    if (normalized === "snapshot") {
        return "Snapshot : copies rapides, utiles pour PRA IaaS/PaaS, vérifier la rétention.";
    }
    return "Stratégie personnalisée.";
}
function buildBackupComparison(strategies) {
    if (strategies.length === 0)
        return "Aucune stratégie de sauvegarde renseignée.";
    const lines = strategies.map((s) => {
        const freq = `${s.frequencyMinutes} min`;
        const ret = `${s.retentionDays} j`;
        const base = `${s.service?.name || "Global"} -> ${s.type.toUpperCase()} (${freq} / rétention ${ret})`;
        const impact = [
            s.rtoImpactHours ? `RTO cible ${s.rtoImpactHours}h` : null,
            s.rpoImpactMinutes ? `RPO cible ${s.rpoImpactMinutes} min` : null,
        ]
            .filter(Boolean)
            .join(" | ");
        return `- ${base} ${impact ? `| ${impact}` : ""} — ${describeBackup(s.type)}`;
    });
    return lines.join("\n");
}
function splitLines(text) {
    return text.replace(/\r\n/g, "\n").split("\n");
}
function toDocxParagraph(line) {
    if (line.startsWith("# ")) {
        return new docx_1.Paragraph({
            text: line.replace(/^#\s*/, "").trim(),
            heading: docx_1.HeadingLevel.HEADING_1,
        });
    }
    if (line.startsWith("## ")) {
        return new docx_1.Paragraph({
            text: line.replace(/^##\s*/, "").trim(),
            heading: docx_1.HeadingLevel.HEADING_2,
        });
    }
    return new docx_1.Paragraph({
        children: [new docx_1.TextRun(line)],
    });
}
async function renderDocx(content) {
    const lines = splitLines(content);
    const doc = new docx_1.Document({
        sections: [
            {
                properties: {},
                children: lines.map((line) => toDocxParagraph(line || " ")),
            },
        ],
    });
    return docx_1.Packer.toBuffer(doc);
}
async function renderPdf(content, title) {
    const pdfDoc = await pdf_lib_1.PDFDocument.create();
    const font = await pdfDoc.embedFont(pdf_lib_1.StandardFonts.Helvetica);
    const lines = splitLines(`${title}\n\n${content}`);
    let page = pdfDoc.addPage();
    const fontSize = 11;
    const margin = 40;
    const lineHeight = fontSize * 1.4;
    let y = page.getHeight() - margin;
    const drawLine = (text) => {
        page.drawText(text, {
            x: margin,
            y,
            size: fontSize,
            font,
            color: (0, pdf_lib_1.rgb)(0, 0, 0),
        });
    };
    for (const line of lines) {
        if (y <= margin) {
            page = pdfDoc.addPage();
            y = page.getHeight() - margin;
        }
        drawLine(line);
        y -= lineHeight;
    }
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}
function buildFindingsSummary(ragContext) {
    const factLines = ragContext.extractedFacts && ragContext.extractedFacts.length > 0
        ? ragContext.extractedFacts
            .slice(0, 6)
            .map((f) => `- ${f.label} (${f.category}) ${f.dataPreview ? `→ ${f.dataPreview}` : ""}`)
            .join("\n")
        : "- Aucun fait extrait trouvé.";
    const chunkLines = ragContext.chunks && ragContext.chunks.length > 0
        ? ragContext.chunks
            .slice(0, 3)
            .map((c) => `- ${c.documentName} : ${c.text}`)
            .join("\n")
        : "- Aucun extrait textuel utilisé.";
    return ["Faits extraits:", factLines, "Extraits RAG:", chunkLines].join("\n");
}
function buildPlaceholderValues(params) {
    const depsCombined = [params.depsList || "", params.cycleList ? `Cycles critiques:\n${params.cycleList}` : ""]
        .filter((part) => part && part.trim().length > 0)
        .join("\n");
    return {
        SERVICES: params.servicesList || "Aucun service enregistré.",
        DEPENDANCES: depsCombined || "Pas de dépendances renseignées.",
        "RTO/RPO": `Cible RTO: ${params.targetRto}h | Cible RPO: ${params.targetRpo} minutes`,
        RTO_RPO: `Cible RTO: ${params.targetRto}h | Cible RPO: ${params.targetRpo} minutes`,
        SAUVEGARDES: params.backupComparison || "Aucune stratégie de sauvegarde renseignée.",
        POLITIQUES: params.policiesList || "Aucune politique de sécurité liée.",
        ETAPES: params.scenarioSteps || "Pas d'étapes spécifiques.",
        FINDINGS: params.ragFindings || "Aucun élément RAG disponible.",
    };
}
async function mergeTemplateWithPlaceholders(template, placeholders) {
    const rawContent = await (0, runbookTemplateService_1.loadTemplateText)(template);
    return (0, runbookTemplateService_1.applyPlaceholders)(rawContent || "", placeholders);
}
async function generateRunbook(tenantId, options) {
    const scenario = options.scenarioId
        ? await prismaClient_1.default.scenario.findFirst({
            where: { id: options.scenarioId, tenantId },
            include: { services: { include: { service: true } }, steps: true },
        })
        : null;
    const [tenant, services, dependencies, backupStrategies, policies, cycles, template] = await Promise.all([
        prismaClient_1.default.tenant.findUnique({ where: { id: tenantId } }),
        prismaClient_1.default.service.findMany({
            where: { tenantId },
            include: { continuity: true },
            orderBy: { recoveryPriority: "asc" },
        }),
        prismaClient_1.default.serviceDependency.findMany({
            where: { tenantId },
            include: { fromService: true, toService: true },
        }),
        prismaClient_1.default.backupStrategy.findMany({ where: { tenantId }, include: { service: true } }),
        prismaClient_1.default.securityPolicy.findMany({
            where: { tenantId },
            include: { services: { include: { service: true } } },
        }),
        prismaClient_1.default.dependencyCycle.findMany({
            where: { tenantId },
            include: { services: { include: { service: true } } },
        }),
        options.templateId
            ? prismaClient_1.default.runbookTemplate.findFirst({ where: { id: options.templateId, tenantId } })
            : null,
    ]);
    const highCrit = services.filter((s) => s.criticality === "high" && s.continuity);
    const targetRto = Math.min(...highCrit.map((s) => s.continuity?.rtoHours || 24), 24);
    const targetRpo = Math.min(...highCrit.map((s) => s.continuity?.rpoMinutes || 60), 60);
    const praRecs = (0, praRecommender_1.recommendPraOptions)({
        environment: "cloud",
        maxRtoHours: Number.isFinite(targetRto) ? targetRto : 4,
        maxRpoMinutes: Number.isFinite(targetRpo) ? targetRpo : 60,
        criticality: highCrit.length > 0 ? "high" : "medium",
        budgetLevel: "medium",
        complexityTolerance: "medium",
    });
    const topRec = praRecs[0];
    const servicesList = services
        .map((s) => `- ${s.name} (${s.type}) — Criticité ${s.criticality?.toUpperCase() ?? "?"} | RTO ${s.continuity?.rtoHours ?? "?"}h | RPO ${s.continuity?.rpoMinutes ?? "?"}min | MTPD ${s.continuity?.mtpdHours ?? "?"}h`)
        .join("\n");
    const depsList = dependencies
        .map((d) => `- ${d.fromService?.name} → ${d.toService?.name} (${d.dependencyType})`)
        .join("\n");
    const cycleList = cycles
        .map((c) => {
        const members = c.services.map((s) => s.service?.name).filter(Boolean).join(", ");
        return `- ${c.label} [${c.severity || ""}] : ${members}`;
    })
        .join("\n");
    const policiesList = policies
        .map((p) => {
        const linked = p.services.map((s) => s.service?.name).filter(Boolean).join(", ");
        return `- ${p.name} (${p.policyType})${linked ? ` — ${linked}` : ""}`;
    })
        .join("\n");
    const ragQuestion = scenario
        ? `Préparer un runbook PRA/PCA pour le scénario ${scenario.name} (${scenario.type})`
        : "Préparer un runbook PRA/PCA multi-services pour ce tenant";
    const ragContextResult = await (0, ragService_1.retrieveRagContext)({
        tenantId,
        question: ragQuestion,
        maxChunks: 3,
        maxFacts: 5,
    });
    const ragPrompt = (0, ragService_1.buildRagPrompt)({
        question: `${ragQuestion}. Utilise le contexte pour prioriser les actions.`,
        context: ragContextResult.context,
        maxTotalLength: 3600,
    });
    const ragScenarioRecommendations = await (0, ragService_1.recommendScenariosWithRag)({
        tenantId,
        question: ragQuestion,
        services,
        scenarios: scenario ? [scenario] : undefined,
        context: ragContextResult.context,
        maxResults: 5,
    });
    const scenarioSteps = scenario && scenario.steps.length > 0
        ? scenario.steps
            .sort((a, b) => a.order - b.order)
            .map((s) => `- [${s.order}] ${s.title}${s.role ? ` (${s.role})` : ""}`)
            .join("\n")
        : "";
    const ragFindings = buildFindingsSummary(ragContextResult.context);
    const placeholderValues = buildPlaceholderValues({
        servicesList,
        depsList,
        cycleList,
        targetRto,
        targetRpo,
        backupComparison: buildBackupComparison(backupStrategies),
        policiesList,
        scenarioSteps,
        ragFindings,
    });
    const baseMarkdown = [
        `# ${options.title || "Runbook PRA/PCA"}`,
        "",
        options.summary || "Synthèse générée automatiquement à partir des services, dépendances et stratégies PRA.",
        "",
        `Tenant : ${tenant?.name || tenantId}`,
        scenario ? `Scénario ciblé : ${scenario.name} (${scenario.type})` : "Scénario : général",
        "",
        "## Catalogue des services (priorité métier)",
        placeholderValues.SERVICES,
        "",
        "## Dépendances et cycles critiques",
        placeholderValues.DEPENDANCES,
        cycleList ? `\nCycles circulaires :\n${cycleList}` : "",
        "",
        "## Stratégies de sauvegarde",
        placeholderValues.SAUVEGARDES,
        "",
        "## Politiques de sécurité associées",
        placeholderValues.POLITIQUES,
        "",
        "## Recommandation PRA priorisée",
        topRec
            ? toMarkdownList([`${topRec.name} (score ${topRec.score})`, ...topRec.reasons.slice(0, 3)])
            : "Pas de recommandation calculée.",
        "",
        "## Plan d'action",
        "- Vérifier que les dépendances respectent le RTO/RPO cibles (voir cycles circulaires).",
        "- Tester la restauration sur échantillon et consigner les résultats.",
        "- Consolider le runbook avec les contacts et validations métiers.",
        scenarioSteps ? scenarioSteps : "- Aucun step spécifique au scénario n'est renseigné.",
        "",
        "## Synthèse RTO/RPO",
        placeholderValues["RTO/RPO"],
        "",
        "## Contexte RAG",
        ragFindings,
    ]
        .filter((block) => block !== "")
        .join("\n");
    const mergedContent = template && template.id
        ? await mergeTemplateWithPlaceholders(template, placeholderValues)
        : baseMarkdown;
    const finalContent = mergedContent && mergedContent.trim().length > 0 ? mergedContent : baseMarkdown;
    const runbookId = crypto.randomUUID();
    const bucket = (0, s3Client_1.getTenantBucketName)(tenantId);
    const markdownKey = (0, s3Client_1.buildObjectKey)(tenantId, `runbooks/${runbookId}.md`);
    const pdfKey = (0, s3Client_1.buildObjectKey)(tenantId, `runbooks/${runbookId}.pdf`);
    const docxKey = (0, s3Client_1.buildObjectKey)(tenantId, `runbooks/${runbookId}.docx`);
    await (0, s3Client_1.uploadObjectToBucket)({
        bucket,
        key: markdownKey,
        body: Buffer.from(finalContent, "utf8"),
        contentType: "text/markdown",
    });
    const pdfBuffer = await renderPdf(finalContent, options.title || "Runbook PRA/PCA");
    await (0, s3Client_1.uploadObjectToBucket)({
        bucket,
        key: pdfKey,
        body: pdfBuffer,
        contentType: "application/pdf",
    });
    const docxBuffer = await renderDocx(finalContent);
    await (0, s3Client_1.uploadObjectToBucket)({
        bucket,
        key: docxKey,
        body: docxBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const runbookRecord = await prismaClient_1.default.runbook.create({
        data: {
            id: runbookId,
            tenantId,
            scenarioId: scenario?.id || null,
            title: options.title || "Runbook PRA/PCA",
            status: "READY",
            summary: options.summary || null,
            markdownPath: `s3://${bucket}/${markdownKey}`,
            pdfPath: `s3://${bucket}/${pdfKey}`,
            docxPath: `s3://${bucket}/${docxKey}`,
            generatedForServices: JSON.stringify(services.map((s) => s.id)),
            templateId: template?.id || null,
            templateNameSnapshot: template?.originalName || null,
        },
    });
    return {
        runbook: runbookRecord,
        markdown: finalContent,
        pdfPath: runbookRecord.pdfPath,
        docxPath: runbookRecord.docxPath,
        markdownPath: runbookRecord.markdownPath,
        ragContext: ragContextResult.context,
        llmPrompt: ragPrompt.prompt,
        ragScenarioRecommendations,
    };
}
//# sourceMappingURL=runbookGenerator.js.map
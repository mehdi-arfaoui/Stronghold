"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtractedFactNotFoundError = exports.MissingExtractedTextError = exports.DocumentNotFoundError = void 0;
exports.applyClassificationFeedback = applyClassificationFeedback;
exports.getOrCreateExtractedFacts = getOrCreateExtractedFacts;
const prismaClient_1 = __importDefault(require("../prismaClient"));
const extractedFactsAnalyzer_1 = require("../ai/extractedFactsAnalyzer");
const extractedFactSchema_1 = require("../ai/extractedFactSchema");
const classificationService_1 = require("./classificationService");
class DocumentNotFoundError extends Error {
    status = 404;
    constructor() {
        super("Document not found for tenant");
    }
}
exports.DocumentNotFoundError = DocumentNotFoundError;
class MissingExtractedTextError extends Error {
    status = 400;
    constructor() {
        super("Document has no extracted text");
    }
}
exports.MissingExtractedTextError = MissingExtractedTextError;
class ExtractedFactNotFoundError extends Error {
    status = 404;
    constructor() {
        super("Extracted fact not found for tenant");
    }
}
exports.ExtractedFactNotFoundError = ExtractedFactNotFoundError;
function clampConfidence(value) {
    if (typeof value !== "number" || Number.isNaN(value))
        return null;
    return Math.min(1, Math.max(0, value));
}
function normalizeCategory(category) {
    const upper = (category ?? "OTHER").toString().toUpperCase();
    return extractedFactSchema_1.EXTRACTED_FACT_CATEGORIES.includes(upper)
        ? upper
        : "OTHER";
}
function parseDataField(raw) {
    try {
        return raw ? JSON.parse(raw) : {};
    }
    catch (_err) {
        return { raw };
    }
}
function pickOptionalStringField(data, key) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return null;
}
function mapDbFact(fact) {
    const data = parseDataField(fact.data);
    return {
        id: fact.id,
        documentId: fact.documentId,
        type: fact.type,
        category: normalizeCategory(fact.category),
        label: fact.label,
        data,
        service: pickOptionalStringField(data, "service"),
        infra: pickOptionalStringField(data, "infra"),
        sla: pickOptionalStringField(data, "sla"),
        source: fact.source ?? null,
        confidence: clampConfidence(fact.confidence ?? null),
        createdAt: fact.createdAt,
        updatedAt: fact.updatedAt,
    };
}
function ensureDocumentHasText(textContent) {
    if (!textContent || textContent.trim().length === 0) {
        throw new MissingExtractedTextError();
    }
}
function buildMinimalFallbackFact(document) {
    return {
        type: "MINIMAL_EXTRACTION",
        category: normalizeCategory("OTHER"),
        label: "Extraction minimale",
        data: {
            documentName: document.originalName,
            docType: document.docType ?? "INCONNU",
            note: "Extraction IA indisponible. Faits minimaux fournis.",
        },
        source: null,
        confidence: null,
    };
}
async function recordAiExtractionError(params) {
    const error = params.error;
    const cause = (error?.message || "Unknown AI extraction error").slice(0, 500);
    const errorName = error?.name ? String(error.name).slice(0, 120) : null;
    try {
        await params.prismaClient.aiExtractionError.create({
            data: {
                tenantId: params.tenantId,
                documentId: params.documentId,
                cause,
                errorName,
                correlationId: params.correlationId,
            },
        });
    }
    catch (storeErr) {
        console.warn("[extractedFactService] unable to store AI extraction error", {
            tenantId: params.tenantId,
            documentId: params.documentId,
            correlationId: params.correlationId,
            errorName: storeErr?.name,
        });
    }
}
async function getOrCreateExtractedFacts(documentId, tenantId, force = false, prismaClient = prismaClient_1.default, factAnalyzer = extractedFactsAnalyzer_1.analyzeExtractedFacts) {
    const document = await prismaClient.document.findFirst({
        where: { id: documentId, tenantId },
    });
    if (!document) {
        throw new DocumentNotFoundError();
    }
    const documentText = document.textContent ?? "";
    ensureDocumentHasText(documentText);
    const existingFacts = await prismaClient.extractedFact.findMany({
        where: { tenantId, documentId: document.id },
        orderBy: { createdAt: "asc" },
    });
    if (existingFacts.length > 0 && !force) {
        return {
            documentId: document.id,
            facts: existingFacts.map(mapDbFact),
        };
    }
    if (force && existingFacts.length > 0) {
        await prismaClient.extractedFact.deleteMany({
            where: { tenantId, documentId: document.id },
        });
    }
    const correlationId = `doc-${document.id}`;
    let aiFacts;
    try {
        const classification = await (0, classificationService_1.classifyDocumentFacts)({
            text: documentText,
            documentName: document.originalName,
            docType: document.docType,
            correlationId,
            tenantId,
            factAnalyzer,
        });
        aiFacts = classification.facts;
    }
    catch (err) {
        const message = err?.message || "Unknown OpenAI analysis error";
        console.error("[extractedFactService] analysis failed", {
            event: "ai_extraction_error",
            correlationId,
            tenantId,
            documentId: document.id,
            errorName: err?.name,
            errorMessage: message.slice(0, 200),
        });
        await recordAiExtractionError({
            tenantId,
            documentId: document.id,
            correlationId,
            error: err,
            prismaClient,
        });
        aiFacts = [buildMinimalFallbackFact(document)];
    }
    const createdFacts = [];
    for (const fact of aiFacts) {
        const confidence = clampConfidence(fact.confidence ?? null);
        const payloadData = fact.data ?? {};
        const serializedData = JSON.stringify(payloadData);
        const created = await prismaClient.extractedFact.create({
            data: {
                tenantId,
                documentId: document.id,
                type: fact.type || "PRA_PCA_FACT",
                category: normalizeCategory(fact.category),
                label: fact.label,
                data: serializedData,
                source: fact.source?.slice(0, 500) ?? null,
                confidence,
            },
        });
        createdFacts.push(mapDbFact(created));
    }
    return {
        documentId: document.id,
        facts: createdFacts,
    };
}
function applyOptionalDataField(data, key, value) {
    if (value === undefined) {
        return;
    }
    if (value === null) {
        delete data[key];
        return;
    }
    data[key] = value;
}
async function applyClassificationFeedback(documentId, tenantId, payload, prismaClient = prismaClient_1.default) {
    const existing = await prismaClient.extractedFact.findFirst({
        where: { id: payload.factId, tenantId, documentId },
    });
    if (!existing) {
        throw new ExtractedFactNotFoundError();
    }
    const updatedData = parseDataField(existing.data);
    applyOptionalDataField(updatedData, "service", payload.service);
    applyOptionalDataField(updatedData, "infra", payload.infra);
    applyOptionalDataField(updatedData, "sla", payload.sla);
    const updatedCategory = payload.category
        ? normalizeCategory(payload.category)
        : normalizeCategory(existing.category);
    const updatePayload = {
        category: updatedCategory,
        type: payload.type ?? existing.type,
        label: payload.label ?? existing.label,
        data: JSON.stringify(updatedData),
    };
    await prismaClient.extractedFact.updateMany({
        where: { id: existing.id, tenantId, documentId },
        data: updatePayload,
    });
    const refreshed = await prismaClient.extractedFact.findFirst({
        where: { id: existing.id, tenantId, documentId },
    });
    if (!refreshed) {
        throw new ExtractedFactNotFoundError();
    }
    const document = await prismaClient.document.findFirst({
        where: { id: documentId, tenantId },
    });
    if (document?.textContent) {
        const docHash = (0, classificationService_1.computeDocumentHash)(document.textContent);
        await (0, classificationService_1.updateCachedClassification)({
            tenantId,
            docHash,
            originalFact: {
                type: existing.type,
                category: existing.category,
                label: existing.label,
            },
            updatedFact: {
                type: updatePayload.type ?? existing.type,
                category: updatedCategory,
                label: updatePayload.label ?? existing.label,
                data: updatedData,
                source: existing.source ?? null,
                confidence: existing.confidence ?? null,
            },
        });
    }
    return mapDbFact(refreshed);
}
//# sourceMappingURL=extractedFactService.js.map

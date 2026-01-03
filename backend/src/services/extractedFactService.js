"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingExtractedTextError = exports.DocumentNotFoundError = void 0;
exports.getOrCreateExtractedFacts = getOrCreateExtractedFacts;
const prismaClient_1 = __importDefault(require("../prismaClient"));
const extractedFactsAnalyzer_1 = require("../ai/extractedFactsAnalyzer");
const client_1 = require("@prisma/client");
const extractedFactSchema_1 = require("../ai/extractedFactSchema");
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
function mapDbFact(fact) {
    return {
        id: fact.id,
        documentId: fact.documentId,
        type: fact.type,
        category: normalizeCategory(fact.category),
        label: fact.label,
        data: parseDataField(fact.data),
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
        aiFacts = await factAnalyzer({
            text: documentText,
            documentName: document.originalName,
            docType: document.docType,
            correlationId,
        });
    }
    catch (err) {
        const message = err?.message || "Unknown OpenAI analysis error";
        console.error("[extractedFactService] analysis failed", {
            correlationId,
            tenantId,
            documentId: document.id,
            message: message.slice(0, 300),
        });
        throw err;
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
//# sourceMappingURL=extractedFactService.js.map
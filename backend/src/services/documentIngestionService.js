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
exports.__test__ = void 0;
exports.ingestDocumentText = ingestDocumentText;
exports.enqueueDocumentIngestion = enqueueDocumentIngestion;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const pdf_parse_1 = require("pdf-parse");
const ExcelJS = __importStar(require("exceljs"));
const prismaClient_1 = __importDefault(require("../prismaClient"));
const crypto = __importStar(require("crypto"));
const documentIntelligenceService_1 = require("./documentIntelligenceService");
const documentTypeClassificationService_1 = require("./documentTypeClassificationService");
const s3Client_1 = require("../clients/s3Client");
const metrics_1 = require("../observability/metrics");
const documentIngestionQueue_1 = require("../queues/documentIngestionQueue");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const OCR_TESSERACT_MISSING_MESSAGE = "OCR indisponible (tesseract manquant). Consultez TROUBLESHOOTING.md#ocr-indisponible-tesseract-manquant pour l'installation.";
async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath, fs.constants.R_OK);
        return true;
    }
    catch (_err) {
        return false;
    }
}
async function resolveDocumentFilePath(doc) {
    const localPath = path.isAbsolute(doc.storagePath)
        ? doc.storagePath
        : path.join(process.cwd(), doc.storagePath);
    if (await fileExists(localPath)) {
        return { filePath: localPath, cleanup: async () => undefined };
    }
    const { bucket, key } = (0, s3Client_1.resolveBucketAndKey)(doc.storagePath, doc.tenantId, doc.storedName);
    const downloadPath = await (0, s3Client_1.downloadObjectToTempFile)(bucket, key, doc.storedName);
    return {
        filePath: downloadPath,
        cleanup: async () => {
            const directory = path.dirname(downloadPath);
            await fs.promises.rm(directory, { recursive: true, force: true });
        },
    };
}
const DEFAULT_SERVICE_TYPE = "DISCOVERED";
const DEFAULT_SERVICE_CRITICALITY = "MEDIUM";
const DEFAULT_DEPENDENCY_TYPE = "IMPLICIT_DOCUMENT";
const DEFAULT_INFRA_TYPE = "DISCOVERED";
function normalizeName(value) {
    return value.trim().replace(/\s+/g, " ");
}
function dedupePreserveCase(values) {
    const map = new Map();
    values
        .map((v) => normalizeName(v))
        .filter((v) => v.length > 0)
        .forEach((v) => {
        const key = v.toLowerCase();
        if (!map.has(key)) {
            map.set(key, v);
        }
    });
    return Array.from(map.values());
}
async function extractTextFromPdf(filePath) {
    const buffer = await fs.promises.readFile(filePath);
    const parser = new pdf_parse_1.PDFParse({ data: buffer });
    try {
        const data = await parser.getText();
        return data.text || "";
    }
    finally {
        await parser.destroy().catch(() => undefined);
    }
}
function normalizeSpreadsheetCellValue(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "object") {
        if ("text" in value && typeof value.text === "string") {
            return value.text;
        }
        if ("result" in value && value.result != null) {
            return String(value.result);
        }
        if ("formula" in value && typeof value.formula === "string") {
            return value.formula;
        }
    }
    return String(value);
}
async function extractTextWithOcr(filePath) {
    const enableOcr = String(process.env.ENABLE_OCR || "true").toLowerCase() === "true";
    if (!enableOcr) {
        throw new Error("OCR désactivé (ENABLE_OCR non défini)");
    }
    const ocrLangs = process.env.OCR_LANGS || "eng+fra";
    try {
        const { stdout } = await execFileAsync("tesseract", [filePath, "stdout", "-l", ocrLangs], {
            maxBuffer: 12 * 1024 * 1024,
        });
        return stdout.toString();
    }
    catch (err) {
        if ((err === null || err === void 0 ? void 0 : err.code) === "ENOENT") {
            throw new Error(OCR_TESSERACT_MISSING_MESSAGE);
        }
        throw err;
    }
}
async function extractTextFromXlsx(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const parts = [];
    workbook.eachSheet((sheet) => {
        parts.push(`# Feuille: ${sheet.name}`);
        sheet.eachRow((row) => {
            const rowValues = Array.isArray(row.values)
                ? row.values.slice(1)
                : Object.values(row.values || {});
            const line = rowValues.map((cell) => normalizeSpreadsheetCellValue(cell)).join(" | ");
            if (line.trim().length > 0) {
                parts.push(line);
            }
        });
    });
    return parts.join("\n");
}
async function extractTextFromPlain(filePath) {
    const data = await fs.promises.readFile(filePath, "utf8");
    return data;
}
function decodeXmlEntities(text) {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
async function unzipEntry(filePath, entryPath) {
    const { stdout } = await execFileAsync("unzip", ["-p", filePath, entryPath], {
        maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.toString();
}
async function listZipEntries(filePath) {
    const { stdout } = await execFileAsync("unzip", ["-Z1", filePath], {
        maxBuffer: 10 * 1024 * 1024,
    });
    return stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
async function extractTextFromDocx(filePath) {
    const xml = await unzipEntry(filePath, "word/document.xml");
    const matches = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g));
    const parts = matches.map((m) => decodeXmlEntities(m[1] || ""));
    return parts.join(" ").trim();
}
async function extractTextFromPptx(filePath) {
    const entries = await listZipEntries(filePath);
    const slideEntries = entries
        .filter((e) => e.startsWith("ppt/slides/slide") && e.endsWith(".xml"))
        .sort();
    const parts = [];
    for (const entry of slideEntries) {
        const xml = await unzipEntry(filePath, entry);
        const texts = Array.from(xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g)).map((m) => decodeXmlEntities(m[1] || ""));
        if (texts.length > 0) {
            parts.push(texts.join(" ").trim());
        }
    }
    return parts.join("\n").trim();
}
function isPlainTextExtension(ext) {
    const exts = [".txt", ".md", ".json", ".csv", ".log", ".yml", ".yaml"];
    return exts.includes(ext.toLowerCase());
}
function isDocxExtension(ext) {
    const exts = [".docx", ".docm"];
    return exts.includes(ext.toLowerCase());
}
function isPptxExtension(ext) {
    const exts = [".pptx", ".pptm"];
    return exts.includes(ext.toLowerCase());
}
function isExcelExtension(ext) {
    const exts = [".xlsx", ".xlsm", ".xlsb"];
    return exts.includes(ext.toLowerCase());
}
function parseCsvQuick(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0)
        return [];
    const headers = (lines[0] || "").split(/[,;\t]/).map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const values = line.split(/[,;\t]/).map((v) => v.trim());
        const row = {};
        headers.forEach((h, idx) => (row[h || `col_${idx}`] = values[idx] ?? ""));
        return row;
    });
}
function mergeMetadata(primary, secondary) {
    const merged = { ...primary };
    if (secondary?.services) {
        const dedup = new Set([...(primary.services || []), ...secondary.services]);
        merged.services = Array.from(dedup);
    }
    if (secondary?.slas) {
        const dedup = new Set([...(primary.slas || []), ...secondary.slas]);
        merged.slas = Array.from(dedup);
    }
    merged.rtoHours = primary.rtoHours || secondary.rtoHours;
    merged.rpoMinutes = primary.rpoMinutes || secondary.rpoMinutes;
    merged.mtpdHours = primary.mtpdHours || secondary.mtpdHours;
    merged.backupMentions = Array.from(new Set([...(primary.backupMentions || []), ...(secondary.backupMentions || [])]));
    merged.dependencies = Array.from(new Set([...(primary.dependencies || []), ...(secondary.dependencies || [])]));
    merged.structuredSummary = primary.structuredSummary || secondary.structuredSummary;
    return merged;
}
function expandDependencies(dependencies, anchors) {
    const seen = new Set();
    const expanded = [];
    const normalizedAnchors = dedupePreserveCase(anchors);
    for (const dep of dependencies) {
        const fromCandidates = dep.from ? [normalizeName(dep.from)] : normalizedAnchors;
        for (const anchor of fromCandidates) {
            if (!anchor || !dep.to)
                continue;
            const key = `${anchor.toLowerCase()}::${dep.to.toLowerCase()}::${dep.targetIsInfra ? "infra" : "service"}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            expanded.push({
                from: anchor,
                to: normalizeName(dep.to),
                targetIsInfra: dep.targetIsInfra,
            });
        }
    }
    return expanded;
}
async function ensureServices(tx, tenantId, serviceNames) {
    const cleanedNames = dedupePreserveCase(serviceNames);
    if (cleanedNames.length === 0)
        return new Map();
    const existing = await tx.service.findMany({
        where: { tenantId, name: { in: cleanedNames } },
    });
    const byKey = new Map();
    existing.forEach((svc) => byKey.set(svc.name.toLowerCase(), svc));
    for (const name of cleanedNames) {
        const key = name.toLowerCase();
        if (byKey.has(key))
            continue;
        const created = await tx.service.create({
            data: {
                tenantId,
                name,
                type: DEFAULT_SERVICE_TYPE,
                criticality: DEFAULT_SERVICE_CRITICALITY,
                description: "Créé automatiquement depuis l'ingestion de documents",
            },
        });
        byKey.set(key, created);
    }
    return byKey;
}
async function ensureInfraComponents(tx, tenantId, infraInputs) {
    const cleaned = dedupePreserveCase(infraInputs.map((i) => i.name));
    if (cleaned.length === 0)
        return new Map();
    const existing = await tx.infraComponent.findMany({
        where: { tenantId, name: { in: cleaned } },
    });
    const byKey = new Map();
    existing.forEach((infra) => byKey.set(infra.name.toLowerCase(), infra));
    for (const infraInput of infraInputs) {
        const name = normalizeName(infraInput.name);
        if (!name)
            continue;
        const key = name.toLowerCase();
        if (byKey.has(key))
            continue;
        const created = await tx.infraComponent.create({
            data: {
                tenantId,
                name,
                type: infraInput.type || DEFAULT_INFRA_TYPE,
                provider: infraInput.provider ?? null,
                notes: "Composant détecté automatiquement via ingestion de document",
            },
        });
        byKey.set(key, created);
    }
    return byKey;
}
async function ensureServiceInfraLinks(tx, tenantId, links, services, infraComponents) {
    if (links.length === 0)
        return;
    const existing = await tx.serviceInfraLink.findMany({
        where: { tenantId },
    });
    const existingKeys = new Set(existing.map((l) => `${l.serviceId}:${l.infraId}`));
    for (const link of links) {
        const service = services.get(link.serviceName.toLowerCase());
        const infra = infraComponents.get(link.infraName.toLowerCase());
        if (!service || !infra)
            continue;
        const key = `${service.id}:${infra.id}`;
        if (existingKeys.has(key))
            continue;
        await tx.serviceInfraLink.create({
            data: {
                tenantId,
                serviceId: service.id,
                infraId: infra.id,
            },
        });
        existingKeys.add(key);
    }
}
async function ensureServiceDependencies(tx, tenantId, dependencies, services) {
    if (dependencies.length === 0)
        return;
    const existing = await tx.serviceDependency.findMany({
        where: { tenantId },
    });
    const existingKeys = new Set(existing.map((d) => `${d.fromServiceId}:${d.toServiceId}`));
    for (const dep of dependencies) {
        const from = services.get(dep.from.toLowerCase());
        const to = services.get(dep.to.toLowerCase());
        if (!from || !to)
            continue;
        const key = `${from.id}:${to.id}`;
        if (existingKeys.has(key))
            continue;
        await tx.serviceDependency.create({
            data: {
                tenantId,
                fromServiceId: from.id,
                toServiceId: to.id,
                dependencyType: DEFAULT_DEPENDENCY_TYPE,
            },
        });
        existingKeys.add(key);
    }
}
async function ensureContinuityFromMetadata(tx, tenantId, services, metadata) {
    const hasContinuityData = metadata.rtoHours != null || metadata.rpoMinutes != null || metadata.mtpdHours != null;
    const slaNotes = Array.isArray(metadata.slas) && metadata.slas.length > 0
        ? `SLAs détectés: ${metadata.slas.join(" | ").slice(0, 600)}`
        : undefined;
    if (!hasContinuityData && !slaNotes)
        return;
    const serviceIds = Array.from(services.values()).map((s) => s.id);
    const existing = await tx.serviceContinuity.findMany({
        where: { serviceId: { in: serviceIds } },
    });
    const continuityByService = new Map(existing.map((c) => [c.serviceId, c]));
    for (const service of services.values()) {
        const existingContinuity = continuityByService.get(service.id);
        const data = {};
        if (metadata.rtoHours != null)
            data.rtoHours = metadata.rtoHours;
        if (metadata.rpoMinutes != null)
            data.rpoMinutes = metadata.rpoMinutes;
        if (metadata.mtpdHours != null)
            data.mtpdHours = metadata.mtpdHours;
        if (slaNotes) {
            data.notes = existingContinuity?.notes
                ? `${existingContinuity.notes}\n${slaNotes}`.slice(0, 1000)
                : slaNotes;
        }
        if (existingContinuity) {
            await tx.serviceContinuity.update({
                where: { serviceId: service.id },
                data,
            });
        }
        else if (metadata.rtoHours != null || metadata.rpoMinutes != null) {
            await tx.serviceContinuity.create({
                data: {
                    serviceId: service.id,
                    rtoHours: metadata.rtoHours ?? metadata.mtpdHours ?? 0,
                    rpoMinutes: metadata.rpoMinutes ?? 0,
                    mtpdHours: metadata.mtpdHours ?? metadata.rtoHours ?? 0,
                    notes: slaNotes ?? null,
                },
            });
        }
    }
}
async function ingestDocumentText(documentId, tenantId) {
    const doc = await prismaClient_1.default.document.findFirst({
        where: { id: documentId, tenantId },
    });
    if (!doc) {
        throw new Error("Document not found or not owned by tenant");
    }
    await prismaClient_1.default.document.updateMany({
        where: { id: doc.id, tenantId: doc.tenantId },
        data: { ingestionStatus: "PROCESSING", ingestionError: null },
    });
    const correlationId = `doc-${doc.id}`;
    const ext = path.extname(doc.originalName || "").toLowerCase();
    const mime = (doc.mimeType || "").toLowerCase();
    let text = "";
    let status = "SUCCESS";
    let error = null;
    let detectedDocType = null;
    let detectedMetadata = null;
    let textHash = null;
    let textExtractedAt = null;
    let mergedMetadata = null;
    let chunks = [];
    let ingestionError = null;
    const resolvedFile = await resolveDocumentFilePath({
        storagePath: doc.storagePath,
        tenantId: doc.tenantId,
        storedName: doc.storedName,
    });
    try {
        if (mime.startsWith("image/")) {
            text = await extractTextWithOcr(resolvedFile.filePath);
        }
        else if (mime === "application/pdf" || ext === ".pdf") {
            text = await extractTextFromPdf(resolvedFile.filePath);
            if (text.trim().length === 0) {
                text = await extractTextWithOcr(resolvedFile.filePath);
            }
        }
        else if (mime ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
            isDocxExtension(ext)) {
            text = await extractTextFromDocx(resolvedFile.filePath);
        }
        else if (mime ===
            "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
            isPptxExtension(ext)) {
            text = await extractTextFromPptx(resolvedFile.filePath);
        }
        else if (mime ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
            isExcelExtension(ext)) {
            text = await extractTextFromXlsx(resolvedFile.filePath);
        }
        else if (isPlainTextExtension(ext) || mime.startsWith("text/")) {
            text = await extractTextFromPlain(resolvedFile.filePath);
        }
        else {
            status = "UNSUPPORTED";
            error = `Type de document non supporté pour l'instant (mime=${mime}, ext=${ext})`;
        }
        if (status === "SUCCESS" && text.trim().length === 0) {
            status = "FAILED";
            error = "Aucun contenu extrait du document";
        }
        if (status === "SUCCESS") {
            textHash = crypto.createHash("sha256").update(text).digest("hex");
            textExtractedAt = new Date();
            const classification = await (0, documentTypeClassificationService_1.classifyDocumentTypeWithModel)({
                text,
                fileName: doc.originalName,
                providedDocType: doc.docType,
                correlationId,
            });
            detectedDocType = classification.type;
            const textMetadata = (0, documentIntelligenceService_1.extractDocumentMetadata)(text);
            let structuredPayload = null;
            if (ext === ".json") {
                try {
                    structuredPayload = JSON.parse(text);
                }
                catch (_err) {
                    structuredPayload = null;
                }
            }
            if (ext === ".csv") {
                structuredPayload = parseCsvQuick(text);
            }
            const structuredMetadata = structuredPayload
                ? (0, documentIntelligenceService_1.extractStructuredMetadata)(structuredPayload)
                : { services: [], slas: [] };
            mergedMetadata = mergeMetadata(textMetadata, structuredMetadata);
            detectedMetadata = (0, documentIntelligenceService_1.serializeMetadata)(mergedMetadata);
            const baseMetadata = {
                classification: classification.type,
                classificationConfidence: classification.confidence,
                declaredDocType: doc.docType,
                documentId: doc.id,
                tenantId,
                originalName: doc.originalName,
                normalizedDocType: (doc.docType || classification.type || "").toString().toUpperCase(),
            };
            chunks = (0, documentIntelligenceService_1.buildChunks)(text, baseMetadata);
        }
    }
    catch (e) {
        const message = e?.message || String(e);
        console.error("[documentIngestion] extraction error", {
            correlationId,
            tenantId,
            documentId: doc.id,
            message: message.slice(0, 300),
        });
        const errMessage = e?.message || String(e);
        const isOcrDisabled = errMessage.toLowerCase().includes("ocr") &&
            errMessage.toLowerCase().includes("désactivé");
        status = isOcrDisabled ? "UNSUPPORTED" : "FAILED";
        error = errMessage;
        ingestionError = errMessage;
    }
    finally {
        await resolvedFile.cleanup().catch(() => undefined);
    }
    const mapping = mergedMetadata ? (0, documentIntelligenceService_1.deriveMetadataMappings)(mergedMetadata) : { services: [], dependencies: [], infra: [] };
    const anchoredDependencies = expandDependencies(mapping.dependencies, mapping.services);
    const updatedAfterExtraction = await prismaClient_1.default.$transaction(async (tx) => {
        const services = await ensureServices(tx, tenantId, mapping.services);
        const infraComponents = await ensureInfraComponents(tx, tenantId, mapping.infra);
        await ensureServiceDependencies(tx, tenantId, anchoredDependencies.filter((d) => !d.targetIsInfra), services);
        await ensureServiceInfraLinks(tx, tenantId, anchoredDependencies
            .filter((d) => d.targetIsInfra)
            .map((d) => ({ serviceName: d.from, infraName: d.to })), services, infraComponents);
        await ensureContinuityFromMetadata(tx, tenantId, services, mergedMetadata || {});
        const ingestionStatusValue = status === "SUCCESS" ? "TEXT_EXTRACTED" : status === "UNSUPPORTED" ? "UNSUPPORTED" : "ERROR";
        const updateResult = await tx.document.updateMany({
            where: { id: doc.id, tenantId: doc.tenantId },
            data: {
                extractionStatus: status,
                extractionError: error,
                textContent: status === "SUCCESS" ? text : null,
                detectedDocType: detectedDocType,
                detectedMetadata: detectedMetadata,
                textHash,
                vectorizedAt: null,
                ingestionStatus: ingestionStatusValue,
                ingestionError,
                textExtractedAt: status === "SUCCESS" ? textExtractedAt : null,
            },
        });
        if (updateResult.count !== 1) {
            throw new Error("Failed to update document for this tenant");
        }
        return tx.document.findFirstOrThrow({
            where: { id: doc.id, tenantId: doc.tenantId },
        });
    });
    if (status !== "SUCCESS") {
        return updatedAfterExtraction;
    }
    if (chunks.length === 0) {
        await prismaClient_1.default.document.updateMany({
            where: { id: doc.id, tenantId: doc.tenantId },
            data: { ingestionError: "Vectorisation ignorée: aucun chunk généré" },
        });
        return prismaClient_1.default.document.findFirstOrThrow({ where: { id: doc.id, tenantId: doc.tenantId } });
    }
    try {
        const retentionUntil = doc.retentionUntil ?? null;
        const embeddingRetentionUntil = doc.embeddingRetentionUntil ?? null;
        const vecResult = await (0, documentIntelligenceService_1.pushChunksToChroma)(chunks, tenantId, doc.id, {
            document: retentionUntil,
            embedding: embeddingRetentionUntil,
        });
        if (vecResult.submitted > 0) {
            const updated = await prismaClient_1.default.document.updateMany({
                where: { id: doc.id, tenantId: doc.tenantId },
                data: {
                    vectorizedAt: new Date(),
                    ingestionStatus: "VECTORIZED",
                    ingestionError: null,
                },
            });
            if (updated.count !== 1) {
                throw new Error("Failed to update document after vectorization");
            }
        }
        else if (vecResult.skippedReason) {
            await prismaClient_1.default.document.updateMany({
                where: { id: doc.id, tenantId: doc.tenantId },
                data: { ingestionError: `Vectorisation ignorée: ${vecResult.skippedReason}`.slice(0, 255) },
            });
        }
    }
    catch (vecErr) {
        console.error("[documentIngestion] vectorization error", {
            correlationId,
            tenantId,
            documentId: doc.id,
            message: (vecErr?.message || "vectorization failed").slice(0, 200),
        });
        await prismaClient_1.default.document.updateMany({
            where: { id: doc.id, tenantId: doc.tenantId },
            data: {
                ingestionError: (vecErr?.message || "vectorization failed").slice(0, 255),
                ingestionStatus: "ERROR",
            },
        });
    }
    (0, metrics_1.recordExtractionResult)(status === "SUCCESS");
    return prismaClient_1.default.document.findFirstOrThrow({ where: { id: doc.id, tenantId: doc.tenantId } });
}
function resolveCallbackUrl() {
    if (process.env.N8N_INGESTION_CALLBACK_URL) {
        return process.env.N8N_INGESTION_CALLBACK_URL;
    }
    if (process.env.API_PUBLIC_URL) {
        return `${process.env.API_PUBLIC_URL.replace(/\/$/, "")}/webhooks/n8n/document-ingestion`;
    }
    return null;
}
async function enqueueDocumentIngestion(documentId, tenantId) {
    const queueMode = String(process.env.DOCUMENT_INGESTION_QUEUE_MODE || "bullmq").toLowerCase();
    const queueUrl = process.env.N8N_INGESTION_TRIGGER_URL;
    const doc = await prismaClient_1.default.document.findFirst({
        where: { id: documentId, tenantId },
    });
    if (!doc) {
        throw new Error("Document not found or not owned by tenant");
    }
    await prismaClient_1.default.document.updateMany({
        where: { id: doc.id, tenantId: doc.tenantId },
        data: {
            ingestionStatus: queueMode === "inline" ? "PROCESSING" : "QUEUED",
            ingestionQueuedAt: queueMode === "inline" ? null : new Date(),
            ingestionError: null,
            extractionStatus: "PENDING",
            extractionError: null,
        },
    });
    if (queueMode === "inline") {
        return ingestDocumentText(documentId, tenantId);
    }
    if (queueMode === "n8n") {
        if (!queueUrl) {
            throw new Error("N8N_INGESTION_TRIGGER_URL requis pour le mode n8n");
        }
        const headers = { "Content-Type": "application/json" };
        if (process.env.N8N_WEBHOOK_TOKEN) {
            headers["x-webhook-token"] = process.env.N8N_WEBHOOK_TOKEN;
        }
        const payload = {
            documentId: doc.id,
            tenantId,
            storagePath: doc.storagePath,
            mimeType: doc.mimeType,
            callbackUrl: resolveCallbackUrl(),
        };
        try {
            const response = await fetch(queueUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => response.statusText);
                throw new Error(`Queue dispatch failed: ${response.status} ${errText}`);
            }
        }
        catch (err) {
            const message = err?.message || "Queue dispatch failed";
            await prismaClient_1.default.document.updateMany({
                where: { id: doc.id, tenantId: doc.tenantId },
                data: { ingestionStatus: "ERROR", ingestionError: message.slice(0, 255) },
            });
            throw err;
        }
        return prismaClient_1.default.document.findFirstOrThrow({
            where: { id: doc.id, tenantId: doc.tenantId },
        });
    }
    try {
        await documentIngestionQueue_1.documentIngestionQueue.add("document-ingestion", {
            documentId: doc.id,
            tenantId,
        });
    }
    catch (err) {
        const message = err?.message || "Queue dispatch failed";
        await prismaClient_1.default.document.updateMany({
            where: { id: doc.id, tenantId: doc.tenantId },
            data: { ingestionStatus: "ERROR", ingestionError: message.slice(0, 255) },
        });
        throw err;
    }
    return prismaClient_1.default.document.findFirstOrThrow({
        where: { id: doc.id, tenantId: doc.tenantId },
    });
}
exports.__test__ = {
    extractTextFromPdf,
    extractTextFromDocx,
    extractTextFromPptx,
    decodeXmlEntities,
};
//# sourceMappingURL=documentIngestionService.js.map

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
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const crypto = __importStar(require("crypto"));
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const documentIngestionService_1 = require("../services/documentIngestionService");
const documentIngestionService_2 = require("../services/documentIngestionService");
const observability_1 = require("../config/observability");
const s3Client_1 = require("../clients/s3Client");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
async function computeFileHash(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}
function computeRetentionDate(days) {
    if (!Number.isFinite(days) || days <= 0)
        return null;
    const date = new Date();
    date.setDate(date.getDate() + Math.floor(days));
    return date;
}
/**
 * POST /documents
 * Upload d'un document pour le tenant courant.
 * Form-data attendu :
 *  - file: le fichier
 *  - docType?: string (ARCHI, CMDB, POLICY, ...)
 *  - description?: string
 */
router.post("/", (0, tenantMiddleware_1.requireRole)("OPERATOR"), upload.single("file"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            // Multer a déjà potentiellement écrit le fichier, on pourrait le supprimer ici si besoin
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        if (!req.file) {
            return res.status(400).json({ error: "Aucun fichier fourni" });
        }
        const { docType, description } = req.body || {};
        const file = req.file;
        const objectKey = (0, s3Client_1.buildObjectKey)(tenantId, file.originalname);
        const bucketAndKey = {
            bucket: (0, s3Client_1.getTenantBucketName)(tenantId),
            key: objectKey,
        };
        await (0, s3Client_1.uploadObjectToBucket)({
            bucket: bucketAndKey.bucket,
            key: bucketAndKey.key,
            body: file.buffer,
            contentType: file.mimetype,
        });
        const fileHash = await computeFileHash(file.buffer);
        const duplicate = await prismaClient_1.default.document.findFirst({
            where: { tenantId, fileHash },
        });
        if (duplicate) {
            return res.status(409).json({
                error: "Document déjà présent pour ce tenant (hash identique)",
                existingDocumentId: duplicate.id,
            });
        }
        const doc = await prismaClient_1.default.document.create({
            data: {
                tenantId,
                originalName: file.originalname,
                storedName: path_1.default.basename(objectKey),
                mimeType: file.mimetype,
                size: file.size,
                storagePath: `s3://${bucketAndKey.bucket}/${bucketAndKey.key}`,
                docType: docType ? String(docType).toUpperCase() : null,
                description: description ? String(description).trim() : null,
                fileHash,
                ingestionStatus: "FILE_STORED",
                retentionUntil: computeRetentionDate(observability_1.retentionConfig.documentRetentionDays),
                embeddingRetentionUntil: computeRetentionDate(observability_1.retentionConfig.embeddingRetentionDays),
            },
        });
        const signedUrl = await (0, s3Client_1.getSignedUrlForObject)(bucketAndKey.bucket, bucketAndKey.key);
        return res.status(201).json({ ...doc, signedUrl });
    }
    catch (error) {
        console.error("Error in POST /documents:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
/**
 * GET /documents
 * Liste des documents du tenant courant.
 */
router.get("/", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const docs = await prismaClient_1.default.document.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
        });
        const docsWithSignedPaths = await Promise.all(docs.map(async (doc) => {
            const isS3Path = (doc.storagePath || "").startsWith("s3://");
            if (!isS3Path) {
                return { ...doc, signedUrl: null };
            }
            try {
                const bucketAndKey = (0, s3Client_1.resolveBucketAndKey)(doc.storagePath, doc.tenantId, doc.storedName);
                const signedUrl = await (0, s3Client_1.getSignedUrlForObject)(bucketAndKey.bucket, bucketAndKey.key);
                return { ...doc, signedUrl };
            }
            catch (err) {
                console.error("Error signing document URL", {
                    tenantId: doc.tenantId,
                    documentId: doc.id,
                    message: err?.message,
                });
                return { ...doc, signedUrl: null };
            }
        }));
        return res.json(docsWithSignedPaths);
    }
    catch (error) {
        console.error("Error in GET /documents:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/:id/extract", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const docId = req.params.id;
        const updated = await (0, documentIngestionService_1.enqueueDocumentIngestion)(docId, tenantId);
        return res.json(updated);
    }
    catch (error) {
        console.error("Error in POST /documents/:id/extract:", error);
        return res
            .status(500)
            .json({ error: "Internal server error", details: error?.message });
    }
});
/**
 * POST /documents/extract-all-pending
 * Parcourt tous les documents PENDING du tenant et tente l'extraction.
 */
router.post("/extract-all-pending", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const pendingDocs = await prismaClient_1.default.document.findMany({
            where: {
                tenantId,
                extractionStatus: "PENDING",
            },
        });
        const results = [];
        for (const d of pendingDocs) {
            const updated = await (0, documentIngestionService_1.enqueueDocumentIngestion)(d.id, tenantId);
            results.push(updated);
        }
        return res.json({
            count: results.length,
            documents: results,
        });
    }
    catch (error) {
        console.error("Error in POST /documents/extract-all-pending:", error);
        return res
            .status(500)
            .json({ error: "Internal server error", details: error?.message });
    }
});
exports.default = router;
//# sourceMappingURL=documentRoutes.js.map

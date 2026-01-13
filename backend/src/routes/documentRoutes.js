"use strict";

const { Router } = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/tenantMiddleware");
const { enqueueDocumentIngestion } = require("../services/documentIngestionService");
const { retentionConfig } = require("../config/observability");
const { scanSensitiveDataOnUpload } = require("../services/sensitiveDataScanService");
const {
  buildValidationError,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredNumber,
  parseRequiredString,
} = require("../validation/common");
const {
  approveExtractionSuggestions,
  listExtractionSuggestions,
  rejectExtractionSuggestions,
} = require("../services/extractionSuggestionService");
const {
  DocumentClassificationDocumentNotFoundError,
  recordDocumentClassificationFeedback,
} = require("../services/documentClassificationFeedbackService");
const {
  buildObjectKey,
  getSignedUploadUrlForObject,
  getSignedUrlForObject,
  getTenantBucketName,
  resolveBucketAndKey,
  uploadObjectToBucket,
} = require("../clients/s3Client");

const router = Router();

const uploadDir = path.join(process.cwd(), "uploads", "documents");
fs.mkdirSync(uploadDir, { recursive: true });

const DEFAULT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];

const MAX_FILE_SIZE_BYTES = (() => {
  const value = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 25);
  return Math.max(1, Math.floor(value)) * 1024 * 1024;
})();

const MAX_FILE_COUNT = Math.max(1, Number(process.env.UPLOAD_MAX_FILES || 1));

const allowedMimeTypes = new Set(
  (process.env.UPLOAD_ALLOWED_MIME_TYPES || DEFAULT_ALLOWED_MIME_TYPES.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

function isAllowedMimeType(mimeType) {
  if (!mimeType) return false;
  return allowedMimeTypes.has(mimeType);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILE_COUNT },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedMimeType(file.mimetype)) {
      return cb(new Error("Type de fichier non autorisé"));
    }
    return cb(null, true);
  },
});

function runSingleUpload(req, res) {
  return new Promise((resolve) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        const message =
          err instanceof multer.MulterError
            ? "Fichier invalide (taille ou format non autorisé)"
            : err.message || "Fichier invalide";
        res.status(400).json({ error: message });
        return resolve();
      }
      return resolve();
    });
  });
}

async function computeFileHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function computeRetentionDate(days) {
  if (!Number.isFinite(days) || days <= 0) return null;
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
router.post("/", requireRole("OPERATOR"), async (req, res) => {
  try {
    await runSingleUpload(req, res);
    if (res.headersSent) return;

    const tenantId = req.tenantId;
    if (!tenantId) {
      // Multer a déjà potentiellement écrit le fichier, on pourrait le supprimer ici si besoin
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier fourni" });
    }

    if (!isAllowedMimeType(req.file.mimetype)) {
      return res.status(400).json({ error: "Type de fichier non autorisé" });
    }

    if (req.file.size > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: "Taille de fichier dépassée" });
    }

    const payload = req.body || {};
    const issues = [];
    const docType = parseOptionalString(payload.docType, "docType", issues, {
      allowNull: true,
    });
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const file = req.file;
    const filePath = file.path;
    let fileBuffer = null;

    try {
      fileBuffer = await fs.promises.readFile(filePath);

      const scanResult = await scanSensitiveDataOnUpload({
        buffer: fileBuffer,
        fileName: file.originalname,
        mimeType: file.mimetype,
      });
      if (scanResult.blockedTypes.length > 0) {
        return res.status(422).json({
          error: "Document contenant des données sensibles non autorisées",
          blockedTypes: scanResult.blockedTypes,
          findings: scanResult.findings,
        });
      }

      const objectKey = buildObjectKey(tenantId, file.originalname);
      const bucketAndKey = {
        bucket: getTenantBucketName(tenantId),
        key: objectKey,
      };

      await uploadObjectToBucket({
        bucket: bucketAndKey.bucket,
        key: bucketAndKey.key,
        body: fileBuffer,
        contentType: file.mimetype,
      });

      const fileHash = await computeFileHash(fileBuffer);
      const duplicate = await prisma.document.findFirst({
        where: { tenantId, fileHash },
      });
      if (duplicate) {
        return res.status(409).json({
          error: "Document déjà présent pour ce tenant (hash identique)",
          existingDocumentId: duplicate.id,
        });
      }

      const doc = await prisma.document.create({
        data: {
          tenantId,
          originalName: file.originalname,
          storedName: path.basename(objectKey),
          mimeType: file.mimetype,
          size: file.size,
          storagePath: `s3://${bucketAndKey.bucket}/${bucketAndKey.key}`,
          docType: docType ? docType.toUpperCase() : null,
          description,
          fileHash,
          ingestionStatus: "FILE_STORED",
          retentionUntil: computeRetentionDate(retentionConfig.documentRetentionDays),
          embeddingRetentionUntil: computeRetentionDate(retentionConfig.embeddingRetentionDays),
        },
      });

      const signedUrl = await getSignedUrlForObject(bucketAndKey.bucket, bucketAndKey.key);

      return res.status(201).json({ ...doc, signedUrl });
    } finally {
      if (filePath) {
        await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
      }
    }
  } catch (error) {
    console.error("Error in POST /documents:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /documents/presign
 * Retourne une URL signée pour uploader directement sur S3.
 */
router.post("/presign", requireRole("OPERATOR"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues = [];
    const fileName = parseRequiredString(payload.fileName, "fileName", issues);
    const mimeType = parseRequiredString(payload.mimeType, "mimeType", issues);
    const size = parseRequiredNumber(payload.size, "size", issues, { min: 1 });

    if (mimeType && !isAllowedMimeType(mimeType)) {
      issues.push({ field: "mimeType", message: "type de fichier non autorisé" });
    }

    if (size && size > MAX_FILE_SIZE_BYTES) {
      issues.push({ field: "size", message: "taille maximale dépassée" });
    }

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const objectKey = buildObjectKey(tenantId, fileName);
    const bucket = getTenantBucketName(tenantId);
    const { url, expiresIn } = await getSignedUploadUrlForObject(bucket, objectKey, mimeType);

    return res.status(201).json({
      uploadUrl: url,
      expiresIn,
      bucket,
      key: objectKey,
      storagePath: `s3://${bucket}/${objectKey}`,
    });
  } catch (error) {
    console.error("Error in POST /documents/presign:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /documents
 * Liste des documents du tenant courant.
 */
router.get("/", requireRole("READER"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues = [];
    const limit = parseOptionalNumber(req.query.limit, "limit", issues, { min: 1 });
    const offset = parseOptionalNumber(req.query.offset, "offset", issues, { min: 0 });
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const shouldPaginate = limit !== undefined || offset !== undefined;
    const take = limit ?? 25;
    const skip = offset ?? 0;

    const [docs, total] = await Promise.all([
      prisma.document.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        ...(shouldPaginate ? { take, skip } : {}),
      }),
      shouldPaginate ? prisma.document.count({ where: { tenantId } }) : Promise.resolve(0),
    ]);

    const docsWithSignedPaths = await Promise.all(
      docs.map(async (doc) => {
        const isS3Path = (doc.storagePath || "").startsWith("s3://");
        if (!isS3Path) {
          return { ...doc, signedUrl: null };
        }

        try {
          const bucketAndKey = resolveBucketAndKey(doc.storagePath, doc.tenantId, doc.storedName);
          const signedUrl = await getSignedUrlForObject(bucketAndKey.bucket, bucketAndKey.key);
          return { ...doc, signedUrl };
        } catch (err) {
          console.error("Error signing document URL", {
            tenantId: doc.tenantId,
            documentId: doc.id,
            message: err?.message,
          });
          return { ...doc, signedUrl: null };
        }
      })
    );

    if (shouldPaginate) {
      return res.json({
        items: docsWithSignedPaths,
        total,
        limit: take,
        offset: skip,
      });
    }

    return res.json(docsWithSignedPaths);
  } catch (error) {
    console.error("Error in GET /documents:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /documents/:id
 * Met à jour les métadonnées (docType, description) d'un document.
 */
router.put("/:id", requireRole("OPERATOR"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const docId = req.params.id;
    const payload = req.body || {};
    const issues = [];
    const docType = parseOptionalString(payload.docType, "docType", issues, {
      allowNull: true,
    });
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const doc = await prisma.document.findFirst({ where: { id: docId, tenantId } });
    if (!doc) {
      return res.status(404).json({ error: "Document introuvable pour ce tenant" });
    }

    const data = {};
    if (docType !== undefined) {
      data.docType = docType ? docType.toUpperCase() : null;
    }
    if (description !== undefined) {
      data.description = description;
    }

    const updated = await prisma.document.update({
      where: { id: docId },
      data,
    });

    return res.json(updated);
  } catch (error) {
    console.error("Error in PUT /documents/:id:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /documents/:id/classification-feedback
 * Enregistre un feedback utilisateur sur la classification ML du document.
 */
router.post("/:id/classification-feedback", requireRole("OPERATOR"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const docId = req.params.id;
    const issues = [];
    const correctedType = parseRequiredString(req.body?.correctedType, "correctedType", issues);
    const notes = parseOptionalString(req.body?.notes, "notes", issues, { allowNull: true });

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const feedback = await recordDocumentClassificationFeedback({
      tenantId,
      documentId: docId,
      correctedType: correctedType,
      notes,
    });

    return res.json({ documentId: docId, feedback });
  } catch (error) {
    if (error instanceof DocumentClassificationDocumentNotFoundError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Error in POST /documents/:id/classification-feedback:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /documents/:id
 * Supprime un document et ses faits extraits.
 */
router.delete("/:id", requireRole("OPERATOR"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const docId = req.params.id;
    const doc = await prisma.document.findFirst({ where: { id: docId, tenantId } });
    if (!doc) {
      return res.status(404).json({ error: "Document introuvable pour ce tenant" });
    }

    await prisma.$transaction([
      prisma.extractedFact.deleteMany({ where: { tenantId, documentId: docId } }),
      prisma.document.deleteMany({ where: { id: docId, tenantId } }),
    ]);

    return res.status(204).send();
  } catch (error) {
    console.error("Error in DELETE /documents/:id:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/extraction-suggestions", requireRole("OPERATOR"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues = [];
    const docId = parseRequiredString(req.params.id, "id", issues);
    const status = parseOptionalString(req.query.status, "status", issues, {
      allowNull: true,
    });
    if (status && !["PENDING", "APPROVED", "REJECTED"].includes(status.toUpperCase())) {
      issues.push({ field: "status", message: "Statut invalide" });
    }
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const doc = await prisma.document.findFirst({ where: { id: docId, tenantId } });
    if (!doc) {
      return res.status(404).json({ error: "Document introuvable pour ce tenant" });
    }

    const suggestions = await listExtractionSuggestions({
      tenantId,
      documentId: docId,
      status: status ? status.toUpperCase() : null,
    });

    return res.json({ documentId: docId, suggestions });
  } catch (error) {
    console.error("Error in GET /documents/:id/extraction-suggestions:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/extraction-suggestions/approve", requireRole("OPERATOR"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues = [];
    const docId = parseRequiredString(req.params.id, "id", issues);
    const reviewNotes = parseOptionalString(req.body?.reviewNotes, "reviewNotes", issues, {
      allowNull: true,
    });
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const doc = await prisma.document.findFirst({ where: { id: docId, tenantId } });
    if (!doc) {
      return res.status(404).json({ error: "Document introuvable pour ce tenant" });
    }

    const suggestionIds = Array.isArray(req.body?.suggestionIds)
      ? req.body.suggestionIds.filter((id) => typeof id === "string")
      : [];

    const result = await approveExtractionSuggestions({
      tenantId,
      documentId: docId,
      suggestionIds: suggestionIds.length > 0 ? suggestionIds : undefined,
      reviewNotes,
    });

    return res.json(result);
  } catch (error) {
    console.error("Error in POST /documents/:id/extraction-suggestions/approve:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/extraction-suggestions/reject", requireRole("OPERATOR"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues = [];
    const docId = parseRequiredString(req.params.id, "id", issues);
    const reviewNotes = parseOptionalString(req.body?.reviewNotes, "reviewNotes", issues, {
      allowNull: true,
    });
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const doc = await prisma.document.findFirst({ where: { id: docId, tenantId } });
    if (!doc) {
      return res.status(404).json({ error: "Document introuvable pour ce tenant" });
    }

    const suggestionIds = Array.isArray(req.body?.suggestionIds)
      ? req.body.suggestionIds.filter((id) => typeof id === "string")
      : [];

    const result = await rejectExtractionSuggestions({
      tenantId,
      documentId: docId,
      suggestionIds: suggestionIds.length > 0 ? suggestionIds : undefined,
      reviewNotes,
    });

    return res.json(result);
  } catch (error) {
    console.error("Error in POST /documents/:id/extraction-suggestions/reject:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /documents/:id/ingest
 * Relance l'ingestion d'un document existant.
 */
router.post("/:id/ingest", requireRole("OPERATOR"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues = [];
    const docId = parseRequiredString(req.params.id, "id", issues);
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const doc = await prisma.document.findFirst({ where: { id: docId, tenantId } });
    if (!doc) {
      return res.status(404).json({ error: "Document introuvable pour ce tenant" });
    }

    const job = await enqueueDocumentIngestion({
      tenantId,
      documentId: docId,
      priority: req.body?.priority,
    });

    return res.status(202).json({ documentId: docId, jobId: job.id });
  } catch (error) {
    console.error("Error in POST /documents/:id/ingest:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

exports.default = router;

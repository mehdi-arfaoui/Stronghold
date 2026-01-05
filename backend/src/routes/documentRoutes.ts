import { Router } from "express";
import multer from "multer";
import path from "path";
import * as crypto from "crypto";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import { enqueueDocumentIngestion } from "../services/documentIngestionService";
import { ingestDocumentText } from "../services/documentIngestionService";
import { retentionConfig } from "../config/observability";
import {
  buildValidationError,
  parseOptionalString,
  parseRequiredString,
} from "../validation/common";

import {
  buildObjectKey,
  getSignedUrlForObject,
  getTenantBucketName,
  resolveBucketAndKey,
  uploadObjectToBucket,
} from "../clients/s3Client";

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

async function computeFileHash(buffer: Buffer): Promise<string> {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function computeRetentionDate(days: number): Date | null {
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
router.post(
  "/",
  requireRole("OPERATOR"),
  upload.single("file"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        // Multer a déjà potentiellement écrit le fichier, on pourrait le supprimer ici si besoin
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Aucun fichier fourni" });
      }

      const payload = req.body || {};
      const issues: { field: string; message: string }[] = [];
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
      const objectKey = buildObjectKey(tenantId, file.originalname);
      const bucketAndKey = {
        bucket: getTenantBucketName(tenantId),
        key: objectKey,
      };

      await uploadObjectToBucket({
        bucket: bucketAndKey.bucket,
        key: bucketAndKey.key,
        body: file.buffer,
        contentType: file.mimetype,
      });

      const fileHash = await computeFileHash(file.buffer);
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
    } catch (error) {
      console.error("Error in POST /documents:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * GET /documents
 * Liste des documents du tenant courant.
 */
router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const docs = await prisma.document.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

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
        } catch (err: any) {
          console.error("Error signing document URL", {
            tenantId: doc.tenantId,
            documentId: doc.id,
            message: err?.message,
          });
          return { ...doc, signedUrl: null };
        }
      })
    );

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
router.put("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const docId = req.params.id;
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
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

    const data: any = {};
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
 * DELETE /documents/:id
 * Supprime un document et ses faits extraits.
 */
router.delete("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
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



router.post("/:id/extract", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues: { field: string; message: string }[] = [];
    const docId = parseRequiredString(req.params.id, "id", issues);
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const updated = await enqueueDocumentIngestion(docId, tenantId);
    return res.json(updated);
  } catch (error: any) {
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
router.post("/extract-all-pending", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const pendingDocs = await prisma.document.findMany({
      where: {
        tenantId,
        extractionStatus: "PENDING",
      },
    });

    const results = [];
    for (const d of pendingDocs) {
      const updated = await enqueueDocumentIngestion(d.id, tenantId);
      results.push(updated);
    }

    return res.json({
      count: results.length,
      documents: results,
    });
  } catch (error: any) {
    console.error("Error in POST /documents/extract-all-pending:", error);
    return res
      .status(500)
      .json({ error: "Internal server error", details: error?.message });
  }
});

export default router;

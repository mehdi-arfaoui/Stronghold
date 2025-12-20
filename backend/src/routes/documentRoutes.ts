import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest } from "../middleware/tenantMiddleware";
import { ingestDocumentText } from "../services/documentIngestionService";
import multer from "multer";
import path from "path";
import {
  buildObjectKey,
  getSignedUrlForObject,
  getTenantBucketName,
  resolveBucketAndKey,
  uploadObjectToBucket,
} from "../clients/s3Client";

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

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

      const { docType, description } = req.body || {};
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

      const doc = await prisma.document.create({
        data: {
          tenantId,
          originalName: file.originalname,
          storedName: path.basename(objectKey),
          mimeType: file.mimetype,
          size: file.size,
          storagePath: `s3://${bucketAndKey.bucket}/${bucketAndKey.key}`,
          docType: docType ? String(docType).toUpperCase() : null,
          description: description ? String(description).trim() : null,
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



router.post("/:id/extract", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const docId = req.params.id;

    const updated = await ingestDocumentText(docId, tenantId);
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
router.post("/extract-all-pending", async (req: TenantRequest, res) => {
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
      const updated = await ingestDocumentText(d.id, tenantId);
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

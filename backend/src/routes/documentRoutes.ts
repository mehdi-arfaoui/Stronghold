import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import prisma from "../prismaClient";
import { TenantRequest } from "../middleware/tenantMiddleware";
import { ingestDocumentText } from "../services/documentIngestionService";

const router = Router();

// Répertoire de stockage local des fichiers
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

// S'assurer que le dossier existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Config Multer : stockage disque
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    // on évite les collisions avec un préfixe cuid-like
    const uniquePrefix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${uniquePrefix}-${safeName}`);
  },
});

const upload = multer({ storage });

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

      const doc = await prisma.document.create({
        data: {
          tenantId,
          originalName: file.originalname,
          storedName: file.filename,
          mimeType: file.mimetype,
          size: file.size,
          storagePath: path.relative(process.cwd(), file.path),
          docType: docType ? String(docType).toUpperCase() : null,
          description: description ? String(description).trim() : null,
        },
      });

      return res.status(201).json(doc);
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

    return res.json(docs);
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



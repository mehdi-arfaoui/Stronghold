import { Router } from "express";
import multer from "multer";
import * as os from "os";
import path from "path";
import * as fs from "fs";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { requireValidLicense, requireFeature, requireQuota, incrementQuotaOnSuccess } from "../middleware/licenseMiddleware.js";
import { generateRunbook } from "../services/runbookGenerator.js";
import {
  buildValidationError,
  parseOptionalString,
  parseRequiredNumber,
  parseRequiredString,
} from "../validation/common.js";
import {
  computeFileHash,
  detectTemplateFormat,
  sanitizeTemplateDescription,
} from "../services/runbookTemplateService.js";
import {
  buildObjectKey,
  getSignedUploadUrlForObject,
  getSignedUrlForObject,
  getTenantBucketName,
  resolveBucketAndKey,
  uploadFileToBucket,
} from "../clients/s3Client.js";

const router = Router();

// Apply license validation to all runbook routes
router.use(requireValidLicense());
router.use(requireFeature("pra"));

const uploadDir = path.join(os.tmpdir(), "runbook-templates");
fs.mkdirSync(uploadDir, { recursive: true });

const DEFAULT_ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "text/markdown",
];

const MAX_TEMPLATE_SIZE_BYTES = (() => {
  const value = Number(process.env.RUNBOOK_TEMPLATE_MAX_FILE_SIZE_MB || 10);
  return Math.max(1, Math.floor(value)) * 1024 * 1024;
})();

const directUploadsEnabled =
  String(process.env.RUNBOOK_TEMPLATE_DIRECT_UPLOADS_ENABLED || "false").toLowerCase() === "true";

const allowedMimeTypes = new Set(
  (process.env.RUNBOOK_TEMPLATE_ALLOWED_MIME_TYPES || DEFAULT_ALLOWED_MIME_TYPES.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

function isAllowedMimeType(mimeType?: string | null) {
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
  limits: { fileSize: MAX_TEMPLATE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedMimeType(file.mimetype)) {
      return cb(new Error("Type de fichier non autorisé"));
    }
    return cb(null, true);
  },
});

function runTemplateUpload(req: any, res: any): Promise<void> {
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

async function withDownloadUrls(runbook: any) {
  const downloadUrls: Record<string, string | null> = { pdf: null, docx: null, markdown: null };

  if (runbook.pdfPath) {
    const { bucket, key } = resolveBucketAndKey(runbook.pdfPath, runbook.tenantId, undefined);
    downloadUrls.pdf = await getSignedUrlForObject(bucket, key).catch(() => null);
  }
  if (runbook.docxPath) {
    const { bucket, key } = resolveBucketAndKey(runbook.docxPath, runbook.tenantId, undefined);
    downloadUrls.docx = await getSignedUrlForObject(bucket, key).catch(() => null);
  }
  if (runbook.markdownPath) {
    const { bucket, key } = resolveBucketAndKey(runbook.markdownPath, runbook.tenantId, undefined);
    downloadUrls.markdown = await getSignedUrlForObject(bucket, key).catch(() => null);
  }

  return { ...runbook, downloadUrls };
}

router.post("/templates", async (req: TenantRequest, res) => {
  try {
    if (!directUploadsEnabled) {
      return res.status(409).json({
        error: "Uploads directs désactivés",
        details: [
          {
            field: "upload",
            message: "Utilisez /runbooks/templates/presign puis /runbooks/templates/register.",
          },
        ],
      });
    }

    await runTemplateUpload(req, res);
    if (res.headersSent) return;

    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });
    if (!req.file) return res.status(400).json({ error: "Aucun fichier fourni" });

    const file = req.file;
    const format = detectTemplateFormat(file.mimetype, file.originalname);
    if (!format) {
      return res
        .status(415)
        .json({ error: "Format non supporté. Utilisez DOCX, ODT ou Markdown." });
    }

    try {
      const fileHash = await computeFileHash(file.path);
      const duplicate = await prisma.runbookTemplate.findFirst({ where: { tenantId, fileHash } });
      if (duplicate) {
        return res
          .status(409)
          .json({ error: "Template déjà importé pour ce tenant", templateId: duplicate.id });
      }

      const bucket = getTenantBucketName(tenantId);
      const key = buildObjectKey(tenantId, `runbook-template-${file.originalname}`);
      await uploadFileToBucket({
        bucket,
        key,
        filePath: file.path,
        contentType: file.mimetype,
      });

      const template = await prisma.runbookTemplate.create({
        data: {
          tenantId,
          originalName: file.originalname,
          storedName: key.split("/").pop() || file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storagePath: `s3://${bucket}/${key}`,
          format,
          description: sanitizeTemplateDescription((req.body || {}).description),
          fileHash,
        },
      });

      const signedUrl = await getSignedUrlForObject(bucket, key);
      return res.status(201).json({ ...template, signedUrl });
    } finally {
      if (file?.path) {
        await fs.promises.rm(file.path, { force: true }).catch(() => undefined);
      }
    }
    } catch (error: any) {
      console.error("Error uploading runbook template", { message: error?.message });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

router.post("/templates/presign", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const fileName = parseRequiredString(payload.fileName, "fileName", issues);
    const mimeType = parseRequiredString(payload.mimeType, "mimeType", issues);
    const size = parseRequiredNumber(payload.size, "size", issues, { min: 1 });

    if (mimeType && !isAllowedMimeType(mimeType)) {
      issues.push({ field: "mimeType", message: "type de fichier non autorisé" });
    }

    if (size && size > MAX_TEMPLATE_SIZE_BYTES) {
      issues.push({ field: "size", message: "taille maximale dépassée" });
    }

    const format = detectTemplateFormat(mimeType as string, fileName as string);
    if (!format) {
      issues.push({
        field: "fileName",
        message: "Format non supporté. Utilisez DOCX, ODT ou Markdown.",
      });
    }

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const bucket = getTenantBucketName(tenantId);
    const key = buildObjectKey(tenantId, `runbook-template-${fileName}`);
    const { url, expiresIn } = await getSignedUploadUrlForObject(
      bucket,
      key,
      mimeType as string
    );

    return res.status(201).json({
      uploadUrl: url,
      expiresIn,
      bucket,
      key,
      storagePath: `s3://${bucket}/${key}`,
      format,
    });
  } catch (error: any) {
    console.error("Error in POST /runbooks/templates/presign:", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/templates/register", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const fileName = parseRequiredString(payload.fileName, "fileName", issues);
    const mimeType = parseRequiredString(payload.mimeType, "mimeType", issues);
    const size = parseRequiredNumber(payload.size, "size", issues, { min: 1 });
    const storagePath = parseRequiredString(payload.storagePath, "storagePath", issues);
    const fileHash = parseRequiredString(payload.fileHash, "fileHash", issues, { minLength: 8 });
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });

    if (mimeType && !isAllowedMimeType(mimeType)) {
      issues.push({ field: "mimeType", message: "type de fichier non autorisé" });
    }

    if (size && size > MAX_TEMPLATE_SIZE_BYTES) {
      issues.push({ field: "size", message: "taille maximale dépassée" });
    }

    const format = fileName && mimeType ? detectTemplateFormat(mimeType, fileName) : null;
    if (!format) {
      issues.push({
        field: "fileName",
        message: "Format non supporté. Utilisez DOCX, ODT ou Markdown.",
      });
    }

    if (
      issues.length > 0 ||
      !fileName ||
      !mimeType ||
      size === undefined ||
      !storagePath ||
      !fileHash ||
      !format
    ) {
      return res.status(400).json(buildValidationError(issues));
    }

    const { bucket, key } = resolveBucketAndKey(storagePath, tenantId);
    const duplicate = await prisma.runbookTemplate.findFirst({
      where: { tenantId, fileHash: String(fileHash) },
    });
    if (duplicate) {
      return res
        .status(409)
        .json({ error: "Template déjà importé pour ce tenant", templateId: duplicate.id });
    }

    const template = await prisma.runbookTemplate.create({
      data: {
        tenantId,
        originalName: fileName,
        storedName: path.basename(key || fileName),
        mimeType: mimeType,
        size: size,
        storagePath: `s3://${bucket}/${key}`,
        format,
        description: sanitizeTemplateDescription(description),
        fileHash: String(fileHash),
      },
    });

    const signedUrl = await getSignedUrlForObject(bucket, key);
    return res.status(201).json({ ...template, signedUrl });
  } catch (error: any) {
    console.error("Error in POST /runbooks/templates/register:", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/templates", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const templates = await prisma.runbookTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    const enriched = await Promise.all(
      templates.map(async (tpl) => {
        try {
          const { bucket, key } = resolveBucketAndKey(tpl.storagePath, tpl.tenantId, tpl.storedName);
          const signedUrl = await getSignedUrlForObject(bucket, key);
          return { ...tpl, signedUrl };
        } catch (_err) {
          return { ...tpl, signedUrl: null };
        }
      })
    );

    return res.json(enriched);
  } catch (error: any) {
    console.error("Error listing runbook templates", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/templates/:id", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const templateId = req.params.id;
    if (!templateId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const tpl = await prisma.runbookTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!tpl) return res.status(404).json({ error: "Template introuvable" });

    let signedUrl: string | null = null;
    try {
      const { bucket, key } = resolveBucketAndKey(tpl.storagePath, tpl.tenantId, tpl.storedName);
      signedUrl = await getSignedUrlForObject(bucket, key);
    } catch (_err) {
      signedUrl = null;
    }

    return res.json({ ...tpl, signedUrl });
  } catch (error: any) {
    console.error("Error fetching runbook template", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/templates/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const templateId = req.params.id;
    if (!templateId) {
      return res.status(400).json({ error: "id est requis" });
    }
    const { description } = req.body || {};

    const template = await prisma.runbookTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!template) {
      return res.status(404).json({ error: "Template introuvable" });
    }

    const updated = await prisma.runbookTemplate.update({
      where: { id: templateId },
      data: {
        description: description ? String(description).trim() : null,
      },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error("Error updating runbook template", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/templates/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const templateId = req.params.id;
    if (!templateId) {
      return res.status(400).json({ error: "id est requis" });
    }
    const template = await prisma.runbookTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!template) {
      return res.status(404).json({ error: "Template introuvable" });
    }

    await prisma.$transaction([
      prisma.runbook.updateMany({
        where: { tenantId, templateId },
        data: { templateId: null },
      }),
      prisma.runbookTemplate.deleteMany({ where: { id: templateId, tenantId } }),
    ]);

    return res.status(204).send();
  } catch (error: any) {
    console.error("Error deleting runbook template", { message: error?.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const runbooks = await prisma.runbook.findMany({
      where: { tenantId },
      orderBy: { generatedAt: "desc" },
    });
    const enriched = await Promise.all(runbooks.map((rb) => withDownloadUrls(rb)));
    return res.json(enriched);
  } catch (error) {
    console.error("Error fetching runbooks", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const runbookId = req.params.id;
    if (!runbookId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const runbook = await prisma.runbook.findFirst({ where: { id: runbookId, tenantId } });
    if (!runbook) return res.status(404).json({ error: "Runbook introuvable" });

    const enriched = await withDownloadUrls(runbook);
    return res.json(enriched);
  } catch (error) {
    console.error("Error fetching runbook", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const runbookId = req.params.id;
    if (!runbookId) {
      return res.status(400).json({ error: "id est requis" });
    }
    const { title, summary, status } = req.body || {};

    const runbook = await prisma.runbook.findFirst({ where: { id: runbookId, tenantId } });
    if (!runbook) {
      return res.status(404).json({ error: "Runbook introuvable" });
    }

    const data: any = {};
    if (title !== undefined) {
      if (!title || typeof title !== "string") {
        return res.status(400).json({ error: "title est requis" });
      }
      data.title = title.trim();
    }
    if (summary !== undefined) {
      data.summary = summary ? String(summary).trim() : null;
    }
    if (status !== undefined) {
      data.status = status ? String(status).trim() : "DRAFT";
    }

    const updated = await prisma.runbook.update({
      where: { id: runbookId },
      data,
    });

    return res.json(updated);
  } catch (error) {
    console.error("Error updating runbook", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const runbookId = req.params.id;
    if (!runbookId) {
      return res.status(400).json({ error: "id est requis" });
    }
    const runbook = await prisma.runbook.findFirst({ where: { id: runbookId, tenantId } });
    if (!runbook) {
      return res.status(404).json({ error: "Runbook introuvable" });
    }

    await prisma.runbook.deleteMany({ where: { id: runbookId, tenantId } });
    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting runbook", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/generate", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const { scenarioId, title, summary, owner, templateId } = req.body || {};
    if (scenarioId) {
      const scenario = await prisma.scenario.findFirst({ where: { id: scenarioId, tenantId } });
      if (!scenario) {
        return res.status(404).json({ error: "Scénario introuvable pour ce tenant" });
      }
    }

    const output = await generateRunbook(tenantId, { scenarioId, title, summary, owner, templateId });
    const enriched = await withDownloadUrls(output.runbook);
    return res.status(201).json({ ...output, runbook: enriched });
  } catch (error: any) {
    console.error("Error generating runbook", {
      message: error?.message,
    });
    return res.status(500).json({ error: "Internal server error", details: error?.message });
  }
});

export default router;

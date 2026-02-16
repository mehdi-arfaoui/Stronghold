import { appLogger } from "../utils/logger.js";
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
import { RunbookGeneratorService } from "../services/runbook-generator.service.js";
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
      return cb(new Error("Type de fichier non autorisÃ©"));
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
            ? "Fichier invalide (taille ou format non autorisÃ©)"
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

function parseRunbookDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function buildRunbookUpdateData(payload: Record<string, unknown>): {
  data: Record<string, unknown>;
  error?: string;
} {
  const data: Record<string, unknown> = {};

  if (payload.title !== undefined) {
    if (typeof payload.title !== "string" || payload.title.trim().length === 0) {
      return { data: {}, error: "title est requis" };
    }
    data.title = payload.title.trim();
  }

  if (payload.summary !== undefined) {
    data.summary =
      typeof payload.summary === "string" && payload.summary.trim().length > 0
        ? payload.summary.trim()
        : null;
  }

  if (payload.description !== undefined) {
    data.description =
      typeof payload.description === "string" && payload.description.trim().length > 0
        ? payload.description.trim()
        : null;
  }

  if (payload.status !== undefined) {
    data.status =
      typeof payload.status === "string" && payload.status.trim().length > 0
        ? payload.status.trim().toLowerCase()
        : "draft";
  }

  if (payload.steps !== undefined) {
    const isJsonCompatible =
      Array.isArray(payload.steps) ||
      (payload.steps !== null && typeof payload.steps === "object");
    if (!isJsonCompatible) {
      return { data: {}, error: "steps doit etre un objet ou un tableau JSON" };
    }
    data.steps = payload.steps;
  }

  if (payload.recommendationId !== undefined) {
    data.recommendationId =
      typeof payload.recommendationId === "string" && payload.recommendationId.trim().length > 0
        ? payload.recommendationId.trim()
        : null;
  }

  if (payload.responsible !== undefined) {
    data.responsible =
      typeof payload.responsible === "string" && payload.responsible.trim().length > 0
        ? payload.responsible.trim()
        : null;
  }

  if (payload.accountable !== undefined) {
    data.accountable =
      typeof payload.accountable === "string" && payload.accountable.trim().length > 0
        ? payload.accountable.trim()
        : null;
  }

  if (payload.consulted !== undefined) {
    data.consulted =
      typeof payload.consulted === "string" && payload.consulted.trim().length > 0
        ? payload.consulted.trim()
        : null;
  }

  if (payload.informed !== undefined) {
    data.informed =
      typeof payload.informed === "string" && payload.informed.trim().length > 0
        ? payload.informed.trim()
        : null;
  }

  if (payload.testResult !== undefined) {
    data.testResult =
      typeof payload.testResult === "string" && payload.testResult.trim().length > 0
        ? payload.testResult.trim()
        : null;
  }

  if (payload.lastTestedAt !== undefined) {
    data.lastTestedAt = parseRunbookDate(payload.lastTestedAt);
  }

  return { data };
}

router.post("/templates", async (req: TenantRequest, res) => {
  try {
    if (!directUploadsEnabled) {
      return res.status(409).json({
        error: "Uploads directs dÃ©sactivÃ©s",
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
        .json({ error: "Format non supportÃ©. Utilisez DOCX, ODT ou Markdown." });
    }

    try {
      const fileHash = await computeFileHash(file.path);
      const duplicate = await prisma.runbookTemplate.findFirst({ where: { tenantId, fileHash } });
      if (duplicate) {
        return res
          .status(409)
          .json({ error: "Template dÃ©jÃ  importÃ© pour ce tenant", templateId: duplicate.id });
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
      appLogger.error("Error uploading runbook template", { message: error?.message });
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
      issues.push({ field: "mimeType", message: "type de fichier non autorisÃ©" });
    }

    if (size && size > MAX_TEMPLATE_SIZE_BYTES) {
      issues.push({ field: "size", message: "taille maximale dÃ©passÃ©e" });
    }

    const format = detectTemplateFormat(mimeType as string, fileName as string);
    if (!format) {
      issues.push({
        field: "fileName",
        message: "Format non supportÃ©. Utilisez DOCX, ODT ou Markdown.",
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
    appLogger.error("Error in POST /runbooks/templates/presign:", { message: error?.message });
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
      issues.push({ field: "mimeType", message: "type de fichier non autorisÃ©" });
    }

    if (size && size > MAX_TEMPLATE_SIZE_BYTES) {
      issues.push({ field: "size", message: "taille maximale dÃ©passÃ©e" });
    }

    const format = fileName && mimeType ? detectTemplateFormat(mimeType, fileName) : null;
    if (!format) {
      issues.push({
        field: "fileName",
        message: "Format non supportÃ©. Utilisez DOCX, ODT ou Markdown.",
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
        .json({ error: "Template dÃ©jÃ  importÃ© pour ce tenant", templateId: duplicate.id });
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
    appLogger.error("Error in POST /runbooks/templates/register:", { message: error?.message });
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
    appLogger.error("Error listing runbook templates", { message: error?.message });
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
    appLogger.error("Error fetching runbook template", { message: error?.message });
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
    appLogger.error("Error updating runbook template", { message: error?.message });
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
    appLogger.error("Error deleting runbook template", { message: error?.message });
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
    appLogger.error("Error fetching runbooks", error);
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
    appLogger.error("Error fetching runbook", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

async function updateRunbookHandler(req: TenantRequest, res: any) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const runbookId = req.params.id;
    if (!runbookId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const payload =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};

    const runbook = await prisma.runbook.findFirst({
      where: { id: runbookId, tenantId },
    });
    if (!runbook) {
      return res.status(404).json({ error: "Runbook introuvable" });
    }

    const { data, error } = buildRunbookUpdateData(payload);
    if (error) {
      return res.status(400).json({ error });
    }

    await prisma.runbook.updateMany({
      where: { id: runbookId, tenantId },
      data,
    });

    const updated = await prisma.runbook.findFirst({
      where: { id: runbookId, tenantId },
    });
    if (!updated) {
      return res.status(404).json({ error: "Runbook introuvable" });
    }

    return res.json(updated);
  } catch (error) {
    appLogger.error("Error updating runbook", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

router.put("/:id", requireRole("OPERATOR"), updateRunbookHandler);
router.patch("/:id", requireRole("OPERATOR"), updateRunbookHandler);

router.put("/:id/validate", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const runbookId = req.params.id;
    if (!runbookId) {
      return res.status(400).json({ error: "id est requis" });
    }

    const runbook = await prisma.runbook.findFirst({
      where: { id: runbookId, tenantId },
    });
    if (!runbook) {
      return res.status(404).json({ error: "Runbook introuvable" });
    }

    const testResult =
      typeof req.body?.testResult === "string" && req.body.testResult.trim().length > 0
        ? req.body.testResult.trim().toLowerCase()
        : runbook.testResult || "passed";

    const lastTestedAt = parseRunbookDate(req.body?.lastTestedAt) || new Date();

    await prisma.runbook.updateMany({
      where: { id: runbookId, tenantId },
      data: {
        status: "validated",
        testResult,
        lastTestedAt,
      },
    });

    const updated = await prisma.runbook.findFirst({
      where: { id: runbookId, tenantId },
    });
    if (!updated) {
      return res.status(404).json({ error: "Runbook introuvable" });
    }

    return res.json(updated);
  } catch (error) {
    appLogger.error("Error validating runbook", error);
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
    appLogger.error("Error deleting runbook", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/generate", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: "Tenant not resolved" });

    const {
      scenarioId,
      simulationId,
      recommendationId,
      title,
      summary,
      description,
      owner,
      templateId,
      responsible,
      accountable,
      consulted,
      informed,
    } = req.body || {};

    const hasSimulationId = typeof simulationId === "string" && simulationId.trim().length > 0;
    const hasScenarioId = typeof scenarioId === "string" && scenarioId.trim().length > 0;

    if (!hasSimulationId && !hasScenarioId) {
      return res.status(400).json({ error: "simulationId or scenarioId is required" });
    }

    if (simulationId !== undefined && simulationId !== null && !hasSimulationId) {
      return res.status(400).json({ error: "simulationId invalide" });
    }

    if (scenarioId !== undefined && scenarioId !== null && !hasScenarioId) {
      return res.status(400).json({ error: "scenarioId invalide" });
    }

    if (hasSimulationId) {
      const simulationIdValue = simulationId.trim();

      if (typeof simulationId !== "string" || simulationIdValue.length === 0) {
        return res.status(400).json({ error: "simulationId invalide" });
      }

      const simulation = await prisma.simulation.findFirst({
        where: { id: simulationIdValue, tenantId },
      });
      if (!simulation) {
        return res.status(404).json({ error: "Simulation introuvable pour ce tenant" });
      }

      const impactedNodeIds = RunbookGeneratorService.extractImpactedNodeIds(simulation.result);
      const impactedNodes = impactedNodeIds.length
        ? await prisma.infraNode.findMany({
            where: {
              tenantId,
              id: { in: impactedNodeIds },
            },
            select: {
              id: true,
              name: true,
              type: true,
              provider: true,
              region: true,
            },
          })
        : [];

      const generated = RunbookGeneratorService.generateFromSimulation({
        simulation: {
          id: simulation.id,
          name: simulation.name,
          scenarioType: simulation.scenarioType,
          result: simulation.result,
          createdAt: simulation.createdAt,
        },
        impactedNodes,
        title: typeof title === "string" ? title : null,
        description: typeof description === "string" ? description : null,
        responsible: typeof responsible === "string" ? responsible : null,
        accountable: typeof accountable === "string" ? accountable : null,
        consulted: typeof consulted === "string" ? consulted : null,
        informed: typeof informed === "string" ? informed : null,
      });

      const runbook = await prisma.runbook.create({
        data: {
          tenantId,
          simulationId: simulation.id,
          recommendationId:
            typeof recommendationId === "string" && recommendationId.trim().length > 0
              ? recommendationId.trim()
              : null,
          title: generated.title,
          description: generated.description,
          summary:
            typeof summary === "string" && summary.trim().length > 0
              ? summary.trim()
              : generated.description,
          status: "draft",
          steps: generated.steps as unknown as object,
          responsible: generated.responsible,
          accountable: generated.accountable,
          consulted: generated.consulted,
          informed: generated.informed,
          templateId:
            typeof templateId === "string" && templateId.trim().length > 0
              ? templateId.trim()
              : null,
        },
      });

      const enriched = await withDownloadUrls(runbook);
      return res.status(201).json({
        runbook: enriched,
        predictedRTO: generated.predictedRTO,
        predictedRPO: generated.predictedRPO,
        generationMode: "simulation",
      });
    }

    const scenarioIdValue = hasScenarioId ? scenarioId.trim() : undefined;

    if (scenarioIdValue) {
      const scenario = await prisma.scenario.findFirst({ where: { id: scenarioIdValue, tenantId } });
      if (!scenario) {
        return res.status(404).json({ error: "Scenario introuvable pour ce tenant" });
      }
    }

    const output = await generateRunbook(tenantId, {
      scenarioId: scenarioIdValue ?? null,
      title,
      summary,
      owner,
      templateId,
    });
    const enriched = await withDownloadUrls(output.runbook);
    return res.status(201).json({ ...output, runbook: enriched });
  } catch (error: any) {
    appLogger.error("Error generating runbook", {
      message: error?.message,
    });
    return res.status(500).json({ error: "Internal server error", details: error?.message });
  }
});

export default router;

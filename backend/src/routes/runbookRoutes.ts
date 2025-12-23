import { Router } from "express";
import multer from "multer";
import prisma from "../prismaClient";
import { TenantRequest } from "../middleware/tenantMiddleware";
import { generateRunbook } from "../services/runbookGenerator";
import {
  computeBufferHash,
  detectTemplateFormat,
  sanitizeTemplateDescription,
} from "../services/runbookTemplateService";
import {
  buildObjectKey,
  getSignedUrlForObject,
  getTenantBucketName,
  resolveBucketAndKey,
  uploadObjectToBucket,
} from "../clients/s3Client";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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

router.post("/templates", upload.single("file"), async (req: TenantRequest, res) => {
  try {
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

    const fileHash = computeBufferHash(file.buffer);
    const duplicate = await prisma.runbookTemplate.findFirst({ where: { tenantId, fileHash } });
    if (duplicate) {
      return res
        .status(409)
        .json({ error: "Template déjà importé pour ce tenant", templateId: duplicate.id });
    }

    const bucket = getTenantBucketName(tenantId);
    const key = buildObjectKey(tenantId, `runbook-template-${file.originalname}`);
    await uploadObjectToBucket({
      bucket,
      key,
      body: file.buffer,
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
  } catch (error: any) {
    console.error("Error uploading runbook template", { message: error?.message });
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

    const tpl = await prisma.runbookTemplate.findFirst({
      where: { id: req.params.id, tenantId },
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

    const runbook = await prisma.runbook.findFirst({ where: { id: req.params.id, tenantId } });
    if (!runbook) return res.status(404).json({ error: "Runbook introuvable" });

    const enriched = await withDownloadUrls(runbook);
    return res.json(enriched);
  } catch (error) {
    console.error("Error fetching runbook", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/generate", async (req: TenantRequest, res) => {
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

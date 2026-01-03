"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const runbookGenerator_1 = require("../services/runbookGenerator");
const runbookTemplateService_1 = require("../services/runbookTemplateService");
const s3Client_1 = require("../clients/s3Client");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
async function withDownloadUrls(runbook) {
    const downloadUrls = { pdf: null, docx: null, markdown: null };
    if (runbook.pdfPath) {
        const { bucket, key } = (0, s3Client_1.resolveBucketAndKey)(runbook.pdfPath, runbook.tenantId, undefined);
        downloadUrls.pdf = await (0, s3Client_1.getSignedUrlForObject)(bucket, key).catch(() => null);
    }
    if (runbook.docxPath) {
        const { bucket, key } = (0, s3Client_1.resolveBucketAndKey)(runbook.docxPath, runbook.tenantId, undefined);
        downloadUrls.docx = await (0, s3Client_1.getSignedUrlForObject)(bucket, key).catch(() => null);
    }
    if (runbook.markdownPath) {
        const { bucket, key } = (0, s3Client_1.resolveBucketAndKey)(runbook.markdownPath, runbook.tenantId, undefined);
        downloadUrls.markdown = await (0, s3Client_1.getSignedUrlForObject)(bucket, key).catch(() => null);
    }
    return { ...runbook, downloadUrls };
}
router.post("/templates", upload.single("file"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId)
            return res.status(500).json({ error: "Tenant not resolved" });
        if (!req.file)
            return res.status(400).json({ error: "Aucun fichier fourni" });
        const file = req.file;
        const format = (0, runbookTemplateService_1.detectTemplateFormat)(file.mimetype, file.originalname);
        if (!format) {
            return res
                .status(415)
                .json({ error: "Format non supporté. Utilisez DOCX, ODT ou Markdown." });
        }
        const fileHash = (0, runbookTemplateService_1.computeBufferHash)(file.buffer);
        const duplicate = await prismaClient_1.default.runbookTemplate.findFirst({ where: { tenantId, fileHash } });
        if (duplicate) {
            return res
                .status(409)
                .json({ error: "Template déjà importé pour ce tenant", templateId: duplicate.id });
        }
        const bucket = (0, s3Client_1.getTenantBucketName)(tenantId);
        const key = (0, s3Client_1.buildObjectKey)(tenantId, `runbook-template-${file.originalname}`);
        await (0, s3Client_1.uploadObjectToBucket)({
            bucket,
            key,
            body: file.buffer,
            contentType: file.mimetype,
        });
        const template = await prismaClient_1.default.runbookTemplate.create({
            data: {
                tenantId,
                originalName: file.originalname,
                storedName: key.split("/").pop() || file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                storagePath: `s3://${bucket}/${key}`,
                format,
                description: (0, runbookTemplateService_1.sanitizeTemplateDescription)((req.body || {}).description),
                fileHash,
            },
        });
        const signedUrl = await (0, s3Client_1.getSignedUrlForObject)(bucket, key);
        return res.status(201).json({ ...template, signedUrl });
    }
    catch (error) {
        console.error("Error uploading runbook template", { message: error?.message });
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/templates", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId)
            return res.status(500).json({ error: "Tenant not resolved" });
        const templates = await prismaClient_1.default.runbookTemplate.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
        });
        const enriched = await Promise.all(templates.map(async (tpl) => {
            try {
                const { bucket, key } = (0, s3Client_1.resolveBucketAndKey)(tpl.storagePath, tpl.tenantId, tpl.storedName);
                const signedUrl = await (0, s3Client_1.getSignedUrlForObject)(bucket, key);
                return { ...tpl, signedUrl };
            }
            catch (_err) {
                return { ...tpl, signedUrl: null };
            }
        }));
        return res.json(enriched);
    }
    catch (error) {
        console.error("Error listing runbook templates", { message: error?.message });
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/templates/:id", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId)
            return res.status(500).json({ error: "Tenant not resolved" });
        const tpl = await prismaClient_1.default.runbookTemplate.findFirst({
            where: { id: req.params.id, tenantId },
        });
        if (!tpl)
            return res.status(404).json({ error: "Template introuvable" });
        let signedUrl = null;
        try {
            const { bucket, key } = (0, s3Client_1.resolveBucketAndKey)(tpl.storagePath, tpl.tenantId, tpl.storedName);
            signedUrl = await (0, s3Client_1.getSignedUrlForObject)(bucket, key);
        }
        catch (_err) {
            signedUrl = null;
        }
        return res.json({ ...tpl, signedUrl });
    }
    catch (error) {
        console.error("Error fetching runbook template", { message: error?.message });
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId)
            return res.status(500).json({ error: "Tenant not resolved" });
        const runbooks = await prismaClient_1.default.runbook.findMany({
            where: { tenantId },
            orderBy: { generatedAt: "desc" },
        });
        const enriched = await Promise.all(runbooks.map((rb) => withDownloadUrls(rb)));
        return res.json(enriched);
    }
    catch (error) {
        console.error("Error fetching runbooks", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/:id", async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId)
            return res.status(500).json({ error: "Tenant not resolved" });
        const runbook = await prismaClient_1.default.runbook.findFirst({ where: { id: req.params.id, tenantId } });
        if (!runbook)
            return res.status(404).json({ error: "Runbook introuvable" });
        const enriched = await withDownloadUrls(runbook);
        return res.json(enriched);
    }
    catch (error) {
        console.error("Error fetching runbook", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/generate", (0, tenantMiddleware_1.requireRole)("OPERATOR"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId)
            return res.status(500).json({ error: "Tenant not resolved" });
        const { scenarioId, title, summary, owner, templateId } = req.body || {};
        if (scenarioId) {
            const scenario = await prismaClient_1.default.scenario.findFirst({ where: { id: scenarioId, tenantId } });
            if (!scenario) {
                return res.status(404).json({ error: "Scénario introuvable pour ce tenant" });
            }
        }
        const output = await (0, runbookGenerator_1.generateRunbook)(tenantId, { scenarioId, title, summary, owner, templateId });
        const enriched = await withDownloadUrls(output.runbook);
        return res.status(201).json({ ...output, runbook: enriched });
    }
    catch (error) {
        console.error("Error generating runbook", {
            message: error?.message,
        });
        return res.status(500).json({ error: "Internal server error", details: error?.message });
    }
});
exports.default = router;
//# sourceMappingURL=runbookRoutes.js.map
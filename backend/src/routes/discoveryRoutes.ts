import { Router } from "express";
import multer from "multer";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import { buildValidationError, parseStringArray, parseOptionalString } from "../validation/common";
import {
  applyDiscoveryImport,
  buildJobResponse,
  DiscoveryImportError,
  encryptDiscoveryCredentials,
  parseDiscoveryImport,
} from "../services/discoveryService";
import { discoveryQueue } from "../queues/discoveryQueue";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function resolveCredentials(payload: any) {
  if (payload === undefined || payload === null) return null;
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return "credentials doit être un objet";
  }
  return payload as Record<string, unknown>;
}

/**
 * POST /discovery/run
 * Lance un scan réseau/cloud pour le tenant courant.
 */
router.post("/run", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const ipRanges = parseStringArray(payload.ipRanges, "ipRanges", issues);
    const cloudProviders = parseStringArray(payload.cloudProviders, "cloudProviders", issues);
    const requestedBy = parseOptionalString(payload.requestedBy, "requestedBy", issues, {
      allowNull: true,
    });
    const credentials = resolveCredentials(payload.credentials);

    if (!ipRanges || ipRanges.length === 0) {
      issues.push({ field: "ipRanges", message: "au moins une plage IP est requise" });
    }
    if (typeof credentials === "string") {
      issues.push({ field: "credentials", message: credentials });
    }

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    let encryptedCredentials: { ciphertext: string; iv: string; tag: string } | null = null;
    if (credentials && Object.keys(credentials).length > 0) {
      const secret = process.env.DISCOVERY_SECRET;
      if (!secret) {
        return res.status(400).json({
          error: "Configuration manquante",
          details: [{ field: "credentials", message: "DISCOVERY_SECRET requis pour chiffrer les clés" }],
        });
      }
      encryptedCredentials = encryptDiscoveryCredentials(credentials, secret);
    }

    const job = await prisma.discoveryJob.create({
      data: {
        tenantId,
        status: "QUEUED",
        jobType: "RUN",
        progress: 0,
        step: "QUEUED",
        parameters: JSON.stringify({
          ipRanges,
          cloudProviders,
          requestedBy: requestedBy || req.apiKeyId || null,
        }),
        credentialsCiphertext: encryptedCredentials?.ciphertext,
        credentialsIv: encryptedCredentials?.iv,
        credentialsTag: encryptedCredentials?.tag,
        requestedByApiKeyId: req.apiKeyId ?? null,
      },
    });

    if (ipRanges.length > 0) {
      await prisma.discoveryScanAudit.createMany({
        data: ipRanges.map((range) => ({
          tenantId,
          jobId: job.id,
          apiKeyId: req.apiKeyId ?? null,
          ipRange: range,
        })),
      });
    }

    try {
      await discoveryQueue.add("discovery-run", {
        jobId: job.id,
        tenantId,
        ipRanges,
        cloudProviders,
        requestedBy: requestedBy || req.apiKeyId || null,
      });
    } catch (queueError) {
      const message = queueError instanceof Error ? queueError.message : "Queue enqueue failed";
      await prisma.discoveryJob.updateMany({
        where: { id: job.id, tenantId },
        data: {
          status: "FAILED",
          step: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      });
    }

    const queuedJob = await prisma.discoveryJob.findFirst({
      where: { id: job.id, tenantId },
    });

    if (!queuedJob) {
      return res.status(404).json({ error: "Job de découverte introuvable" });
    }

    return res.status(201).json(buildJobResponse(queuedJob));
  } catch (error) {
    console.error("Error in POST /discovery/run:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /discovery/status/:jobId
 * Statut d'un job de découverte.
 */
router.get("/status/:jobId", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const jobId = req.params.jobId;
    const job = await prisma.discoveryJob.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      return res.status(404).json({ error: "Job de découverte introuvable" });
    }

    return res.json(buildJobResponse(job));
  } catch (error) {
    console.error("Error in GET /discovery/status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /discovery/history
 * Historique des derniers scans/imports.
 */
router.get("/history", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const jobs = await prisma.discoveryJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return res.json(jobs.map(buildJobResponse));
  } catch (error) {
    console.error("Error in GET /discovery/history:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /discovery/import
 * Import d'un fichier tiers (CSV/JSON).
 */
router.post(
  "/import",
  requireRole("OPERATOR"),
  upload.single("file"),
  async (req: TenantRequest, res) => {
    let jobId: string | null = null;
    let tenantId: string | null = null;
    try {
      tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Aucun fichier fourni" });
      }

      const job = await prisma.discoveryJob.create({
        data: {
          tenantId,
          status: "RUNNING",
          jobType: "IMPORT",
          progress: 15,
          parameters: JSON.stringify({
            filename: req.file.originalname,
            contentType: req.file.mimetype,
          }),
          requestedByApiKeyId: req.apiKeyId ?? null,
          startedAt: new Date(),
        },
      });
      jobId = job.id;

      const { payload, report } = parseDiscoveryImport(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      const summary = await applyDiscoveryImport(tenantId, payload);

      const completed = await prisma.discoveryJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          progress: 100,
          completedAt: new Date(),
          resultSummary: JSON.stringify({ ...summary, importReport: report }),
        },
      });

      return res.status(201).json(buildJobResponse(completed));
    } catch (error) {
      console.error("Error in POST /discovery/import:", error);
      if (error instanceof DiscoveryImportError) {
        if (jobId) {
          await prisma.discoveryJob.updateMany({
            where: { id: jobId, tenantId },
            data: {
              status: "FAILED",
              step: "FAILED",
              errorMessage: error.message,
              completedAt: new Date(),
            },
          });
        }
        return res.status(400).json({ error: error.message, details: error.details });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

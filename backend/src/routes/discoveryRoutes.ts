import { Router } from "express";
import multer from "multer";
import * as os from "os";
import path from "path";
import * as fs from "fs";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import {
  buildValidationError,
  parseOptionalBoolean,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
  parseStringArray,
} from "../validation/common.js";
import {
  applyDiscoveryImport,
  buildJobResponse,
  buildDiscoverySuggestions,
  DiscoveryImportError,
  DiscoveryGitHubImportError,
  fetchDiscoveryImportFromGitHub,
  encryptDiscoveryCredentials,
  parseDiscoveryImport,
} from "../services/discoveryService.js";
import { mergeDiscoveredResources } from "../services/discoveryMergeService.js";
import { discoveryQueue } from "../queues/discoveryQueue.js";
import { createDiscoverySchedule } from "../services/discoveryScheduleService.js";
import { importDiscoveryFlows } from "../services/discoveryFlowService.js";

const router = Router();
const uploadDir = path.join(os.tmpdir(), "discovery-imports");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function resolveCredentials(payload: any) {
  if (payload === undefined || payload === null) return null;
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return "credentials doit être un objet";
  }
  return payload as Record<string, unknown>;
}

function normalizeCredentialGroup(
  payload: any,
  allowedFields: string[]
): { value: Record<string, string> | null; error?: string } {
  if (payload === undefined || payload === null) return { value: null };
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { value: null, error: "credentials doit être un objet" };
  }
  const result = allowedFields.reduce<Record<string, string>>((acc, field) => {
    const rawValue = payload[field];
    if (typeof rawValue === "string" && rawValue.trim()) {
      acc[field] = rawValue.trim();
    }
    return acc;
  }, {});

  return { value: Object.keys(result).length > 0 ? result : null };
}

function normalizeGcpCredentials(
  payload: any
): { value: Record<string, string> | null; error?: string } {
  if (payload === undefined || payload === null) return { value: null };
  if (typeof payload === "string") {
    return { value: payload.trim() ? { serviceAccountJson: payload.trim() } : null };
  }
  return normalizeCredentialGroup(payload, ["serviceAccountJson"]);
}

/**
 * POST /discovery/run
 * Lance un scan réseau/cloud pour le tenant courant.
 */
async function handleDiscoveryRun(req: TenantRequest, res: any) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const ipRanges = parseStringArray(payload.ipRanges, "ipRanges", issues) || [];
    const cloudProviders = parseStringArray(payload.cloudProviders, "cloudProviders", issues) || [];
    const requestedBy = parseOptionalString(payload.requestedBy, "requestedBy", issues, {
      allowNull: true,
    });
    const autoCreate = parseOptionalBoolean(payload.autoCreate, "autoCreate", issues);
    const rawCredentials = resolveCredentials(payload.credentials);
    const credentials = typeof rawCredentials === "string" ? null : rawCredentials;
    const awsCredentials = normalizeCredentialGroup(payload.awsCredentials, [
      "accessKeyId",
      "secretAccessKey",
    ]);
    const azureCredentials = normalizeCredentialGroup(payload.azureCredentials, [
      "tenantId",
      "clientId",
      "clientSecret",
    ]);
    const gcpCredentials = normalizeGcpCredentials(payload.gcpCredentials);

    if (awsCredentials.error) {
      issues.push({ field: "awsCredentials", message: awsCredentials.error });
    }
    if (azureCredentials.error) {
      issues.push({ field: "azureCredentials", message: azureCredentials.error });
    }
    if (gcpCredentials.error) {
      issues.push({ field: "gcpCredentials", message: gcpCredentials.error });
    }

    const effectiveCloudProviders = Array.from(
      new Set([
        ...cloudProviders,
        ...(awsCredentials.value ? ["AWS"] : []),
        ...(azureCredentials.value ? ["AZURE"] : []),
        ...(gcpCredentials.value ? ["GCP"] : []),
      ])
    );

    if ((!ipRanges || ipRanges.length === 0) && effectiveCloudProviders.length === 0) {
      issues.push({
        field: "ipRanges",
        message: "au moins une plage IP ou un cloudProvider est requis",
      });
    }
    if (typeof rawCredentials === "string") {
      issues.push({ field: "credentials", message: rawCredentials });
    }

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const combinedCredentials: Record<string, unknown> = {
      ...(credentials || {}),
      ...(awsCredentials.value ? { aws: awsCredentials.value } : {}),
      ...(azureCredentials.value ? { azure: azureCredentials.value } : {}),
      ...(gcpCredentials.value ? { gcp: gcpCredentials.value } : {}),
    };

    let encryptedCredentials: { ciphertext: string; iv: string; tag: string } | null = null;
    if (Object.keys(combinedCredentials).length > 0) {
      const secret = process.env.DISCOVERY_SECRET;
      if (!secret) {
        return res.status(400).json({
          error: "Configuration manquante",
          details: [{ field: "credentials", message: "DISCOVERY_SECRET requis pour chiffrer les clés" }],
        });
      }
      encryptedCredentials = encryptDiscoveryCredentials(combinedCredentials, secret);
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
          cloudProviders: effectiveCloudProviders,
          requestedBy: requestedBy || req.apiKeyId || null,
          autoCreate: Boolean(autoCreate),
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
      await discoveryQueue.add("discovery.run", {
        jobId: job.id,
        tenantId,
        ipRanges,
        cloudProviders: effectiveCloudProviders,
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
}

router.post("/run", requireRole("OPERATOR"), handleDiscoveryRun);
router.post("/scan", requireRole("OPERATOR"), handleDiscoveryRun);

/**
 * POST /discovery/schedules
 * Planifie un scan régulier (quotidien/hebdomadaire).
 */
router.post("/schedules", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const name = parseRequiredString(payload.name, "name", issues, { minLength: 3 });
    const ipRanges = parseStringArray(payload.ipRanges, "ipRanges", issues) || [];
    const cloudProviders = parseStringArray(payload.cloudProviders, "cloudProviders", issues) || [];
    const frequency = parseOptionalString(payload.frequency, "frequency", issues) || "WEEKLY";
    const dayOfWeek = parseOptionalNumber(payload.dayOfWeek, "dayOfWeek", issues);
    const hour = parseOptionalNumber(payload.hour, "hour", issues);
    const minute = parseOptionalNumber(payload.minute, "minute", issues);

    if (!["DAILY", "WEEKLY"].includes(frequency.toUpperCase())) {
      issues.push({ field: "frequency", message: "doit être DAILY ou WEEKLY" });
    }

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const schedule = await createDiscoverySchedule({
      tenantId,
      name: name || "Scan planifié",
      ipRanges,
      cloudProviders,
      frequency: frequency.toUpperCase() as "DAILY" | "WEEKLY",
      scheduleConfig: {
        dayOfWeek: typeof dayOfWeek === "number" ? dayOfWeek : undefined,
        hour: typeof hour === "number" ? hour : undefined,
        minute: typeof minute === "number" ? minute : undefined,
        timezone: payload.timezone ? String(payload.timezone) : undefined,
      },
      requestedByApiKeyId: req.apiKeyId ?? null,
    });

    return res.status(201).json(schedule);
  } catch (error) {
    console.error("Error in POST /discovery/schedules:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /discovery/schedules
 * Liste les scans planifiés.
 */
router.get("/schedules", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const schedules = await prisma.discoverySchedule.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(schedules);
  } catch (error) {
    console.error("Error in GET /discovery/schedules:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /discovery/flows/import
 * Import de flux NetFlow/sFlow pour alimenter le graph dynamique.
 */
router.post("/flows/import", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const flows = Array.isArray(payload.flows) ? payload.flows : null;
    if (!flows) {
      return res.status(400).json({ error: "flows doit être un tableau" });
    }

    const records = flows
      .map((flow: any) => ({
        sourceIp: flow.sourceIp || flow.src_ip || flow.srcIp,
        targetIp: flow.targetIp || flow.dst_ip || flow.dstIp,
        sourcePort: flow.sourcePort ?? flow.src_port ?? null,
        targetPort: flow.targetPort ?? flow.dst_port ?? null,
        protocol: flow.protocol ?? flow.proto ?? null,
        bytes: flow.bytes ?? flow.octets ?? null,
        packets: flow.packets ?? flow.pkt ?? null,
        observedAt: flow.observedAt ? new Date(flow.observedAt) : null,
      }))
      .filter((flow) => flow.sourceIp && flow.targetIp);

    const result = await importDiscoveryFlows(tenantId, payload.jobId || null, records);
    return res.status(201).json(result);
  } catch (error) {
    console.error("Error in POST /discovery/flows/import:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /discovery/resources
 * Liste des ressources découvertes (CMDB dynamique).
 */
router.get("/resources", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues: { field: string; message: string }[] = [];
    const limitRaw = parseOptionalNumber(req.query.limit, "limit", issues);
    const offsetRaw = parseOptionalNumber(req.query.offset, "offset", issues);
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }
    const limit = Math.min(limitRaw ?? 100, 500);
    const offset = offsetRaw ?? 0;

    const resources = await prisma.discoveredResource.findMany({
      where: { tenantId },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
      skip: offset,
    });

    return res.json({ resources, limit, offset });
  } catch (error) {
    console.error("Error in GET /discovery/resources:", error);
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

    const history = await prisma.discoveryHistory.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return res.json(
      history.map((entry) => ({
        id: entry.id,
        jobId: entry.jobId,
        status: entry.status,
        jobType: entry.jobType,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        summary: entry.summary,
        errorMessage: entry.errorMessage,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }))
    );
  } catch (error) {
    console.error("Error in GET /discovery/history:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /discovery/suggestions
 * Prévisualise les correspondances entre découverte et services existants.
 */
router.post(
  "/suggestions",
  requireRole("OPERATOR"),
  upload.single("file"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Aucun fichier fourni" });
      }

      const fileBuffer = await fs.promises.readFile(req.file.path);
      const { payload } = parseDiscoveryImport(
        fileBuffer,
        req.file.originalname,
        req.file.mimetype
      );
      const suggestions = await buildDiscoverySuggestions(tenantId, payload);

      return res.json(suggestions);
    } catch (error) {
      console.error("Error in POST /discovery/suggestions:", error);
      if (error instanceof DiscoveryImportError) {
        return res.status(400).json({ error: error.message, details: error.details });
      }
      return res.status(500).json({ error: "Internal server error" });
    } finally {
      if (req.file?.path) {
        await fs.promises.rm(req.file.path, { force: true }).catch(() => undefined);
      }
    }
  }
);

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

      const fileBuffer = await fs.promises.readFile(req.file.path);
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
        fileBuffer,
        req.file.originalname,
        req.file.mimetype
      );
      const summary = await applyDiscoveryImport(tenantId, payload);
      const mergeSummary = await mergeDiscoveredResources(
        tenantId,
        payload.nodes.map((node) => ({
          source: "import",
          externalId: node.externalId,
          name: node.name,
          kind: node.kind,
          type: node.type,
          ip: node.ip ?? null,
          hostname: node.hostname ?? null,
          metadata: {
            criticality: node.criticality ?? null,
            provider: node.provider ?? null,
            location: node.location ?? null,
            description: node.description ?? null,
          },
        }))
      );

      await prisma.discoveryJob.updateMany({
        where: { id: job.id, tenantId },
        data: {
          status: "COMPLETED",
          progress: 100,
          completedAt: new Date(),
          resultSummary: JSON.stringify({ ...summary, mergeSummary, importReport: report }),
        },
      });

      const completed = await prisma.discoveryJob.findFirst({
        where: { id: job.id, tenantId },
      });

      if (!completed) {
        return res.status(404).json({ error: "Job de découverte introuvable" });
      }

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
    } finally {
      if (req.file?.path) {
        await fs.promises.rm(req.file.path, { force: true }).catch(() => undefined);
      }
    }
  }
);

/**
 * POST /discovery/github-import
 * Import d'un export JSON depuis un dépôt GitHub public.
 */
router.post("/github-import", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  let jobId: string | null = null;
  let tenantId: string | null = null;
  try {
    tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];
    const repoUrl = parseOptionalString(payload.repoUrl, "repoUrl", issues, { allowNull: true });
    const filePath = parseOptionalString(payload.filePath, "filePath", issues, { allowNull: true });
    const ref = parseOptionalString(payload.ref, "ref", issues, { allowNull: true });
    const rawUrl = parseOptionalString(payload.rawUrl, "rawUrl", issues, { allowNull: true });

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    if (!rawUrl && (!repoUrl || !filePath)) {
      return res.status(400).json({
        error: "Paramètres GitHub incomplets",
        details: [
          {
            field: "repoUrl",
            message: "repoUrl + filePath ou rawUrl sont requis",
          },
        ],
      });
    }

    const job = await prisma.discoveryJob.create({
      data: {
        tenantId,
        status: "RUNNING",
        jobType: "GITHUB_IMPORT",
        progress: 20,
        parameters: JSON.stringify({
          repoUrl: repoUrl || null,
          filePath: filePath || null,
          ref: ref || null,
          rawUrl: rawUrl || null,
        }),
        requestedByApiKeyId: req.apiKeyId ?? null,
        startedAt: new Date(),
      },
    });
    jobId = job.id;

    const { buffer, filename } = await fetchDiscoveryImportFromGitHub({
      repoUrl: repoUrl || undefined,
      filePath: filePath || undefined,
      ref: ref || undefined,
      rawUrl: rawUrl || undefined,
    });

    const { payload: importPayload, report } = parseDiscoveryImport(
      buffer,
      filename,
      "application/json"
    );
    const summary = await applyDiscoveryImport(tenantId, importPayload);
    const mergeSummary = await mergeDiscoveredResources(
      tenantId,
      importPayload.nodes.map((node) => ({
        source: "github-import",
        externalId: node.externalId,
        name: node.name,
        kind: node.kind,
        type: node.type,
        ip: node.ip ?? null,
        hostname: node.hostname ?? null,
        metadata: {
          criticality: node.criticality ?? null,
          provider: node.provider ?? null,
          location: node.location ?? null,
          description: node.description ?? null,
        },
      }))
    );

    await prisma.discoveryJob.updateMany({
      where: { id: job.id, tenantId },
      data: {
        status: "COMPLETED",
        progress: 100,
        completedAt: new Date(),
        resultSummary: JSON.stringify({ ...summary, mergeSummary, importReport: report }),
      },
    });

    const completed = await prisma.discoveryJob.findFirst({
      where: { id: job.id, tenantId },
    });

    if (!completed) {
      return res.status(404).json({ error: "Job de découverte introuvable" });
    }

    return res.status(201).json(buildJobResponse(completed));
  } catch (error) {
    console.error("Error in POST /discovery/github-import:", error);
    if (error instanceof DiscoveryImportError || error instanceof DiscoveryGitHubImportError) {
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
});

export default router;

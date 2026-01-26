"use strict";

const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const IORedis = require("ioredis");
const { Prisma } = require("@prisma/client");
const prisma = require("./prismaClient");
const { getPrometheusMetricsHandler, initTelemetry } = require("./observability/telemetry");

const serviceRoutes = require("./routes/serviceRoutes");
const graphRoutes = require("./routes/graphRoutes");
const analysisRoutes = require("./routes/analysisRoutes");
const infraRoutes = require("./routes/infraRoutes");
const { tenantMiddleware } = require("./middleware/tenantMiddleware");
const scenarioRoutes = require("./routes/scenarioRoutes");
const scenarioCatalogRoutes = require("./routes/scenarioCatalogRoutes");
const documentRoutes = require("./routes/documentRoutes");
const continuityRoutes = require("./routes/continuityRoutes");
const runbookRoutes = require("./routes/runbookRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const authRoutes = require("./routes/authRoutes");
const auditRoutes = require("./routes/auditRoutes");
const riskRoutes = require("./routes/riskRoutes");
const biaRoutes = require("./routes/biaRoutes");
const incidentRoutes = require("./routes/incidentRoutes");
const exerciseRoutes = require("./routes/exerciseRoutes");
const discoveryRoutes = require("./routes/discoveryRoutes");
const pricingRoutes = require("./routes/pricingRoutes");
const { startDiscoveryWorker } = require("./workers/discoveryWorker");
const { startDocumentIngestionWorker } = require("./workers/documentIngestionWorker");
const { startDiscoveryScheduler } = require("./workers/discoveryScheduler");
const { startApiKeyRotationWorker } = require("./workers/apiKeyRotationWorker");
const { initDiscoveryWebSocket } = require("./websockets/discoveryWebsocket");
const { deploymentConfig } = require("./config/deployment");
const { ensureOnPremiseLicense } = require("./services/licenseService");

dotenv.config();
initTelemetry();
const onPremiseLicense = ensureOnPremiseLicense();

const HEALTHCHECK_TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 2000);
const HEALTHCHECK_RETRY_DELAY_MS = Number(process.env.HEALTHCHECK_RETRY_DELAY_MS || 500);
const HEALTHCHECK_RETRIES = Number(process.env.HEALTHCHECK_RETRIES || 2);
const VECTOR_DB_OPTIONAL =
  String(process.env.VECTOR_DB_OPTIONAL || "false").toLowerCase() === "true";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logBoot = (step, meta = {}) => {
  console.log(JSON.stringify({ level: "info", msg: "boot", step, ...meta }));
};

const backgroundServices = [
  {
    name: "discoveryWorker",
    enabled: process.env.DISCOVERY_WORKER_ENABLED !== "false",
    start: () => {
      startDiscoveryWorker();
    },
  },
  {
    name: "documentIngestionWorker",
    enabled: process.env.DOCUMENT_WORKER_ENABLED !== "false",
    start: () => {
      startDocumentIngestionWorker();
    },
  },
  {
    name: "discoveryScheduler",
    enabled: process.env.DISCOVERY_SCHEDULER_ENABLED !== "false",
    start: async () => {
      await startDiscoveryScheduler();
    },
  },
  {
    name: "apiKeyRotationWorker",
    enabled: process.env.API_KEY_ROTATION_ENABLED !== "false",
    start: async () => {
      await startApiKeyRotationWorker();
    },
  },
];

const workerReadiness = Object.fromEntries(
  backgroundServices.map((service) => [
    service.name,
    service.enabled
      ? { status: "failed", optional: true, error: "boot pending" }
      : { status: "skipped", optional: true, error: "disabled" },
  ])
);

const updateWorkerReadiness = (name, status, meta = {}) => {
  workerReadiness[name] = {
    status,
    optional: true,
    ...meta,
  };
};

const startBackgroundServices = async () => {
  logBoot("background.services.start", {
    enabled: backgroundServices.filter((service) => service.enabled).length,
  });
  for (const service of backgroundServices) {
    if (!service.enabled) {
      updateWorkerReadiness(service.name, "skipped", { error: "disabled" });
      continue;
    }
    const startedAt = Date.now();
    updateWorkerReadiness(service.name, "failed", { error: "starting" });
    try {
      await service.start();
      updateWorkerReadiness(service.name, "ok", { latencyMs: Date.now() - startedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : "background service error";
      updateWorkerReadiness(service.name, "failed", {
        error: message,
        latencyMs: Date.now() - startedAt,
      });
      logBoot("background.services.failed", { service: service.name, error: message });
    }
  }
  logBoot("background.services.ready", {
    statuses: Object.fromEntries(
      Object.entries(workerReadiness).map(([name, status]) => [name, status.status])
    ),
  });
};

const withTimeout = async (operation, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const runWithRetries = async (operation) => {
  let attempt = 0;
  let lastError;
  while (attempt <= HEALTHCHECK_RETRIES) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === HEALTHCHECK_RETRIES) {
        throw error;
      }
      await sleep(HEALTHCHECK_RETRY_DELAY_MS);
      attempt += 1;
    }
  }
  throw lastError;
};

const checkDatabase = async () => {
  await prisma.$queryRaw(Prisma.sql`SELECT 1`);
};

const checkRedis = async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL not set");
  }
  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    connectTimeout: HEALTHCHECK_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== "PONG") {
      throw new Error("Redis ping failed");
    }
  } finally {
    await redis.quit().catch(() => redis.disconnect());
  }
};

const checkMinio = async () => {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) {
    throw new Error("S3_ENDPOINT not set");
  }
  const response = await withTimeout(
    (signal) => fetch(`${endpoint}/minio/health/ready`, { signal }),
    HEALTHCHECK_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(`MinIO not ready (${response.status})`);
  }
};

const checkChroma = async () => {
  const chromaUrl = process.env.CHROMADB_URL;
  if (!chromaUrl) {
    throw new Error("CHROMADB_URL not set");
  }
  const v1Response = await withTimeout(
    (signal) => fetch(`${chromaUrl}/api/v1/heartbeat`, { signal }),
    HEALTHCHECK_TIMEOUT_MS
  );
  if (v1Response.ok) {
    return;
  }
  const fallbackStatuses = new Set([404, 410]);
  if (!fallbackStatuses.has(v1Response.status)) {
    throw new Error(`Chroma not ready (${v1Response.status})`);
  }
  const v2Response = await withTimeout(
    (signal) => fetch(`${chromaUrl}/api/v2/heartbeat`, { signal }),
    HEALTHCHECK_TIMEOUT_MS
  );
  if (!v2Response.ok) {
    throw new Error(`Chroma not ready (${v2Response.status})`);
  }
};

const checkDependency = async (name, operation, options = {}) => {
  const { optional = false, enabled = true } = options;
  if (!enabled) {
    return {
      name,
      result: {
        status: "skipped",
        optional,
        error: "not configured",
      },
    };
  }
  const startedAt = Date.now();
  try {
    await runWithRetries(operation);
    return {
      name,
      result: {
        status: "ok",
        optional,
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      name,
      result: {
        status: "failed",
        optional,
        latencyMs: Date.now() - startedAt,
        error: message,
      },
    };
  }
};

const buildReadinessReport = async () => {
  const chromaConfigured = Boolean(process.env.CHROMADB_URL);
  const chromaEnabled = chromaConfigured || !VECTOR_DB_OPTIONAL;

  const checks = await Promise.all([
    checkDependency("database", checkDatabase),
    checkDependency("redis", checkRedis),
    checkDependency("minio", checkMinio),
    checkDependency("chroma", checkChroma, {
      optional: VECTOR_DB_OPTIONAL,
      enabled: chromaEnabled,
    }),
  ]);

  const dependencies = Object.fromEntries(
    checks.map(({ name, result }) => [name, result])
  );

  const combinedDependencies = {
    ...dependencies,
    ...workerReadiness,
  };

  const requiredFailures = Object.values(dependencies).some(
    (dependency) => dependency.status === "failed" && !dependency.optional
  );
  const optionalFailures = Object.values(combinedDependencies).some(
    (dependency) => dependency.status === "failed" && dependency.optional
  );

  const status = requiredFailures ? "failed" : optionalFailures ? "degraded" : "ok";

  return {
    httpStatus: requiredFailures ? 503 : 200,
    report: {
      status,
      dependencies: combinedDependencies,
      timestamp: new Date().toISOString(),
    },
  };
};

const app = express();

const isDevelopment = process.env.NODE_ENV !== "production";
const allowNoOrigin = String(process.env.CORS_ALLOW_NO_ORIGIN || "false").toLowerCase() === "true";

const baseAllowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
]
  .filter((origin) => typeof origin === "string" && origin.length > 0)
  .map((origin) => origin.trim())
  .filter(Boolean);

const devAllowedOrigins = isDevelopment
  ? [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173", // Vite default port
    ]
  : [];

const allowedOrigins = new Set([...baseAllowedOrigins, ...devAllowedOrigins]);

logBoot("config.loaded", {
  nodeEnv: process.env.NODE_ENV || "development",
  allowedOriginsCount: allowedOrigins.size,
  allowNoOrigin,
});

// Configure CORS to allow requests from frontend
const corsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin only when explicitly enabled
    if (!origin) {
      if (allowNoOrigin) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-correlation-id"],
};

const corsMiddleware = cors(corsOptions);
app.use((req, res, next) => {
  res.append("Vary", "Origin");
  corsMiddleware(req, res, (err) => {
    if (err) {
      return res.status(403).json({ error: "Origin not allowed by CORS" });
    }
    return next();
  });
});
app.use(express.json());

// ✅ health-check sans tenant
app.get("/health/live", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get("/health/ready", async (_req, res) => {
  const { httpStatus, report } = await buildReadinessReport();
  res.status(httpStatus).json(report);
});

app.get("/health", async (_req, res) => {
  const { httpStatus, report } = await buildReadinessReport();
  res.status(httpStatus).json({
    ...report,
    deprecated: true,
    live: "/health/live",
    ready: "/health/ready",
  });
});

app.get("/metrics", (_req, res) => {
  const handler = getPrometheusMetricsHandler();
  return handler(_req, res);
});

// ✅ à partir d'ici, on exige une API key et on injecte tenantId
app.use(tenantMiddleware);

app.use("/services", serviceRoutes.default ?? serviceRoutes);
app.use("/graph", graphRoutes.default ?? graphRoutes);
app.use("/analysis", analysisRoutes.default ?? analysisRoutes);
app.use("/infra", infraRoutes.default ?? infraRoutes);
app.use("/scenarios", scenarioRoutes.default ?? scenarioRoutes);
app.use("/scenario-catalog", scenarioCatalogRoutes.default ?? scenarioCatalogRoutes);
app.use("/documents", documentRoutes.default ?? documentRoutes);
app.use("/continuity", continuityRoutes.default ?? continuityRoutes);
app.use("/runbooks", runbookRoutes.default ?? runbookRoutes);
app.use("/webhooks", webhookRoutes.default ?? webhookRoutes);
app.use("/auth", authRoutes.default ?? authRoutes);
app.use("/audit-logs", auditRoutes.default ?? auditRoutes);
app.use("/risks", riskRoutes.default ?? riskRoutes);
app.use("/bia", biaRoutes.default ?? biaRoutes);
app.use("/incidents", incidentRoutes.default ?? incidentRoutes);
app.use("/exercises", exerciseRoutes.default ?? exerciseRoutes);
app.use("/discovery", discoveryRoutes.default ?? discoveryRoutes);
app.use("/pricing", pricingRoutes.default ?? pricingRoutes);

logBoot("routes.registered", { count: 18 });

logBoot("background.services.deferred", {
  discoveryWorker: process.env.DISCOVERY_WORKER_ENABLED !== "false",
  documentWorker: process.env.DOCUMENT_WORKER_ENABLED !== "false",
  discoveryScheduler: process.env.DISCOVERY_SCHEDULER_ENABLED !== "false",
  apiKeyRotationWorker: process.env.API_KEY_ROTATION_ENABLED !== "false",
});

// Global error handler - ensure all errors return JSON
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// 404 handler - ensure 404s return JSON
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer(app);
initDiscoveryWebSocket(server);

server.listen(Number(PORT), HOST, () => {
  console.log(`API PRA/PCA running on ${HOST}:${PORT}`);
  logBoot("server.listening", { host: HOST, port: Number(PORT) });
  const originList = [...allowedOrigins.values()];
  console.log(
    `CORS enabled for origins: ${originList.length > 0 ? originList.join(", ") : "none"}`
  );
  console.log(
    `Health checks available at http://${HOST}:${PORT}/health/live (liveness) and /health/ready (readiness)`
  );
  if (deploymentConfig.mode === "saas") {
    console.log("Deployment mode: SaaS (multi-tenant mutualisé, schéma par tenant, quotas actifs).");
  } else {
    console.log("Deployment mode: On-premise (auto-mise à jour désactivée).");
    if (onPremiseLicense) {
      console.log(`Licence on-premise stockée: ${deploymentConfig.license.filePath}`);
    }
  }

  setImmediate(() => {
    void startBackgroundServices();
  });

  void (async () => {
    logBoot("dependencies.probe.start");
    const { report } = await buildReadinessReport();
    const failed = Object.entries(report.dependencies)
      .filter(([, dependency]) => dependency.status === "failed")
      .map(([name]) => name);
    logBoot("dependencies.probe.complete", {
      status: report.status,
      failedDependencies: failed,
    });
  })();
});

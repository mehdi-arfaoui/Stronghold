import express from "express";
import http from "http";
import cors, { type CorsOptions } from "cors";
import dotenv from "dotenv";
import { Redis } from "ioredis";
import { Prisma } from "@prisma/client";
import prisma from "./prismaClient.js";
import { getPrometheusMetricsHandler, initTelemetry } from "./observability/telemetry.js";

import serviceRoutes from "./routes/serviceRoutes.js";
import graphRoutes from "./routes/graphRoutes.js";
import analysisRoutes from "./routes/analysisRoutes.js";
import infraRoutes from "./routes/infraRoutes.js";
import { tenantMiddleware } from "./middleware/tenantMiddleware.js";
import scenarioRoutes from "./routes/scenarioRoutes.js";
import scenarioCatalogRoutes from "./routes/scenarioCatalogRoutes.js";
import cyberScenarioRoutes from "./routes/cyberScenarioRoutes.js";
import cyberExerciseRoutes from "./routes/cyberExerciseRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import continuityRoutes from "./routes/continuityRoutes.js";
import runbookRoutes from "./routes/runbookRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import riskRoutes from "./routes/riskRoutes.js";
import biaRoutes from "./routes/biaRoutes.js";
import incidentRoutes from "./routes/incidentRoutes.js";
import exerciseRoutes from "./routes/exerciseRoutes.js";
import discoveryRoutes from "./routes/discoveryRoutes.js";
import pricingRoutes from "./routes/pricingRoutes.js";
import vulnerabilityRoutes from "./routes/vulnerabilityRoutes.js";
import brandingRoutes from "./routes/brandingRoutes.js";
import licenseRoutes from "./routes/licenseRoutes.js";
import resilienceGraphRoutes from "./routes/resilienceGraphRoutes.js";
import analysisResilienceRoutes from "./routes/analysisResilienceRoutes.js";
import biaResilienceRoutes from "./routes/biaResilienceRoutes.js";
import simulationRoutes from "./routes/simulationRoutes.js";
import riskResilienceRoutes from "./routes/riskResilienceRoutes.js";
import landingZoneResilienceRoutes from "./routes/landingZoneResilienceRoutes.js";
import discoveryResilienceRoutes from "./routes/discoveryResilienceRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import exerciseResilienceRoutes from "./routes/exerciseResilienceRoutes.js";
import integrationsRoutes from "./routes/integrationsRoutes.js";
import currencyRoutes from "./routes/currencyRoutes.js";
import recommendationEngineRoutes from "./routes/recommendationEngineRoutes.js";
import knowledgeBaseRoutes from "./routes/knowledgeBaseRoutes.js";
import driftRoutes from "./routes/driftRoutes.js";
import roiRoutes from "./routes/roiRoutes.js";
import { startDiscoveryWorker } from "./workers/discoveryWorker.js";
import { startDocumentIngestionWorker } from "./workers/documentIngestionWorker.js";
import { startDiscoveryScheduler } from "./workers/discoveryScheduler.js";
import { startApiKeyRotationWorker } from "./workers/apiKeyRotationWorker.js";
import { startLicenseQuotaResetWorker } from "./workers/licenseQuotaResetWorker.js";
import { startDriftScheduler } from "./workers/driftScheduler.js";
import { initDiscoveryWebSocket } from "./websockets/discoveryWebsocket.js";
import { deploymentConfig } from "./config/deployment.js";
import { ensureOnPremiseLicense } from "./services/onPremiseLicenseService.js";

dotenv.config();
initTelemetry();
const onPremiseLicense = ensureOnPremiseLicense();

type DependencyStatus = "ok" | "failed" | "skipped";
type DependencyCheck = {
  status: DependencyStatus;
  latencyMs?: number;
  error?: string;
  optional?: boolean;
};

type ReadinessReport = {
  status: "ok" | "degraded" | "failed";
  dependencies: Record<string, DependencyCheck>;
  timestamp: string;
};

type BackgroundService = {
  name: string;
  enabled: boolean;
  start: () => Promise<void> | void;
};

const HEALTHCHECK_TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 2000);
const HEALTHCHECK_RETRY_DELAY_MS = Number(process.env.HEALTHCHECK_RETRY_DELAY_MS || 500);
const HEALTHCHECK_RETRIES = Number(process.env.HEALTHCHECK_RETRIES || 2);
const VECTOR_DB_OPTIONAL =
  String(process.env.VECTOR_DB_OPTIONAL || "false").toLowerCase() === "true";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const logBoot = (step: string, meta: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ level: "info", msg: "boot", step, ...meta }));
};

const backgroundServices: BackgroundService[] = [
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
  {
    name: "licenseQuotaResetWorker",
    enabled: process.env.LICENSE_QUOTA_RESET_ENABLED !== "false",
    start: async () => {
      await startLicenseQuotaResetWorker();
    },
  },
  {
    name: "driftScheduler",
    enabled: process.env.DRIFT_CHECK_ENABLED !== "false",
    start: async () => {
      await startDriftScheduler();
    },
  },
];

const workerReadiness: Record<string, DependencyCheck> = Object.fromEntries(
  backgroundServices.map((service) => [
    service.name,
    service.enabled
      ? { status: "failed", optional: true, error: "boot pending" }
      : { status: "skipped", optional: true, error: "disabled" },
  ])
) as Record<string, DependencyCheck>;

const updateWorkerReadiness = (
  name: string,
  status: DependencyStatus,
  meta: Pick<DependencyCheck, "error" | "latencyMs"> = {}
) => {
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

const withTimeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const runWithRetries = async <T>(operation: () => Promise<T>): Promise<T> => {
  let attempt = 0;
  let lastError: unknown;
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
  const redis = new Redis(redisUrl, {
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

const checkDependency = async (
  name: string,
  operation: () => Promise<void>,
  options: { optional?: boolean; enabled?: boolean } = {}
): Promise<{ name: string; result: DependencyCheck }> => {
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

const buildReadinessReport = async (): Promise<{
  httpStatus: number;
  report: ReadinessReport;
}> => {
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
  ) as Record<string, DependencyCheck>;

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

  const status: ReadinessReport["status"] = requiredFailures
    ? "failed"
    : optionalFailures
      ? "degraded"
      : "ok";

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
const allowNoOrigin =
  String(process.env.CORS_ALLOW_NO_ORIGIN || "false").toLowerCase() === "true";

const baseAllowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
]
  .filter((origin): origin is string => typeof origin === "string" && origin.length > 0)
  .map((origin) => origin.trim())
  .filter(Boolean);

const devAllowedOrigins = isDevelopment
  ? [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173", // Vite default port
    ]
  : [
      // Always allow localhost variants for Docker environments
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];

const allowedOrigins = new Set([...baseAllowedOrigins, ...devAllowedOrigins]);

logBoot("config.loaded", {
  nodeEnv: process.env.NODE_ENV || "development",
  allowedOriginsCount: allowedOrigins.size,
  allowNoOrigin,
});

// Configure CORS to allow requests from frontend
const corsOptions: CorsOptions = {
  origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
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
  corsMiddleware(req, res, (err?: any) => {
    if (err) {
      res.status(403).json({ error: "Origin not allowed by CORS" });
      return;
    }
    next();
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
// Wrapper pour gérer les middlewares async
const asyncMiddleware = (fn: (req: any, res: any, next: any) => Promise<any>) => {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
app.use(asyncMiddleware(tenantMiddleware));

// Helper pour normaliser les imports (gère les exports par défaut)
// Un router Express est un objet avec des méthodes comme use, get, post, etc.
const isExpressRouter = (obj: any): boolean => {
  return (
    obj &&
    typeof obj === "object" &&
    (typeof obj.use === "function" ||
      typeof obj.get === "function" ||
      typeof obj.post === "function" ||
      typeof obj.put === "function" ||
      typeof obj.delete === "function")
  );
};

const normalizeRouteHandler = (handler: any, name: string): any => {
  // Si c'est un router Express directement, on le retourne
  if (isExpressRouter(handler)) {
    return handler;
  }
  // Si c'est une fonction (middleware), on la retourne
  if (typeof handler === "function") {
    return handler;
  }
  // Si c'est un objet avec une propriété default, on l'extrait
  if (handler && typeof handler === "object" && "default" in handler) {
    const defaultHandler = handler.default;
    if (isExpressRouter(defaultHandler)) {
      return defaultHandler;
    }
    if (typeof defaultHandler === "function") {
      return defaultHandler;
    }
    throw new Error(
      `Route handler for ${name} has a default property but it's not a router or function. Got: ${typeof defaultHandler}, keys: ${JSON.stringify(
        Object.keys(defaultHandler || {})
      )}`
    );
  }
  // Si c'est un objet mais pas de default, on vérifie s'il a des propriétés de router Express
  if (handler && typeof handler === "object") {
    if (isExpressRouter(handler)) {
      return handler;
    }
  }
  throw new Error(
    `Route handler for ${name} is not a router or function. Got: ${typeof handler}, keys: ${JSON.stringify(
      Object.keys(handler || {})
    )}`
  );
};

// Validation et enregistrement des routes
const routes = [
  { path: "/services", handler: serviceRoutes, name: "serviceRoutes" },
  { path: "/graph", handler: graphRoutes, name: "graphRoutes" },
  { path: "/analysis", handler: analysisRoutes, name: "analysisRoutes" },
  { path: "/infra", handler: infraRoutes, name: "infraRoutes" },
  { path: "/scenarios/cyber", handler: cyberExerciseRoutes, name: "cyberExerciseRoutes" },
  { path: "/scenarios", handler: scenarioRoutes, name: "scenarioRoutes" },
  { path: "/scenario-catalog", handler: scenarioCatalogRoutes, name: "scenarioCatalogRoutes" },
  { path: "/cyber-scenarios", handler: cyberScenarioRoutes, name: "cyberScenarioRoutes" },
  { path: "/documents", handler: documentRoutes, name: "documentRoutes" },
  { path: "/continuity", handler: continuityRoutes, name: "continuityRoutes" },
  { path: "/runbooks", handler: runbookRoutes, name: "runbookRoutes" },
  { path: "/webhooks", handler: webhookRoutes, name: "webhookRoutes" },
  { path: "/auth", handler: authRoutes, name: "authRoutes" },
  { path: "/audit-logs", handler: auditRoutes, name: "auditRoutes" },
  { path: "/risks", handler: riskRoutes, name: "riskRoutes" },
  { path: "/bia", handler: biaRoutes, name: "biaRoutes" },
  { path: "/incidents", handler: incidentRoutes, name: "incidentRoutes" },
  { path: "/exercises", handler: exerciseRoutes, name: "exerciseRoutes" },
  { path: "/discovery", handler: discoveryRoutes, name: "discoveryRoutes" },
  { path: "/pricing", handler: pricingRoutes, name: "pricingRoutes" },
  { path: "/vulnerabilities", handler: vulnerabilityRoutes, name: "vulnerabilityRoutes" },
  { path: "/branding", handler: brandingRoutes, name: "brandingRoutes" },
  { path: "/license", handler: licenseRoutes, name: "licenseRoutes" },
  { path: "/resilience", handler: resilienceGraphRoutes, name: "resilienceGraphRoutes" },
  { path: "/analysis/resilience", handler: analysisResilienceRoutes, name: "analysisResilienceRoutes" },
  { path: "/bia-resilience", handler: biaResilienceRoutes, name: "biaResilienceRoutes" },
  { path: "/simulations", handler: simulationRoutes, name: "simulationRoutes" },
  { path: "/risks-resilience", handler: riskResilienceRoutes, name: "riskResilienceRoutes" },
  { path: "/recommendations/landing-zone", handler: landingZoneResilienceRoutes, name: "landingZoneResilienceRoutes" },
  { path: "/discovery-resilience", handler: discoveryResilienceRoutes, name: "discoveryResilienceRoutes" },
  { path: "/reports", handler: reportRoutes, name: "reportRoutes" },
  { path: "/exercises-resilience", handler: exerciseResilienceRoutes, name: "exerciseResilienceRoutes" },
  { path: "/integrations", handler: integrationsRoutes, name: "integrationsRoutes" },
  { path: "/currency", handler: currencyRoutes, name: "currencyRoutes" },
  { path: "/recommendations", handler: recommendationEngineRoutes, name: "recommendationEngineRoutes" },
  { path: "/knowledge-base", handler: knowledgeBaseRoutes, name: "knowledgeBaseRoutes" },
  { path: "/drift", handler: driftRoutes, name: "driftRoutes" },
  { path: "/roi", handler: roiRoutes, name: "roiRoutes" },
];

for (const route of routes) {
  const normalizedHandler = normalizeRouteHandler(route.handler, route.name);
  app.use(route.path, normalizedHandler);
}

logBoot("routes.registered", { count: routes.length });

logBoot("background.services.deferred", {
  discoveryWorker: process.env.DISCOVERY_WORKER_ENABLED !== "false",
  documentWorker: process.env.DOCUMENT_WORKER_ENABLED !== "false",
  discoveryScheduler: process.env.DISCOVERY_SCHEDULER_ENABLED !== "false",
  apiKeyRotationWorker: process.env.API_KEY_ROTATION_ENABLED !== "false",
});

// Global error handler - ensure all errors return JSON
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode || 500);
  const message = typeof err?.message === "string" && err.message.trim() ? err.message : "Internal server error";
  const safeMessage = status >= 500 && process.env.NODE_ENV === "production" ? "Internal server error" : message;
  console.error(
    JSON.stringify({
      level: "error",
      scope: "http.globalError",
      status,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    })
  );

  res.status(status).json({
    error: {
      code: `ERR_${status}`,
      message: safeMessage,
    },
  });
});

// 404 handler - ensure 404s return JSON
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: {
      code: "ERR_404",
      message: `Route not found: ${req.method} ${req.path}`,
    },
  });
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

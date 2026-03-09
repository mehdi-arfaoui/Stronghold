import express from "express";
import http from "http";
import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Redis } from "ioredis";
import { Prisma } from "@prisma/client";
import prisma from "./prismaClient.js";
import { getPrometheusMetricsHandler, initTelemetry } from "./observability/telemetry.js";
import { GlobalExceptionFilter } from "./filters/global-exception.filter.js";
import { appLogger } from "./utils/logger.js";

import serviceRoutes from "./routes/serviceRoutes.js";
import graphRoutes from "./routes/graphRoutes.js";
import analysisRoutes from "./routes/analysisRoutes.js";
import infraRoutes from "./routes/infraRoutes.js";
import {
  globalRateLimitLong,
  globalRateLimitMedium,
  globalRateLimitShort,
} from "./middleware/rateLimitMiddleware.js";
import { requestValidationGuard } from "./middleware/requestValidationMiddleware.js";
import { buildRedisConnectionOptions } from "./utils/redisConnection.js";
import scenarioRoutes from "./routes/scenarioRoutes.js";
import scenarioCatalogRoutes from "./routes/scenarioCatalogRoutes.js";
import cyberScenarioRoutes from "./routes/cyberScenarioRoutes.js";
import cyberExerciseRoutes from "./routes/cyberExerciseRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import continuityRoutes from "./routes/continuityRoutes.js";
import runbookRoutes from "./routes/runbookRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import riskRoutes from "./routes/riskRoutes.js";
import biaRoutes from "./routes/biaRoutes.js";
import incidentRoutes from "./routes/incidentRoutes.js";
import exerciseRoutes from "./routes/exerciseRoutes.js";
import discoveryRoutes from "./routes/discoveryRoutes.js";
import pricingRoutes from "./routes/pricingRoutes.js";
import vulnerabilityRoutes from "./routes/vulnerabilityRoutes.js";
import brandingRoutes from "./routes/brandingRoutes.js";
import { createLicenseRoutes } from "./routes/licenseRoutes.js";
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
import complianceRoutes from "./routes/complianceRoutes.js";
import knowledgeBaseRoutes from "./routes/knowledgeBaseRoutes.js";
import driftRoutes from "./routes/driftRoutes.js";
import roiRoutes from "./routes/roiRoutes.js";
import financialRoutes from "./routes/financialRoutes.js";
import businessFlowRoutes from "./routes/businessFlowRoutes.js";
import remediationTaskRoutes from "./routes/remediationTaskRoutes.js";
import praExerciseRoutes from "./routes/praExerciseRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import devRoutes from "./routes/devRoutes.js";
import { startDiscoveryWorker } from "./workers/discoveryWorker.js";
import { startDocumentIngestionWorker } from "./workers/documentIngestionWorker.js";
import { startDiscoveryScheduler } from "./services/scheduledScanService.js";
import { startApiKeyRotationWorker } from "./workers/apiKeyRotationWorker.js";
import { startLicenseQuotaResetWorker } from "./workers/licenseQuotaResetWorker.js";
import { startDriftScheduler } from "./workers/driftScheduler.js";
import { initDiscoveryWebSocket } from "./websockets/discoveryWebsocket.js";
import { deploymentConfig } from "./config/deployment.js";
import { loadValidatedEnv } from "./config/env.validation.js";
import { validateCriticalJsonConfig } from "./config/jsonConfigValidation.js";
import { requireLicense } from "./middleware/licenseMiddleware.js";
import { authMiddleware, requireRole as requireUserRole } from "./middleware/authMiddleware.js";
import { AuthService } from "./services/authService.js";
import { licenseService } from "./services/licenseService.js";
import { cloudPricingService } from "./services/pricing/cloudPricingService.js";

const require = createRequire(import.meta.url);

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

loadValidatedEnv();
try {
  const validatedJson = validateCriticalJsonConfig();
  appLogger.info("boot.config_json.validated", validatedJson);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown_error";
  appLogger.error("CRITICAL: JSON configuration invalid", { error: message });
  process.exit(1);
}
initTelemetry();

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
  appLogger.info("boot", { step, ...meta });
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
  const redis = new Redis({
    ...buildRedisConnectionOptions(),
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

const liveHandler = (_req: express.Request, res: express.Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
};

const readyHandler = async (_req: express.Request, res: express.Response) => {
  const { httpStatus, report } = await buildReadinessReport();
  res.status(httpStatus).json(report);
};

const healthHandler = async (_req: express.Request, res: express.Response) => {
  const { httpStatus, report } = await buildReadinessReport();
  res.status(httpStatus).json({
    ...report,
    deprecated: true,
    live: "/health/live",
    ready: "/health/ready",
  });
};

const app = express();
const globalExceptionFilter = new GlobalExceptionFilter();
const authService = new AuthService(prisma, { licenseService });
app.set("trust proxy", 1);
app.locals.licenseService = licenseService;
app.locals.authService = authService;

app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "https:"],
              connectSrc: ["'self'"],
              fontSrc: ["'self'", "https:", "data:"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
    crossOriginEmbedderPolicy: process.env.NODE_ENV === "production",
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xContentTypeOptions: true,
    xXssProtection: true,
  })
);

const isDevelopment = process.env.NODE_ENV !== "production";

const configuredOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const devOrigins = isDevelopment
  ? ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173"]
  : [];

const allowedOrigins = new Set([...configuredOrigins, ...devOrigins]);

logBoot("config.loaded", {
  nodeEnv: process.env.NODE_ENV || "development",
  allowedOriginsCount: allowedOrigins.size,
  allowNoOrigin: true,
});

// Configure CORS to allow requests from frontend
const corsOptions = {
  origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (health checks, CLI, mobile clients)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-Id", "x-api-key"],
  maxAge: 86400,
} as CorsOptions;

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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(requestValidationGuard);
app.use(globalRateLimitShort);
app.use(globalRateLimitMedium);
app.use(globalRateLimitLong);

// ✅ health-check sans tenant
app.get("/health/live", liveHandler);
app.get("/api/health/live", liveHandler);
app.get("/health/ready", readyHandler);
app.get("/api/health/ready", readyHandler);
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

const publicLicenseRoutes = createLicenseRoutes(licenseService);
app.use("/license", publicLicenseRoutes);
app.use("/api/license", publicLicenseRoutes);

app.get("/metrics", (_req, res) => {
  const handler = getPrometheusMetricsHandler();
  return handler(_req, res);
});

// ✅ à partir d'ici, on exige une API key et on injecte tenantId
// Wrapper pour gérer les middlewares async
app.use(requireLicense);
app.use("/auth", authRoutes);
app.use("/api/auth", authRoutes);
app.use(authMiddleware);
app.use("/users", requireUserRole("ADMIN"), userRoutes);
app.use("/api/users", requireUserRole("ADMIN"), userRoutes);

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
  { path: "/audit-logs", handler: auditRoutes, name: "auditRoutes" },
  { path: "/risks", handler: riskRoutes, name: "riskRoutes" },
  { path: "/bia", handler: biaRoutes, name: "biaRoutes" },
  { path: "/incidents", handler: incidentRoutes, name: "incidentRoutes" },
  { path: "/exercises", handler: exerciseRoutes, name: "exerciseRoutes" },
  { path: "/discovery", handler: discoveryRoutes, name: "discoveryRoutes" },
  { path: "/pricing", handler: pricingRoutes, name: "pricingRoutes" },
  { path: "/vulnerabilities", handler: vulnerabilityRoutes, name: "vulnerabilityRoutes" },
  { path: "/branding", handler: brandingRoutes, name: "brandingRoutes" },
  { path: "/resilience", handler: resilienceGraphRoutes, name: "resilienceGraphRoutes" },
  { path: "/analysis/resilience", handler: analysisResilienceRoutes, name: "analysisResilienceRoutes" },
  { path: "/api/analysis/resilience", handler: analysisResilienceRoutes, name: "analysisResilienceRoutesApi" },
  { path: "/bia-resilience", handler: biaResilienceRoutes, name: "biaResilienceRoutes" },
  { path: "/simulations", handler: simulationRoutes, name: "simulationRoutes" },
  { path: "/risks-resilience", handler: riskResilienceRoutes, name: "riskResilienceRoutes" },
  { path: "/recommendations/landing-zone", handler: landingZoneResilienceRoutes, name: "landingZoneResilienceRoutes" },
  { path: "/discovery-resilience", handler: discoveryResilienceRoutes, name: "discoveryResilienceRoutes" },
  { path: "/api/discovery-resilience", handler: discoveryResilienceRoutes, name: "discoveryResilienceRoutesApi" },
  { path: "/reports", handler: reportRoutes, name: "reportRoutes" },
  { path: "/api/reports", handler: reportRoutes, name: "reportRoutesApi" },
  { path: "/exercises-resilience", handler: exerciseResilienceRoutes, name: "exerciseResilienceRoutes" },
  { path: "/integrations", handler: integrationsRoutes, name: "integrationsRoutes" },
  { path: "/currency", handler: currencyRoutes, name: "currencyRoutes" },
  { path: "/recommendations", handler: recommendationEngineRoutes, name: "recommendationEngineRoutes" },
  { path: "/compliance", handler: complianceRoutes, name: "complianceRoutes" },
  { path: "/api/compliance", handler: complianceRoutes, name: "complianceRoutesApi" },
  { path: "/knowledge-base", handler: knowledgeBaseRoutes, name: "knowledgeBaseRoutes" },
  { path: "/drift", handler: driftRoutes, name: "driftRoutes" },
  { path: "/roi", handler: roiRoutes, name: "roiRoutes" },
  { path: "/financial", handler: financialRoutes, name: "financialRoutes" },
  { path: "/business-flows", handler: businessFlowRoutes, name: "businessFlowRoutes" },
  { path: "/remediation-tasks", handler: remediationTaskRoutes, name: "remediationTaskRoutes" },
  { path: "/pra-exercises", handler: praExerciseRoutes, name: "praExerciseRoutes" },
  { path: "/dashboard", handler: dashboardRoutes, name: "dashboardRoutes" },
  { path: "/api/dashboard", handler: dashboardRoutes, name: "dashboardRoutesApi" },
  ...(isDevelopment
    ? [{ path: "/dev", handler: devRoutes, name: "devRoutes" }]
    : []),
];

for (const route of routes) {
  const normalizedHandler = normalizeRouteHandler(route.handler, route.name);
  app.use(route.path, normalizedHandler);
}

if (process.env.BUILD_TARGET === "internal") {
  try {
    const demoRoutes = require("./demo/demoRoutes.js");
    const normalizedDemoRoutes = normalizeRouteHandler(demoRoutes, "demoRoutes");
    app.use("/discovery-resilience", normalizedDemoRoutes);
    app.use("/api/discovery-resilience", normalizedDemoRoutes);
    logBoot("routes.demo.loaded", {
      paths: ["/discovery-resilience", "/api/discovery-resilience"],
    });
  } catch {
    // Demo module absent in client builds or stripped artifacts.
  }
}

logBoot("routes.registered", { count: routes.length });

logBoot("background.services.deferred", {
  discoveryWorker: process.env.DISCOVERY_WORKER_ENABLED !== "false",
  documentWorker: process.env.DOCUMENT_WORKER_ENABLED !== "false",
  discoveryScheduler: process.env.DISCOVERY_SCHEDULER_ENABLED !== "false",
  apiKeyRotationWorker: process.env.API_KEY_ROTATION_ENABLED !== "false",
});

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) =>
  globalExceptionFilter.catch(err, req, res, next)
);

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

licenseService.initialize()
  .then(() => {
    app.locals.licenseService = licenseService;
    app.locals.authService = authService;
    const stopLicenseValidation = () => {
      licenseService.shutdown();
    };
    process.on("SIGTERM", stopLicenseValidation);
    process.on("SIGINT", stopLicenseValidation);

    server.listen(Number(PORT), HOST, () => {
      appLogger.info(`API PRA/PCA running on ${HOST}:${PORT}`);
      logBoot("server.listening", { host: HOST, port: Number(PORT) });
      const originList = [...allowedOrigins.values()];
      appLogger.info(
        `CORS enabled for origins: ${originList.length > 0 ? originList.join(", ") : "none"}`
      );
      appLogger.info(
        `Health checks available at http://${HOST}:${PORT}/health/live (liveness) and /health/ready (readiness)`
      );
      if (deploymentConfig.mode === "saas") {
        appLogger.info("Deployment mode: SaaS (multi-tenant mutualisé, schéma par tenant, quotas actifs).");
      } else {
        appLogger.info("Deployment mode: On-premise (auto-mise à jour désactivée).");
        appLogger.info(`License status: ${licenseService.getStatus()}`);
      }

      setImmediate(() => {
        void cloudPricingService.runConnectivitySelfTest();
      });

      setImmediate(() => {
        void startBackgroundServices();
      });

      const refreshTokenCleanupTimer = setInterval(() => {
        void (async () => {
          try {
            const count = await authService.cleanupExpiredTokens();
            if (count > 0) {
              appLogger.info(`[AUTH] ${count} refresh token(s) expire(s) nettoye(s)`);
            }
          } catch (error) {
            appLogger.error("[AUTH] Erreur nettoyage tokens:", error);
          }
        })();
      }, 24 * 60 * 60 * 1000);
      refreshTokenCleanupTimer.unref?.();

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
  })
  .catch((error) => {
    appLogger.error("Server bootstrap failed", error);
    process.exitCode = 1;
  });

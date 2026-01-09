import express from "express";
import cors, { type CorsOptions } from "cors";
import dotenv from "dotenv";
import prisma from "./prismaClient";
import { metricsConfig } from "./config/observability";
import { getMetricsSnapshot, getPrometheusMetrics } from "./observability/metrics";

import serviceRoutes from "./routes/serviceRoutes";
import graphRoutes from "./routes/graphRoutes";
import analysisRoutes from "./routes/analysisRoutes";
import infraRoutes from "./routes/infraRoutes";
import { tenantMiddleware } from "./middleware/tenantMiddleware";
import scenarioRoutes from "./routes/scenarioRoutes";
import scenarioCatalogRoutes from "./routes/scenarioCatalogRoutes";
import documentRoutes from "./routes/documentRoutes";
import continuityRoutes from "./routes/continuityRoutes";
import runbookRoutes from "./routes/runbookRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import authRoutes from "./routes/authRoutes";
import auditRoutes from "./routes/auditRoutes";
import riskRoutes from "./routes/riskRoutes";
import biaRoutes from "./routes/biaRoutes";
import incidentRoutes from "./routes/incidentRoutes";
import exerciseRoutes from "./routes/exerciseRoutes";
import discoveryRoutes from "./routes/discoveryRoutes";
import pricingRoutes from "./routes/pricingRoutes";
import { startDiscoveryWorker } from "./workers/discoveryWorker";

dotenv.config();

const app = express();

const isDevelopment = process.env.NODE_ENV !== "production";
const allowAllDevOrigins =
  isDevelopment &&
  String(process.env.CORS_DEV_ALLOW_ALL || "true").toLowerCase() === "true";

const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGIN,
    ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173", // Vite default port
  ]
    .filter((origin): origin is string => typeof origin === "string" && origin.length > 0)
    .map((origin) => origin.trim())
    .filter(Boolean)
);

// Configure CORS to allow requests from frontend
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowAllDevOrigins) {
      return callback(null, true);
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
app.get("/health", async (_req, res) => {
  const tenantsCount = await prisma.tenant.count();
  const metrics = getMetricsSnapshot();
  res.json({
    status: "ok",
    tenantsCount,
    metrics,
    alerts: {
      extractionFailureRate: metrics.extraction.failureRate >= metricsConfig.extractionFailureAlertThreshold,
      llmFailureRate: metrics.llm.failureRate >= metricsConfig.llmFailureAlertThreshold,
    },
  });
});

app.get("/metrics", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.status(200).send(getPrometheusMetrics());
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
  { path: "/scenarios", handler: scenarioRoutes, name: "scenarioRoutes" },
  { path: "/scenario-catalog", handler: scenarioCatalogRoutes, name: "scenarioCatalogRoutes" },
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
];

for (const route of routes) {
  const normalizedHandler = normalizeRouteHandler(route.handler, route.name);
  app.use(route.path, normalizedHandler);
}

if (process.env.DISCOVERY_WORKER_ENABLED !== "false") {
  startDiscoveryWorker();
}

// Global error handler - ensure all errors return JSON
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// 404 handler - ensure 404s return JSON
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`API PRA/PCA running on ${HOST}:${PORT}`);
  console.log(`CORS enabled for origins: ${process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "all"}`);
  console.log(`Health check available at http://${HOST}:${PORT}/health`);
});

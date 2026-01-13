"use strict";

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
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
const { startDiscoveryScheduler } = require("./services/discoveryScheduleService");

dotenv.config();
initTelemetry();

const app = express();

const isDevelopment = process.env.NODE_ENV !== "production";
const allowAllDevOrigins =
  isDevelopment && String(process.env.CORS_DEV_ALLOW_ALL || "true").toLowerCase() === "true";

const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGIN,
    ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173", // Vite default port
  ]
    .map((origin) => origin.trim())
    .filter(Boolean)
);

// Configure CORS to allow requests from frontend
const corsOptions = {
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
  res.json({
    status: "ok",
    tenantsCount,
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

if (process.env.DISCOVERY_WORKER_ENABLED !== "false") {
  startDiscoveryWorker();
}

if (process.env.DOCUMENT_WORKER_ENABLED !== "false") {
  startDocumentIngestionWorker();
}

if (process.env.DISCOVERY_SCHEDULER_ENABLED !== "false") {
  startDiscoveryScheduler();
}

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

app.listen(PORT, HOST, () => {
  console.log(`API PRA/PCA running on ${HOST}:${PORT}`);
  console.log(
    `CORS enabled for origins: ${
      process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "all"
    }`
  );
  console.log(`Health check available at http://${HOST}:${PORT}/health`);
});

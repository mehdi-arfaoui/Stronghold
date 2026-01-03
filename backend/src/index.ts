import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import prisma from "./prismaClient";
import { metricsConfig } from "./config/observability";
import { getMetricsSnapshot } from "./observability/metrics";

import serviceRoutes from "./routes/serviceRoutes";
import graphRoutes from "./routes/graphRoutes";
import analysisRoutes from "./routes/analysisRoutes";
import infraRoutes from "./routes/infraRoutes";
import { tenantMiddleware } from "./middleware/tenantMiddleware";
import scenarioRoutes from "./routes/scenarioRoutes";
import documentRoutes from "./routes/documentRoutes";
import continuityRoutes from "./routes/continuityRoutes";
import runbookRoutes from "./routes/runbookRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import authRoutes from "./routes/authRoutes";

dotenv.config();

const app = express();

// Configure CORS to allow requests from frontend
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173", // Vite default port
    ].filter(Boolean);
    
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for development
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-correlation-id"],
};

app.use(cors(corsOptions));
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

// ✅ à partir d'ici, on exige une API key et on injecte tenantId
app.use(tenantMiddleware as any);

app.use("/services", serviceRoutes);
app.use("/graph", graphRoutes);
app.use("/analysis", analysisRoutes);
app.use("/infra", infraRoutes);
app.use("/scenarios", scenarioRoutes);
app.use("/documents", documentRoutes);
app.use("/continuity", continuityRoutes);
app.use("/runbooks", runbookRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/auth", authRoutes);


const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`API PRA/PCA running on ${HOST}:${PORT}`);
  console.log(`CORS enabled for origins: ${process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "all"}`);
  console.log(`Health check available at http://${HOST}:${PORT}/health`);
});

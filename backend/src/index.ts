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

app.use(cors());
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

app.listen(PORT, () => {
  console.log(`API PRA/PCA running on port ${PORT}`);
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const prismaClient_1 = __importDefault(require("./prismaClient"));
const observability_1 = require("./config/observability");
const metrics_1 = require("./observability/metrics");
const serviceRoutes_1 = __importDefault(require("./routes/serviceRoutes"));
const graphRoutes_1 = __importDefault(require("./routes/graphRoutes"));
const analysisRoutes_1 = __importDefault(require("./routes/analysisRoutes"));
const infraRoutes_1 = __importDefault(require("./routes/infraRoutes"));
const tenantMiddleware_1 = require("./middleware/tenantMiddleware");
const scenarioRoutes_1 = __importDefault(require("./routes/scenarioRoutes"));
const documentRoutes_1 = __importDefault(require("./routes/documentRoutes"));
const continuityRoutes_1 = __importDefault(require("./routes/continuityRoutes"));
const runbookRoutes_1 = __importDefault(require("./routes/runbookRoutes"));
const webhookRoutes_1 = __importDefault(require("./routes/webhookRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// ✅ health-check sans tenant
app.get("/health", async (_req, res) => {
    const tenantsCount = await prismaClient_1.default.tenant.count();
    const metrics = (0, metrics_1.getMetricsSnapshot)();
    res.json({
        status: "ok",
        tenantsCount,
        metrics,
        alerts: {
            extractionFailureRate: metrics.extraction.failureRate >= observability_1.metricsConfig.extractionFailureAlertThreshold,
            llmFailureRate: metrics.llm.failureRate >= observability_1.metricsConfig.llmFailureAlertThreshold,
        },
    });
});
// ✅ à partir d'ici, on exige une API key et on injecte tenantId
app.use(tenantMiddleware_1.tenantMiddleware);
app.use("/services", serviceRoutes_1.default);
app.use("/graph", graphRoutes_1.default);
app.use("/analysis", analysisRoutes_1.default);
app.use("/infra", infraRoutes_1.default);
app.use("/scenarios", scenarioRoutes_1.default);
app.use("/documents", documentRoutes_1.default);
app.use("/continuity", continuityRoutes_1.default);
app.use("/runbooks", runbookRoutes_1.default);
app.use("/webhooks", webhookRoutes_1.default);
app.use("/auth", authRoutes_1.default);
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`API PRA/PCA running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map
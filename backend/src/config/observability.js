"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsConfig = exports.retentionConfig = void 0;
const toPositiveInt = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
exports.retentionConfig = {
    documentRetentionDays: toPositiveInt(process.env.DOC_RETENTION_DAYS, 180),
    embeddingRetentionDays: toPositiveInt(process.env.EMBEDDING_RETENTION_DAYS, 365),
};
exports.metricsConfig = {
    extractionFailureAlertThreshold: Math.min(0.95, Math.max(0.01, Number(process.env.EXTRACTION_FAILURE_ALERT_THRESHOLD || 0.2))),
    llmFailureAlertThreshold: Math.min(0.95, Math.max(0.01, Number(process.env.LLM_FAILURE_ALERT_THRESHOLD || 0.15))),
};
//# sourceMappingURL=observability.js.map
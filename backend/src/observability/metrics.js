"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRagMrr = exports.recordRagRecall = exports.recordDiscoveryJobResult = exports.recordLlmCall = exports.recordExtractionResult = void 0;
const telemetry_1 = require("./telemetry");
let extractionCounter = null;
let llmCounter = null;
let discoveryCounter = null;
let ragRecallHistogram = null;
let ragRecallSamples = null;
let ragMrrHistogram = null;
let ragMrrSamples = null;
function ensureMetrics() {
  if (extractionCounter && llmCounter && discoveryCounter && ragRecallHistogram && ragRecallSamples &&
    ragMrrHistogram && ragMrrSamples) {
    return;
  }
  const meter = (0, telemetry_1.getMeter)();
  extractionCounter = meter.createCounter("stronghold_extraction_total", {
    description: "Total extraction attempts.",
  });
  llmCounter = meter.createCounter("stronghold_llm_total", {
    description: "Total LLM calls.",
  });
  discoveryCounter = meter.createCounter("stronghold_discovery_job_total", {
    description: "Total discovery job outcomes.",
  });
  ragRecallHistogram = meter.createHistogram("stronghold_rag_recall", {
    description: "RAG recall@k distribution.",
  });
  ragRecallSamples = meter.createCounter("stronghold_rag_recall_samples_total", {
    description: "Total RAG recall@k samples.",
  });
  ragMrrHistogram = meter.createHistogram("stronghold_rag_mrr", {
    description: "RAG MRR distribution.",
  });
  ragMrrSamples = meter.createCounter("stronghold_rag_mrr_samples_total", {
    description: "Total RAG MRR samples.",
  });
}
function recordExtractionResult(success, tenantId) {
  ensureMetrics();
  extractionCounter.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}
exports.recordExtractionResult = recordExtractionResult;
function recordLlmCall(success, tenantId) {
  ensureMetrics();
  llmCounter.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}
exports.recordLlmCall = recordLlmCall;
function recordDiscoveryJobResult(success, tenantId) {
  ensureMetrics();
  discoveryCounter.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}
exports.recordDiscoveryJobResult = recordDiscoveryJobResult;
function recordRagRecall(params) {
  const relevantSet = new Set(params.relevantDocumentIds);
  if (relevantSet.size === 0)
    return;
  const rankedUnique = Array.from(new Set(params.rankedDocumentIds));
  for (const k of params.ks) {
    const topK = rankedUnique.slice(0, k);
    const hits = topK.filter((id) => relevantSet.has(id)).length;
    const recall = Number((hits / relevantSet.size).toFixed(4));
    ensureMetrics();
    const attributes = { k: String(k), tenant_id: params.tenantId };
    ragRecallHistogram.record(recall, attributes);
    ragRecallSamples.add(1, attributes);
  }
}
exports.recordRagRecall = recordRagRecall;
function recordRagMrr(params) {
  const relevantSet = new Set(params.relevantDocumentIds);
  if (relevantSet.size === 0)
    return;
  const rankedUnique = Array.from(new Set(params.rankedDocumentIds));
  let reciprocal = 0;
  for (let index = 0; index < rankedUnique.length; index += 1) {
    if (relevantSet.has(rankedUnique[index])) {
      reciprocal = Number((1 / (index + 1)).toFixed(4));
      break;
    }
  }
  ensureMetrics();
  const attributes = { tenant_id: params.tenantId };
  ragMrrHistogram.record(reciprocal, attributes);
  ragMrrSamples.add(1, attributes);
}
exports.recordRagMrr = recordRagMrr;

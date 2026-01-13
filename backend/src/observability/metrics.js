"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMetricsSnapshot = exports.recordRagRecall = exports.recordDiscoveryJobResult = exports.recordLlmCall = exports.recordExtractionResult = void 0;
const telemetry_1 = require("./telemetry");
const counters = {
  extraction: { success: 0, failure: 0, lastFailureAt: null },
  llm: { success: 0, failure: 0, lastFailureAt: null },
  discovery: { success: 0, failure: 0, lastFailureAt: null },
};
const tenantCounters = new Map();
const ragRecallStats = new Map();
const tenantRagRecallStats = new Map();
let extractionCounter = null;
let llmCounter = null;
let discoveryCounter = null;
let ragRecallHistogram = null;
let ragRecallSamples = null;
function ensureMetrics() {
  if (extractionCounter && llmCounter && discoveryCounter && ragRecallHistogram && ragRecallSamples) {
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
}
function createCounterSet() {
  return {
    extraction: { success: 0, failure: 0, lastFailureAt: null },
    llm: { success: 0, failure: 0, lastFailureAt: null },
    discovery: { success: 0, failure: 0, lastFailureAt: null },
  };
}
function getTenantCounterSet(tenantId) {
  const existing = tenantCounters.get(tenantId);
  if (existing) {
    return existing;
  }
  const created = createCounterSet();
  tenantCounters.set(tenantId, created);
  return created;
}
function getRecallBucket(map, k) {
  const existing = map.get(k);
  if (existing)
    return existing;
  const created = { sum: 0, count: 0, lastValue: 0 };
  map.set(k, created);
  return created;
}
function getTenantRecallMap(tenantId) {
  const existing = tenantRagRecallStats.get(tenantId);
  if (existing)
    return existing;
  const created = new Map();
  tenantRagRecallStats.set(tenantId, created);
  return created;
}
function incrementCounter(key, success, tenantId) {
  const counter = counters[key];
  if (success) {
    counter.success += 1;
  }
  else {
    counter.failure += 1;
    counter.lastFailureAt = new Date();
  }
  if (tenantId) {
    const tenantCounter = getTenantCounterSet(tenantId)[key];
    if (success) {
      tenantCounter.success += 1;
    }
    else {
      tenantCounter.failure += 1;
      tenantCounter.lastFailureAt = new Date();
    }
  }
}
function failureRate(counter) {
  const total = counter.success + counter.failure;
  if (total === 0)
    return 0;
  return Number((counter.failure / total).toFixed(4));
}
function recordExtractionResult(success, tenantId) {
  incrementCounter("extraction", success, tenantId);
  ensureMetrics();
  extractionCounter.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}
exports.recordExtractionResult = recordExtractionResult;
function recordLlmCall(success, tenantId) {
  incrementCounter("llm", success, tenantId);
  ensureMetrics();
  llmCounter.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}
exports.recordLlmCall = recordLlmCall;
function recordDiscoveryJobResult(success, tenantId) {
  incrementCounter("discovery", success, tenantId);
  ensureMetrics();
  discoveryCounter.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}
exports.recordDiscoveryJobResult = recordDiscoveryJobResult;
function snapshotCounterSet(counterSet) {
  return {
    extraction: {
      ...counterSet.extraction,
      failureRate: failureRate(counterSet.extraction),
    },
    llm: {
      ...counterSet.llm,
      failureRate: failureRate(counterSet.llm),
    },
    discovery: {
      ...counterSet.discovery,
      failureRate: failureRate(counterSet.discovery),
    },
  };
}
function recordRagRecall(params) {
  const relevantSet = new Set(params.relevantDocumentIds);
  if (relevantSet.size === 0)
    return;
  const rankedUnique = Array.from(new Set(params.rankedDocumentIds));
  const tenantMap = getTenantRecallMap(params.tenantId);
  for (const k of params.ks) {
    const topK = rankedUnique.slice(0, k);
    const hits = topK.filter((id) => relevantSet.has(id)).length;
    const recall = Number((hits / relevantSet.size).toFixed(4));
    const globalBucket = getRecallBucket(ragRecallStats, k);
    globalBucket.sum += recall;
    globalBucket.count += 1;
    globalBucket.lastValue = recall;
    const tenantBucket = getRecallBucket(tenantMap, k);
    tenantBucket.sum += recall;
    tenantBucket.count += 1;
    tenantBucket.lastValue = recall;
    ensureMetrics();
    const attributes = { k: String(k), tenant_id: params.tenantId };
    ragRecallHistogram.record(recall, attributes);
    ragRecallSamples.add(1, attributes);
  }
}
exports.recordRagRecall = recordRagRecall;
function getMetricsSnapshot() {
  const perTenant = {};
  for (const [tenantId, counterSet] of tenantCounters.entries()) {
    perTenant[tenantId] = snapshotCounterSet(counterSet);
  }
  const ragRecall = {};
  for (const [k, stats] of ragRecallStats.entries()) {
    ragRecall[String(k)] = {
      average: stats.count === 0 ? 0 : Number((stats.sum / stats.count).toFixed(4)),
      count: stats.count,
      lastValue: stats.lastValue,
    };
  }
  const perTenantRecall = {};
  for (const [tenantId, tenantMap] of tenantRagRecallStats.entries()) {
    const tenantStats = {};
    for (const [k, stats] of tenantMap.entries()) {
      tenantStats[String(k)] = {
        average: stats.count === 0 ? 0 : Number((stats.sum / stats.count).toFixed(4)),
        count: stats.count,
        lastValue: stats.lastValue,
      };
    }
    perTenantRecall[tenantId] = tenantStats;
  }
  return {
    ...snapshotCounterSet(counters),
    perTenant,
    ragRecall,
    ragRecallPerTenant: perTenantRecall,
  };
}
exports.getMetricsSnapshot = getMetricsSnapshot;

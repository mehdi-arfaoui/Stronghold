"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrometheusMetrics = exports.getMetricsSnapshot = exports.recordRagRecall = exports.recordLlmCall = exports.recordExtractionResult = void 0;
const counters = {
  extraction: { success: 0, failure: 0, lastFailureAt: null },
  llm: { success: 0, failure: 0, lastFailureAt: null },
};
const tenantCounters = new Map();
const ragRecallStats = new Map();
const tenantRagRecallStats = new Map();
function createCounterSet() {
  return {
    extraction: { success: 0, failure: 0, lastFailureAt: null },
    llm: { success: 0, failure: 0, lastFailureAt: null },
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
}
exports.recordExtractionResult = recordExtractionResult;
function recordLlmCall(success, tenantId) {
  incrementCounter("llm", success, tenantId);
}
exports.recordLlmCall = recordLlmCall;
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
  };
}
function escapeLabelValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
function formatLabels(labels) {
  if (!labels || Object.keys(labels).length === 0)
    return "";
  const formatted = Object.entries(labels)
    .map(([key, val]) => `${key}="${escapeLabelValue(val)}"`)
    .join(",");
  return `{${formatted}}`;
}
function appendCounterLine(lines, name, value, labels) {
  lines.push(`${name}${formatLabels(labels)} ${value}`);
}
function appendGaugeLine(lines, name, value, labels) {
  lines.push(`${name}${formatLabels(labels)} ${value}`);
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
function getPrometheusMetrics() {
  const lines = [];
  lines.push("# HELP stronghold_extraction_success_total Total successful extractions.");
  lines.push("# TYPE stronghold_extraction_success_total counter");
  lines.push("# HELP stronghold_extraction_failure_total Total failed extractions.");
  lines.push("# TYPE stronghold_extraction_failure_total counter");
  lines.push("# HELP stronghold_llm_success_total Total successful LLM calls.");
  lines.push("# TYPE stronghold_llm_success_total counter");
  lines.push("# HELP stronghold_llm_failure_total Total failed LLM calls.");
  lines.push("# TYPE stronghold_llm_failure_total counter");
  lines.push("# HELP stronghold_rag_recall_at_k Average recall@k for RAG retrieval.");
  lines.push("# TYPE stronghold_rag_recall_at_k gauge");
  lines.push("# HELP stronghold_rag_recall_samples_total Total recall@k samples.");
  lines.push("# TYPE stronghold_rag_recall_samples_total counter");
  appendCounterLine(lines, "stronghold_extraction_success_total", counters.extraction.success);
  appendCounterLine(lines, "stronghold_extraction_failure_total", counters.extraction.failure);
  appendCounterLine(lines, "stronghold_llm_success_total", counters.llm.success);
  appendCounterLine(lines, "stronghold_llm_failure_total", counters.llm.failure);
  for (const [k, stats] of ragRecallStats.entries()) {
    const average = stats.count === 0 ? 0 : stats.sum / stats.count;
    appendGaugeLine(lines, "stronghold_rag_recall_at_k", average, { k: String(k) });
    appendCounterLine(lines, "stronghold_rag_recall_samples_total", stats.count, { k: String(k) });
  }
  for (const [tenantId, counterSet] of tenantCounters.entries()) {
    const labels = { tenant_id: tenantId };
    appendCounterLine(lines, "stronghold_extraction_success_total", counterSet.extraction.success, labels);
    appendCounterLine(lines, "stronghold_extraction_failure_total", counterSet.extraction.failure, labels);
    appendCounterLine(lines, "stronghold_llm_success_total", counterSet.llm.success, labels);
    appendCounterLine(lines, "stronghold_llm_failure_total", counterSet.llm.failure, labels);
  }
  for (const [tenantId, tenantMap] of tenantRagRecallStats.entries()) {
    for (const [k, stats] of tenantMap.entries()) {
      const labels = { tenant_id: tenantId, k: String(k) };
      const average = stats.count === 0 ? 0 : stats.sum / stats.count;
      appendGaugeLine(lines, "stronghold_rag_recall_at_k", average, labels);
      appendCounterLine(lines, "stronghold_rag_recall_samples_total", stats.count, labels);
    }
  }
  return `${lines.join("\n")}\n`;
}
exports.getPrometheusMetrics = getPrometheusMetrics;

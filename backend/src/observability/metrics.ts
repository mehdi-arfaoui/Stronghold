import { getMeter } from "./telemetry.js";

type Counter = {
  success: number;
  failure: number;
  lastFailureAt: Date | null;
};

type CounterKey = "extraction" | "llm" | "discovery";

type CounterSet = Record<CounterKey, Counter>;

const counters: CounterSet = {
  extraction: { success: 0, failure: 0, lastFailureAt: null },
  llm: { success: 0, failure: 0, lastFailureAt: null },
  discovery: { success: 0, failure: 0, lastFailureAt: null },
};

let extractionCounter:
  | ReturnType<ReturnType<typeof getMeter>["createCounter"]>
  | null = null;
let llmCounter: ReturnType<ReturnType<typeof getMeter>["createCounter"]> | null = null;
let discoveryCounter:
  | ReturnType<ReturnType<typeof getMeter>["createCounter"]>
  | null = null;
let ragRecallHistogram:
  | ReturnType<ReturnType<typeof getMeter>["createHistogram"]>
  | null = null;
let ragRecallSamples:
  | ReturnType<ReturnType<typeof getMeter>["createCounter"]>
  | null = null;

function ensureMetrics() {
  if (
    extractionCounter &&
    llmCounter &&
    discoveryCounter &&
    ragRecallHistogram &&
    ragRecallSamples
  ) {
    return;
  }
  const meter = getMeter();
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

const tenantCounters = new Map<string, CounterSet>();
const ragRecallStats = new Map<number, { sum: number; count: number; lastValue: number }>();
const tenantRagRecallStats = new Map<
  string,
  Map<number, { sum: number; count: number; lastValue: number }>
>();

function createCounterSet(): CounterSet {
  return {
    extraction: { success: 0, failure: 0, lastFailureAt: null },
    llm: { success: 0, failure: 0, lastFailureAt: null },
    discovery: { success: 0, failure: 0, lastFailureAt: null },
  };
}

function getTenantCounterSet(tenantId: string): CounterSet {
  const existing = tenantCounters.get(tenantId);
  if (existing) {
    return existing;
  }
  const created = createCounterSet();
  tenantCounters.set(tenantId, created);
  return created;
}

function getRecallBucket(
  map: Map<number, { sum: number; count: number; lastValue: number }>,
  k: number
) {
  const existing = map.get(k);
  if (existing) return existing;
  const created = { sum: 0, count: 0, lastValue: 0 };
  map.set(k, created);
  return created;
}

function getTenantRecallMap(tenantId: string) {
  const existing = tenantRagRecallStats.get(tenantId);
  if (existing) return existing;
  const created = new Map<number, { sum: number; count: number; lastValue: number }>();
  tenantRagRecallStats.set(tenantId, created);
  return created;
}

function incrementCounter(key: CounterKey, success: boolean, tenantId?: string) {
  const counter = counters[key];
  if (success) {
    counter.success += 1;
  } else {
    counter.failure += 1;
    counter.lastFailureAt = new Date();
  }

  if (tenantId) {
    const tenantCounter = getTenantCounterSet(tenantId)[key];
    if (success) {
      tenantCounter.success += 1;
    } else {
      tenantCounter.failure += 1;
      tenantCounter.lastFailureAt = new Date();
    }
  }
}

function failureRate(counter: Counter): number {
  const total = counter.success + counter.failure;
  if (total === 0) return 0;
  return Number((counter.failure / total).toFixed(4));
}

export function recordExtractionResult(success: boolean, tenantId?: string) {
  incrementCounter("extraction", success, tenantId);
  ensureMetrics();
  extractionCounter!.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}

export function recordLlmCall(success: boolean, tenantId?: string) {
  incrementCounter("llm", success, tenantId);
  ensureMetrics();
  llmCounter!.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}

export function recordDiscoveryJobResult(success: boolean, tenantId?: string) {
  incrementCounter("discovery", success, tenantId);
  ensureMetrics();
  discoveryCounter!.add(1, {
    result: success ? "success" : "failure",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}

function snapshotCounterSet(counterSet: CounterSet) {
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

export function recordRagRecall(params: {
  tenantId: string;
  relevantDocumentIds: string[];
  rankedDocumentIds: string[];
  ks: number[];
}) {
  const relevantSet = new Set(params.relevantDocumentIds);
  if (relevantSet.size === 0) return;
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
    ragRecallHistogram!.record(recall, attributes);
    ragRecallSamples!.add(1, attributes);
  }
}

export function getMetricsSnapshot() {
  const perTenant: Record<string, ReturnType<typeof snapshotCounterSet>> = {};
  for (const [tenantId, counterSet] of tenantCounters.entries()) {
    perTenant[tenantId] = snapshotCounterSet(counterSet);
  }

  const ragRecall: Record<string, { average: number; count: number; lastValue: number }> = {};
  for (const [k, stats] of ragRecallStats.entries()) {
    ragRecall[String(k)] = {
      average: stats.count === 0 ? 0 : Number((stats.sum / stats.count).toFixed(4)),
      count: stats.count,
      lastValue: stats.lastValue,
    };
  }

  const perTenantRecall: Record<
    string,
    Record<string, { average: number; count: number; lastValue: number }>
  > = {};
  for (const [tenantId, tenantMap] of tenantRagRecallStats.entries()) {
    const tenantStats: Record<string, { average: number; count: number; lastValue: number }> = {};
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

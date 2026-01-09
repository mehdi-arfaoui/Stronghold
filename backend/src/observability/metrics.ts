type Counter = {
  success: number;
  failure: number;
  lastFailureAt: Date | null;
};

type CounterKey = "extraction" | "llm";

type CounterSet = Record<CounterKey, Counter>;

const counters: CounterSet = {
  extraction: { success: 0, failure: 0, lastFailureAt: null },
  llm: { success: 0, failure: 0, lastFailureAt: null },
};

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
}

export function recordLlmCall(success: boolean, tenantId?: string) {
  incrementCounter("llm", success, tenantId);
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
  };
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  const formatted = Object.entries(labels)
    .map(([key, val]) => `${key}="${escapeLabelValue(val)}"`)
    .join(",");
  return `{${formatted}}`;
}

function appendCounterLine(
  lines: string[],
  name: string,
  value: number,
  labels?: Record<string, string>
) {
  lines.push(`${name}${formatLabels(labels)} ${value}`);
}

function appendGaugeLine(
  lines: string[],
  name: string,
  value: number,
  labels?: Record<string, string>
) {
  lines.push(`${name}${formatLabels(labels)} ${value}`);
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

export function getPrometheusMetrics() {
  const lines: string[] = [];
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
    appendCounterLine(
      lines,
      "stronghold_extraction_success_total",
      counterSet.extraction.success,
      labels
    );
    appendCounterLine(
      lines,
      "stronghold_extraction_failure_total",
      counterSet.extraction.failure,
      labels
    );
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

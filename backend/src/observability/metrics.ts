type Counter = {
  success: number;
  failure: number;
  lastFailureAt: Date | null;
};

const counters: Record<"extraction" | "llm", Counter> = {
  extraction: { success: 0, failure: 0, lastFailureAt: null },
  llm: { success: 0, failure: 0, lastFailureAt: null },
};

function incrementCounter(key: "extraction" | "llm", success: boolean) {
  const counter = counters[key];
  if (success) {
    counter.success += 1;
  } else {
    counter.failure += 1;
    counter.lastFailureAt = new Date();
  }
}

function failureRate(counter: Counter): number {
  const total = counter.success + counter.failure;
  if (total === 0) return 0;
  return Number((counter.failure / total).toFixed(4));
}

export function recordExtractionResult(success: boolean) {
  incrementCounter("extraction", success);
}

export function recordLlmCall(success: boolean) {
  incrementCounter("llm", success);
}

export function getMetricsSnapshot() {
  return {
    extraction: {
      ...counters.extraction,
      failureRate: failureRate(counters.extraction),
    },
    llm: {
      ...counters.llm,
      failureRate: failureRate(counters.llm),
    },
  };
}

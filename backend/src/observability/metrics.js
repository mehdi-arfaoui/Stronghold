"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordExtractionResult = recordExtractionResult;
exports.recordLlmCall = recordLlmCall;
exports.getMetricsSnapshot = getMetricsSnapshot;
const counters = {
    extraction: { success: 0, failure: 0, lastFailureAt: null },
    llm: { success: 0, failure: 0, lastFailureAt: null },
};
function incrementCounter(key, success) {
    const counter = counters[key];
    if (success) {
        counter.success += 1;
    }
    else {
        counter.failure += 1;
        counter.lastFailureAt = new Date();
    }
}
function failureRate(counter) {
    const total = counter.success + counter.failure;
    if (total === 0)
        return 0;
    return Number((counter.failure / total).toFixed(4));
}
function recordExtractionResult(success) {
    incrementCounter("extraction", success);
}
function recordLlmCall(success) {
    incrementCounter("llm", success);
}
function getMetricsSnapshot() {
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
//# sourceMappingURL=metrics.js.map
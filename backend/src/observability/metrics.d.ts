export declare function recordExtractionResult(success: boolean): void;
export declare function recordLlmCall(success: boolean): void;
export declare function getMetricsSnapshot(): {
    extraction: {
        failureRate: number;
        success: number;
        failure: number;
        lastFailureAt: Date | null;
    };
    llm: {
        failureRate: number;
        success: number;
        failure: number;
        lastFailureAt: Date | null;
    };
};
//# sourceMappingURL=metrics.d.ts.map
export declare function recordExtractionResult(success: boolean, tenantId?: string): void;
export declare function recordLlmCall(success: boolean, tenantId?: string): void;
export declare function recordDiscoveryJobResult(success: boolean, tenantId?: string): void;
export declare function recordRagRecall(params: {
    tenantId: string;
    relevantDocumentIds: string[];
    rankedDocumentIds: string[];
    ks: number[];
}): void;
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
    discovery: {
        failureRate: number;
        success: number;
        failure: number;
        lastFailureAt: Date | null;
    };
    perTenant: Record<string, {
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
        discovery: {
            failureRate: number;
            success: number;
            failure: number;
            lastFailureAt: Date | null;
        };
    }>;
    ragRecall: Record<string, {
        average: number;
        count: number;
        lastValue: number;
    }>;
    ragRecallPerTenant: Record<string, Record<string, {
        average: number;
        count: number;
        lastValue: number;
    }>>;
};

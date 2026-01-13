export declare function recordExtractionResult(success: boolean, tenantId?: string): void;
export declare function recordLlmCall(success: boolean, tenantId?: string): void;
export declare function recordDiscoveryJobResult(success: boolean, tenantId?: string): void;
export declare function recordRagRecall(params: {
    tenantId: string;
    relevantDocumentIds: string[];
    rankedDocumentIds: string[];
    ks: number[];
}): void;
export declare function recordRagMrr(params: {
    tenantId: string;
    relevantDocumentIds: string[];
    rankedDocumentIds: string[];
}): void;

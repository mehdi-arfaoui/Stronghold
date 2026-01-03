import { ExtractedFactCategory } from "./extractedFactSchema";
export interface AiExtractedFact {
    type: string;
    category: ExtractedFactCategory | string;
    label: string;
    data: Record<string, unknown>;
    source?: string | null;
    confidence?: number | null;
}
export interface AiExtractedFactsResult {
    facts: AiExtractedFact[];
}
export declare class OpenAiCallError extends Error {
    status: number | undefined;
    correlationId: string;
    constructor(message: string, status: number | undefined, correlationId: string);
}
type RetryConfig = {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    chunkTimeoutMs: number;
};
type PartialRetryConfig = Partial<RetryConfig>;
interface AnalyzeParams {
    text: string;
    documentName?: string | null;
    docType?: string | null;
    correlationId?: string | null;
    retryConfig?: PartialRetryConfig;
}
export declare function analyzeExtractedFacts(params: AnalyzeParams): Promise<AiExtractedFact[]>;
export {};
//# sourceMappingURL=extractedFactsAnalyzer.d.ts.map
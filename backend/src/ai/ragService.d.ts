import { Prisma, PrismaClient } from "@prisma/client";
import { DrScenario } from "../analysis/drStrategyEngine";
type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;
export type RagChunk = {
    documentId: string;
    documentName: string;
    documentType?: string | null;
    score: number;
    text: string;
};
export type RagFact = {
    id: string;
    documentId: string;
    label: string;
    category: string;
    dataPreview: string;
    confidence?: number | null;
    score: number;
};
export type RagContext = {
    chunks: RagChunk[];
    extractedFacts: RagFact[];
};
export type RagQueryOptions = {
    tenantId: string;
    question: string;
    documentIds?: string[] | null;
    documentTypes?: string[] | null;
    serviceFilter?: string | null;
    maxChunks?: number;
    maxFacts?: number;
    prismaClient?: PrismaClientOrTx;
};
export type RagScenarioRecommendation = {
    scenarioId: string;
    name: string;
    reason: string[];
    score: number;
    matchedServices: string[];
};
export type { RagChunkCandidate } from "./ragRanking";
export { fuseChunkScores, rerankChunksRrf } from "./ragRanking";
export declare function retrieveRagContext(options: RagQueryOptions): Promise<{
    context: RagContext;
    usedDocumentIds: string[];
    questionTokens: Set<string>;
}>;
export declare function draftAnswerFromContext(question: string, context: RagContext): string;
export declare function buildRagPrompt(params: {
    question: string;
    context: RagContext;
    maxTotalLength?: number;
}): {
    prompt: string;
    totalChars: number;
};
export declare function recommendScenariosWithRag(params: {
    tenantId: string;
    question?: string;
    services?: {
        id: string;
        name: string;
        type: string;
        criticality: string | null;
    }[];
    scenarios?: DrScenario[];
    context?: RagContext;
    maxResults?: number;
    prismaClient?: PrismaClientOrTx;
}): Promise<RagScenarioRecommendation[]>;
export declare function generatePraReport(params: {
    tenantId: string;
    question: string;
    documentIds?: string[];
    documentTypes?: string[];
    serviceFilter?: string | null;
    maxChunks?: number;
    maxFacts?: number;
    prismaClient?: PrismaClientOrTx;
}): Promise<{
    prompt: string;
    promptSize: number;
    context: RagContext;
    draftAnswer: string;
    scenarioRecommendations: RagScenarioRecommendation[];
    usedDocumentIds: string[];
}>;
export declare function generateRunbookDraft(params: {
    tenantId: string;
    question: string;
    documentIds?: string[];
    documentTypes?: string[];
    serviceFilter?: string | null;
}): Promise<{
    sources: string[];
    draftRunbook: string;
    prompt: string;
    promptSize: number;
    context: RagContext;
    draftAnswer: string;
    scenarioRecommendations: RagScenarioRecommendation[];
    usedDocumentIds: string[];
}>;
export {};
//# sourceMappingURL=ragService.d.ts.map

import { analyzeExtractedFacts } from "../ai/extractedFactsAnalyzer";
import { Prisma, PrismaClient } from "@prisma/client";
import { ExtractedFactCategory } from "../ai/extractedFactSchema";
type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;
export interface ExtractedFactPayload {
    id: string;
    documentId: string;
    type: string;
    category: ExtractedFactCategory;
    label: string;
    data: Record<string, unknown>;
    source?: string | null;
    confidence?: number | null;
    createdAt: Date;
    updatedAt: Date;
}
export declare class DocumentNotFoundError extends Error {
    status: number;
    constructor();
}
export declare class MissingExtractedTextError extends Error {
    status: number;
    constructor();
}
export declare function getOrCreateExtractedFacts(documentId: string, tenantId: string, force?: boolean, prismaClient?: PrismaClientOrTx, factAnalyzer?: typeof analyzeExtractedFacts): Promise<{
    documentId: string;
    facts: ExtractedFactPayload[];
}>;
export {};
//# sourceMappingURL=extractedFactService.d.ts.map
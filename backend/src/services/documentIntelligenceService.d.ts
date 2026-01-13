export type DetectedDocType = "ARCHI" | "BACKUP_POLICY" | "POLICY" | "SLA" | "RUNBOOK" | "CMDB" | "CONTRACT" | "RISK" | "UNKNOWN";
export interface ClassifiedDocument {
    type: DetectedDocType;
    confidence: number;
    reasons: string[];
}
export interface DetectedMetadata {
    services: string[];
    slas: string[];
    rtoHours?: number;
    rpoMinutes?: number;
    mtpdHours?: number;
    backupMentions?: string[];
    dependencies?: string[];
    structuredSummary?: string;
}
export interface DocumentChunk {
    id: string;
    content: string;
    hash: string;
    metadata: Record<string, unknown>;
}
export interface MetadataMapping {
    services: string[];
    dependencies: Array<{
        from?: string;
        to: string;
        targetIsInfra: boolean;
    }>;
    infra: Array<{
        name: string;
        type: string;
        provider?: string;
    }>;
}
export declare function parseDependencyExpression(raw: string): {
    from?: string;
    to: string;
} | null;
export declare function inferInfraComponent(label: string): {
    name: string;
    type: string;
    provider?: string;
} | null;
export declare function deriveMetadataMappings(metadata: DetectedMetadata): MetadataMapping;
export declare function classifyDocumentType(text: string, fileName?: string | null, providedDocType?: string | null): ClassifiedDocument;
export declare function extractDocumentMetadata(text: string): DetectedMetadata;
export declare function extractStructuredMetadata(structuredPayload: unknown): DetectedMetadata;
export declare function buildChunks(text: string, baseMetadata: Record<string, unknown>, maxLength?: number, overlap?: number): DocumentChunk[];
export declare function buildChromaCollectionName(baseCollection: string, tenantId: string): string;
export declare function pushChunksToChroma(chunks: DocumentChunk[], tenantId: string, documentId: string, retention?: {
    document?: Date | null;
    embedding?: Date | null;
}): Promise<{
    submitted: number;
    skippedReason?: string;
}>;
export declare function serializeMetadata(metadata: DetectedMetadata): string;
//# sourceMappingURL=documentIntelligenceService.d.ts.map

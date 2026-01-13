export type RagChunkCandidate = {
    chunkKey: string;
    documentId: string;
    documentName: string;
    documentType?: string | null;
    text: string;
    score: number;
    bm25Score?: number;
    vectorScore?: number;
    fusedScore?: number;
    rrfScore?: number;
    crossScore?: number;
};
export declare function fuseChunkScores(candidates: RagChunkCandidate[], alpha: number): RagChunkCandidate[];
export declare function rerankChunksRrf(candidates: RagChunkCandidate[], rankLists: {
    vector: string[];
    bm25: string[];
}, k?: number): RagChunkCandidate[];
export declare function rerankChunksCrossEncoder(candidates: RagChunkCandidate[], question: string, weights?: {
    lexical: number;
    vector: number;
    bm25: number;
}): RagChunkCandidate[];

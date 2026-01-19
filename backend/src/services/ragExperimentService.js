"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRuntimeConfigFromVariant = exports.recordRagExperimentFeedback = exports.getOrCreateRagExperimentAssignment = void 0;
const crypto_1 = require("node:crypto");
const prismaClient_1 = require("../prismaClient");
const DEFAULT_EXPERIMENT_KEY = "rag-retrieval-v1";
const DEFAULT_SUBJECT_ID = "tenant";
const VARIANTS = [
    {
        key: "bm25-only",
        label: "BM25 uniquement",
        runtimeConfig: {
            mode: "lexical",
            rerankStrategy: "none",
        },
    },
    {
        key: "bm25-embeddings",
        label: "BM25 + embeddings",
        runtimeConfig: {
            mode: "hybrid",
            rerankStrategy: "none",
        },
    },
    {
        key: "rerank-rrf",
        label: "Reranking RRF",
        runtimeConfig: {
            mode: "hybrid",
            rerankStrategy: "rrf",
        },
    },
];
function pickVariant(seed) {
    const hash = (0, crypto_1.createHash)("sha256").update(seed).digest("hex");
    const bucket = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
    const index = bucket < 1 / VARIANTS.length
        ? 0
        : bucket < 2 / VARIANTS.length
            ? 1
            : 2;
    return VARIANTS[index] ?? VARIANTS[0];
}
async function getOrCreateRagExperimentAssignment(params) {
    const experimentKey = params.experimentKey ?? DEFAULT_EXPERIMENT_KEY;
    const subjectId = params.subjectId?.trim() || DEFAULT_SUBJECT_ID;
    const existing = await prismaClient_1.default.ragExperimentAssignment.findFirst({
        where: { tenantId: params.tenantId, experimentKey, subjectId },
    });
    if (existing) {
        const variant = VARIANTS.find((item) => item.key === existing.variant) ?? VARIANTS[0];
        return { assignment: existing, variant };
    }
    const variant = pickVariant(`${params.tenantId}:${subjectId}:${experimentKey}`);
    const assignment = await prismaClient_1.default.ragExperimentAssignment.create({
        data: {
            tenantId: params.tenantId,
            experimentKey,
            subjectId,
            variant: variant.key,
            context: {
                label: variant.label,
            },
        },
    });
    return { assignment, variant };
}
exports.getOrCreateRagExperimentAssignment = getOrCreateRagExperimentAssignment;
async function recordRagExperimentFeedback(params) {
    return prismaClient_1.default.ragExperimentFeedback.create({
        data: {
            tenantId: params.tenantId,
            experimentKey: params.experimentKey,
            subjectId: params.subjectId,
            variant: params.variant,
            rating: params.rating ?? null,
            comment: params.comment ?? null,
        },
    });
}
exports.recordRagExperimentFeedback = recordRagExperimentFeedback;
function buildRuntimeConfigFromVariant(variant, experimentKey) {
    return {
        ...variant.runtimeConfig,
        experimentKey,
        variant: variant.key,
    };
}
exports.buildRuntimeConfigFromVariant = buildRuntimeConfigFromVariant;

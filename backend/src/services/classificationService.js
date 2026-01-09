"use strict";
const crypto = require("node:crypto");
const IORedis = require("ioredis");
const extractedFactsAnalyzer_1 = require("../ai/extractedFactsAnalyzer");
const extractedFactSchema_1 = require("../ai/extractedFactSchema");
const CACHE_PREFIX = "classification";
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
let redisClient = null;
function resolveCacheTtlSeconds() {
    const value = Number(process.env.CLASSIFICATION_CACHE_TTL_SEC ?? "");
    if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return DEFAULT_CACHE_TTL_SECONDS;
}
function shouldUseCache() {
    return (process.env.CLASSIFICATION_CACHE_ENABLED === "true" ||
        Boolean(process.env.REDIS_URL));
}
function getRedisClient() {
    if (!shouldUseCache()) {
        return null;
    }
    if (!redisClient) {
        redisClient = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    }
    return redisClient;
}
function normalizeCategory(category) {
    const upper = (category ?? "OTHER").toString().toUpperCase();
    return extractedFactSchema_1.EXTRACTED_FACT_CATEGORIES.includes(upper)
        ? upper
        : "OTHER";
}
async function readCache(cacheClient, cacheKey) {
    try {
        const cached = await cacheClient.get(cacheKey);
        if (!cached) {
            return null;
        }
        const parsed = JSON.parse(cached);
        if (!parsed ||
            parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
            !Array.isArray(parsed.facts)) {
            return null;
        }
        return parsed;
    }
    catch (_err) {
        return null;
    }
}
async function writeCache(cacheClient, cacheKey, payload) {
    try {
        const ttlSeconds = resolveCacheTtlSeconds();
        if (ttlSeconds > 0) {
            await cacheClient.set(cacheKey, JSON.stringify(payload), "EX", ttlSeconds);
        }
        else {
            await cacheClient.set(cacheKey, JSON.stringify(payload));
        }
    }
    catch (_err) {
        // Cache failures should not block classification.
    }
}
function computeDocumentHash(text) {
    return crypto.createHash("sha256").update(text).digest("hex");
}
function buildClassificationCacheKey(tenantId, docHash) {
    return `${CACHE_PREFIX}:${tenantId}:${docHash}`;
}
async function classifyDocumentFacts(params) {
    const docHash = computeDocumentHash(params.text);
    const cacheClient = params.cacheClient ?? getRedisClient();
    const cacheKey = buildClassificationCacheKey(params.tenantId, docHash);
    if (cacheClient) {
        const cached = await readCache(cacheClient, cacheKey);
        if (cached) {
            return { facts: cached.facts, docHash, cached: true };
        }
    }
    const analyzer = params.factAnalyzer ?? extractedFactsAnalyzer_1.analyzeExtractedFacts;
    const facts = await analyzer({
        text: params.text,
        documentName: params.documentName,
        docType: params.docType,
        correlationId: params.correlationId,
        tenantId: params.tenantId,
    });
    if (cacheClient) {
        await writeCache(cacheClient, cacheKey, {
            schemaVersion: CACHE_SCHEMA_VERSION,
            facts,
        });
    }
    return { facts, docHash, cached: false };
}
async function updateCachedClassification(params) {
    const cacheClient = params.cacheClient ?? getRedisClient();
    if (!cacheClient) {
        return false;
    }
    const cacheKey = buildClassificationCacheKey(params.tenantId, params.docHash);
    const cached = await readCache(cacheClient, cacheKey);
    if (!cached) {
        return false;
    }
    const originalCategory = normalizeCategory(params.originalFact.category);
    const index = cached.facts.findIndex((fact) => fact.label === params.originalFact.label &&
        fact.type === params.originalFact.type &&
        normalizeCategory(fact.category) === originalCategory);
    if (index === -1) {
        return false;
    }
    const updatedFacts = [...cached.facts];
    const current = updatedFacts[index];
    updatedFacts[index] = {
        ...current,
        type: params.updatedFact.type ?? current.type,
        category: params.updatedFact.category ?? current.category,
        label: params.updatedFact.label ?? current.label,
        data: params.updatedFact.data ?? current.data,
        source: params.updatedFact.source ?? current.source,
        confidence: params.updatedFact.confidence ?? current.confidence,
    };
    await writeCache(cacheClient, cacheKey, {
        schemaVersion: CACHE_SCHEMA_VERSION,
        facts: updatedFacts,
    });
    return true;
}
module.exports = {
    buildClassificationCacheKey,
    classifyDocumentFacts,
    computeDocumentHash,
    updateCachedClassification,
};

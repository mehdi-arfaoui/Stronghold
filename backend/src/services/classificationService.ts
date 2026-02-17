import crypto from "node:crypto";
import { Redis } from "ioredis";
import { analyzeExtractedFacts } from "../ai/extractedFactsAnalyzer.js";
import type { AiExtractedFact } from "../ai/extractedFactsAnalyzer.js";
import { EXTRACTED_FACT_CATEGORIES } from "../ai/extractedFactSchema.js";
import type { ExtractedFactCategory } from "../ai/extractedFactSchema.js";
import { buildRedisConnectionOptions } from "../utils/redisConnection.js";

type CacheClient = Pick<Redis, "get" | "set">;

const CACHE_PREFIX = "classification";
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

let redisClient: CacheClient | null = null;

function resolveCacheTtlSeconds() {
  const value = Number(process.env.CLASSIFICATION_CACHE_TTL_SEC ?? "");
  if (Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_CACHE_TTL_SECONDS;
}

function shouldUseCache() {
  return (
    process.env.CLASSIFICATION_CACHE_ENABLED === "true" ||
    Boolean(process.env.REDIS_URL)
  );
}

function getRedisClient(): CacheClient | null {
  if (!shouldUseCache()) {
    return null;
  }
  if (!redisClient) {
    redisClient = new Redis({
      ...buildRedisConnectionOptions(),
      maxRetriesPerRequest: null,
    });
  }
  return redisClient;
}

function normalizeCategory(category: string | null | undefined): ExtractedFactCategory {
  const upper = (category ?? "OTHER").toString().toUpperCase();
  return EXTRACTED_FACT_CATEGORIES.includes(upper as ExtractedFactCategory)
    ? (upper as ExtractedFactCategory)
    : "OTHER";
}

type CachePayload = {
  schemaVersion: number;
  facts: AiExtractedFact[];
};

async function readCache(
  cacheClient: CacheClient,
  cacheKey: string
): Promise<CachePayload | null> {
  try {
    const cached = await cacheClient.get(cacheKey);
    if (!cached) {
      return null;
    }
    const parsed = JSON.parse(cached) as CachePayload;
    if (
      !parsed ||
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
      !Array.isArray(parsed.facts)
    ) {
      return null;
    }
    return parsed;
  } catch (_err) {
    return null;
  }
}

async function writeCache(
  cacheClient: CacheClient,
  cacheKey: string,
  payload: CachePayload
) {
  try {
    const ttlSeconds = resolveCacheTtlSeconds();
    if (ttlSeconds > 0) {
      await cacheClient.set(
        cacheKey,
        JSON.stringify(payload),
        "EX",
        ttlSeconds
      );
    } else {
      await cacheClient.set(cacheKey, JSON.stringify(payload));
    }
  } catch (_err) {
    // Cache failures should not block classification.
  }
}

export function computeDocumentHash(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function buildClassificationCacheKey(tenantId: string, docHash: string) {
  return `${CACHE_PREFIX}:${tenantId}:${docHash}`;
}

export async function classifyDocumentFacts(params: {
  text: string;
  documentName?: string | null;
  docType?: string | null;
  tenantId: string;
  correlationId: string;
  factAnalyzer?: typeof analyzeExtractedFacts;
  cacheClient?: CacheClient | null;
}): Promise<{ facts: AiExtractedFact[]; docHash: string; cached: boolean }> {
  const docHash = computeDocumentHash(params.text);
  const cacheClient = params.cacheClient ?? getRedisClient();
  const cacheKey = buildClassificationCacheKey(params.tenantId, docHash);

  if (cacheClient) {
    const cached = await readCache(cacheClient, cacheKey);
    if (cached) {
      return { facts: cached.facts, docHash, cached: true };
    }
  }

  const analyzer = params.factAnalyzer ?? analyzeExtractedFacts;
  const facts = await analyzer({
    text: params.text,
    correlationId: params.correlationId,
    tenantId: params.tenantId,
    ...(params.documentName !== undefined ? { documentName: params.documentName } : {}),
    ...(params.docType !== undefined ? { docType: params.docType } : {}),
  });

  if (cacheClient) {
    await writeCache(cacheClient, cacheKey, {
      schemaVersion: CACHE_SCHEMA_VERSION,
      facts,
    });
  }

  return { facts, docHash, cached: false };
}

export async function updateCachedClassification(params: {
  tenantId: string;
  docHash: string;
  originalFact: {
    type: string;
    category: string;
    label: string;
  };
  updatedFact: {
    type: string;
    category: string;
    label: string;
    data?: Record<string, unknown>;
    source?: string | null;
    confidence?: number | null;
  };
  cacheClient?: CacheClient | null;
}) {
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
  const index = cached.facts.findIndex(
    (fact) =>
      fact.label === params.originalFact.label &&
      fact.type === params.originalFact.type &&
      normalizeCategory(fact.category) === originalCategory
  );

  if (index === -1) {
    return false;
  }

  const updatedFacts = [...cached.facts];
  const current = updatedFacts[index];
  if (!current) {
    return false;
  }
  updatedFacts[index] = {
    ...current,
    type: params.updatedFact.type ?? current.type,
    category: params.updatedFact.category ?? current.category,
    label: params.updatedFact.label ?? current.label,
    data: params.updatedFact.data ?? current.data,
    source: params.updatedFact.source ?? current.source ?? null,
    confidence: params.updatedFact.confidence ?? current.confidence ?? null,
  };

  await writeCache(cacheClient, cacheKey, {
    schemaVersion: CACHE_SCHEMA_VERSION,
    facts: updatedFacts,
  });

  return true;
}

import { EXTRACTED_FACT_CATEGORIES } from "./extractedFactSchema.js";
import type { ExtractedFactCategory } from "./extractedFactSchema.js";
import { recordLlmCall } from "../observability/metrics.js";
import { getTracer } from "../observability/telemetry.js";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  readCircuitBreakerState,
  writeCircuitBreakerState,
} from "./circuitBreakerStore.js";
import { notifyN8nAlert } from "../services/n8nAlertService.js";

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

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "category", "label", "data"],
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            description:
              "Short classifier for the fact (ex: PRA_PCA_FACT, GOVERNANCE, RISK_CONTROL).",
          },
          category: {
            type: "string",
            enum: [...EXTRACTED_FACT_CATEGORIES],
            description: "Normalized PRA/PCA category of the fact.",
          },
          label: {
            type: "string",
            description: "Human friendly label of the fact.",
          },
          data: {
            type: "object",
            description: "Structured attributes describing the fact (key/value).",
            additionalProperties: true,
            properties: {
              service: {
                type: "string",
                description: "Service name when applicable.",
              },
              infra: {
                type: "string",
                description: "Infrastructure component when applicable.",
              },
              sla: {
                type: "string",
                description: "SLA target or constraint when applicable.",
              },
            },
          },
          source: {
            type: "string",
            description: "Short snippet or page reference without copying the whole document.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence between 0 and 1.",
          },
        },
      },
    },
  },
} as const;

export class OpenAiCallError extends Error {
  status: number | undefined;
  correlationId: string;

  constructor(message: string, status: number | undefined, correlationId: string) {
    super(message);
    this.name = "OpenAiCallError";
    this.status = status;
    this.correlationId = correlationId;
  }
}

type RetryConfig = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  chunkTimeoutMs: number;
};

type PartialRetryConfig = Partial<RetryConfig>;

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 1500,
  chunkTimeoutMs: 20_000,
};

type CircuitBreakerConfig = {
  failureThreshold: number;
  openDurationMs: number;
};

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  openDurationMs: 60_000,
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

interface AnalyzeParams {
  text: string;
  documentName?: string | null;
  docType?: string | null;
  correlationId?: string | null;
  tenantId?: string | null;
  retryConfig?: PartialRetryConfig;
}

function safeParseJson<T>(value: unknown): T | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch (_err) {
      return null;
    }
  }
  if (value && typeof value === "object") {
    return value as T;
  }
  return null;
}

function extractJsonFromResponse(payload: any): AiExtractedFactsResult {
  const firstOutput = payload?.output?.[0];
  const firstContent = firstOutput?.content?.[0];

  const jsonPayload =
    firstContent?.json ??
    firstContent?.text ??
    payload?.output_text ??
    payload?.response_text;

  const parsed = safeParseJson<AiExtractedFactsResult>(jsonPayload);
  if (parsed?.facts && Array.isArray(parsed.facts)) {
    return parsed;
  }

  throw new Error("Unable to parse structured JSON response from OpenAI");
}

function resolveRetryConfig(overrides?: PartialRetryConfig): RetryConfig {
  const config: RetryConfig = {
    maxAttempts: overrides?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    initialDelayMs:
      overrides?.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs: overrides?.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
    chunkTimeoutMs:
      overrides?.chunkTimeoutMs ?? DEFAULT_RETRY_CONFIG.chunkTimeoutMs,
  };
  return {
    maxAttempts: Math.max(1, config.maxAttempts),
    initialDelayMs: Math.max(0, config.initialDelayMs),
    maxDelayMs: Math.max(config.initialDelayMs, config.maxDelayMs),
    chunkTimeoutMs: Math.max(0, config.chunkTimeoutMs),
  };
}

function resolveCircuitConfig(): CircuitBreakerConfig {
  const thresholdEnv = Number(process.env.OPENAI_CIRCUIT_BREAKER_THRESHOLD ?? "");
  const openDurationEnv = Number(process.env.OPENAI_CIRCUIT_BREAKER_OPEN_MS ?? "");
  return {
    failureThreshold: Number.isFinite(thresholdEnv) && thresholdEnv > 0 ? thresholdEnv : DEFAULT_CIRCUIT_CONFIG.failureThreshold,
    openDurationMs: Number.isFinite(openDurationEnv) && openDurationEnv > 0 ? openDurationEnv : DEFAULT_CIRCUIT_CONFIG.openDurationMs,
  };
}

async function ensureCircuitOpen(correlationId: string, tenantId: string) {
  const config = resolveCircuitConfig();
  const circuitBreakerState = await readCircuitBreakerState(tenantId);
  if (circuitBreakerState.openedAt === null) {
    return;
  }

  const elapsed = Date.now() - circuitBreakerState.openedAt;
  if (elapsed < config.openDurationMs) {
    throw new OpenAiCallError(
      `OpenAI circuit breaker open [correlationId=${correlationId}]`,
      503,
      correlationId
    );
  }

  circuitBreakerState.failures = 0;
  circuitBreakerState.openedAt = null;
  await writeCircuitBreakerState(tenantId, circuitBreakerState);
}

async function recordCircuitSuccess(tenantId: string) {
  await writeCircuitBreakerState(tenantId, { failures: 0, openedAt: null });
}

async function recordCircuitFailure(tenantId: string) {
  const config = resolveCircuitConfig();
  const circuitBreakerState = await readCircuitBreakerState(tenantId);
  circuitBreakerState.failures += 1;
  if (circuitBreakerState.failures >= config.failureThreshold) {
    circuitBreakerState.openedAt = Date.now();
  }
  await writeCircuitBreakerState(tenantId, circuitBreakerState);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenAiWithRetry(
  requestBody: unknown,
  headers: Record<string, string>,
  correlationId: string,
  tenantId: string,
  retryOverrides?: PartialRetryConfig
) {
  await ensureCircuitOpen(correlationId, tenantId);
  const config = resolveRetryConfig(retryOverrides);
  let attempt = 0;
  let delay = config.initialDelayMs;

  while (attempt < config.maxAttempts) {
    attempt += 1;
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timeoutId =
      controller && config.chunkTimeoutMs > 0
        ? setTimeout(() => controller.abort(), config.chunkTimeoutMs)
        : undefined;

    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller?.signal ?? null,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (response.ok) {
        await recordCircuitSuccess(tenantId);
        return response;
      }

      if (attempt >= config.maxAttempts) {
        const message = await response.text().catch(() => response.statusText);
        await recordCircuitFailure(tenantId);
        throw new OpenAiCallError(
          `OpenAI request failed (${response.status}) [correlationId=${correlationId}]: ${message}`,
          response.status,
          correlationId
        );
      }
    } catch (err: any) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (attempt >= config.maxAttempts) {
        const message = err?.message || "OpenAI request failed";
        await recordCircuitFailure(tenantId);
        throw new OpenAiCallError(
          `${message} [correlationId=${correlationId}]`,
          err?.status ?? err?.code,
          correlationId
        );
      }
    }

    await sleep(Math.min(delay, config.maxDelayMs));
    delay = Math.min(delay * 2, config.maxDelayMs);
  }

  await recordCircuitFailure(tenantId);
  throw new OpenAiCallError(
    `OpenAI request failed [correlationId=${correlationId}]`,
    undefined,
    correlationId
  );
}

export async function analyzeExtractedFacts(
  params: AnalyzeParams
): Promise<AiExtractedFact[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  const correlationId = params.correlationId || "openai-analyzer";
  const tenantId = params.tenantId ?? "global";
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const truncatedText = params.text.slice(0, 12000);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const requestBody = {
    model,
    temperature: 0.1,
    input: [
      {
        role: "system",
        content:
          "Tu es un assistant PRA/PCA qui extrait des faits exploitables et structurés. Reste concis, inclue la catégorie (SERVICE, INFRA, RISK, RTO_RPO, SLA, OTHER), un label bref, des données structurées (ex: service, infra, sla), et si possible une courte référence de source (page ou extrait <280 caractères). N'inclus jamais le texte complet du document.",
      },
      {
        role: "user",
        content: `Document: ${params.documentName || "document"} (type: ${
          params.docType || "inconnu"
        }). Analyse et extrait les faits PRA/PCA.`,
      },
      {
        role: "user",
        content: truncatedText,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "extracted_facts",
        schema: RESPONSE_SCHEMA,
        strict: true,
      },
    },
  };

  const tracer = getTracer();
  const span = tracer.startSpan("llm.openai.request", {
    attributes: {
      "llm.provider": "openai",
      "llm.model": model,
      "tenant.id": tenantId,
      "correlation_id": correlationId,
    },
  });

  let response;
  try {
    response = await callOpenAiWithRetry(
      requestBody,
      headers,
      correlationId,
      tenantId,
      params.retryConfig
    );
  } catch (err) {
    recordLlmCall(false, params.tenantId ?? undefined);
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
    const status = err instanceof OpenAiCallError ? err.status : undefined;
    void notifyN8nAlert({
      event: status === 429 ? "llm.quota" : "llm.error",
      tenantId,
      correlationId,
      status,
      message: err instanceof Error ? err.message : "LLM error",
    });
    span.end();
    throw err;
  }

  try {
    const payload = await response.json();
    const parsed = extractJsonFromResponse(payload);
    recordLlmCall(true, params.tenantId ?? undefined);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    return parsed.facts;
  } catch (err: any) {
    recordLlmCall(false, params.tenantId ?? undefined);
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.end();
    const message = err?.message || "Failed to parse OpenAI response";
    void notifyN8nAlert({
      event: "llm.error",
      tenantId,
      correlationId,
      message,
    });
    throw new OpenAiCallError(
      `${message} [correlationId=${correlationId}]`,
      undefined,
      correlationId
    );
  }
}

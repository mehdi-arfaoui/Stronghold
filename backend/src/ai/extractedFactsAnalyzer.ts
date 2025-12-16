import {
  EXTRACTED_FACT_CATEGORIES,
  ExtractedFactCategory,
} from "./extractedFactSchema";

export class OpenAiCallError extends Error {
  correlationId: string;
  status: number | undefined;

  constructor(message: string, correlationId: string, status?: number) {
    super(message);
    this.name = "OpenAiCallError";
    this.correlationId = correlationId;
    this.status = status ?? undefined;
  }
}

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

interface AnalyzeParams {
  text: string;
  documentName?: string | null;
  docType?: string | null;
  correlationId?: string;
  retryConfig?: Partial<RetryConfig>;
}

interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  chunkTimeoutMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  chunkTimeoutMs: 25000,
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffDelay(attempt: number, config: RetryConfig) {
  const factor = Math.pow(2, attempt - 1);
  return Math.min(config.initialDelayMs * factor, config.maxDelayMs);
}

function shouldRetry(status: number | undefined) {
  if (!status) return false;
  return status === 429 || status >= 500;
}

function logOpenAiError(
  correlationId: string,
  details: { attempt: number; status: number | undefined; message: string }
) {
  // Minimal, anonymized logging (no document text).
  console.error("[OpenAI] request error", {
    correlationId,
    attempt: details.attempt,
    status: details.status ?? "unknown",
    message: details.message.slice(0, 300),
  });
}

async function callOpenAiWithRetry(
  requestBody: any,
  headers: Record<string, string>,
  correlationId: string,
  retryConfig: RetryConfig
) {
  let lastError: OpenAiCallError | null = null;

  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), retryConfig.chunkTimeoutMs);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return response;
      }

      const status: number | undefined = response.status;
      const message = response.statusText || "OpenAI non-OK response";
      lastError = new OpenAiCallError(
        `OpenAI request failed (status ${status}) [correlationId=${correlationId}]`,
        correlationId,
        status
      );

      logOpenAiError(correlationId, { attempt, status, message });

      if (!shouldRetry(status) || attempt === retryConfig.maxAttempts) {
        throw lastError;
      }

      await delay(computeBackoffDelay(attempt, retryConfig));
    } catch (err: any) {
      clearTimeout(timeout);

      const status: number | undefined = (err as any)?.status ?? lastError?.status;
      const isAbortError = err?.name === "AbortError";
      const sanitizedMessage = err?.message || (isAbortError ? "OpenAI request timed out" : "Unknown OpenAI error");

      lastError = new OpenAiCallError(
        `${sanitizedMessage} [correlationId=${correlationId}]`,
        correlationId,
        status
      );

      logOpenAiError(correlationId, {
        attempt,
        status,
        message: sanitizedMessage,
      });

      if (attempt === retryConfig.maxAttempts || (!isAbortError && !shouldRetry(status))) {
        throw lastError;
      }

      await delay(computeBackoffDelay(attempt, retryConfig));
    }
  }

  throw lastError ?? new OpenAiCallError(
    `OpenAI request failed [correlationId=${correlationId}]`,
    correlationId
  );
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

export async function analyzeExtractedFacts(
  params: AnalyzeParams
): Promise<AiExtractedFact[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const truncatedText = params.text.slice(0, 12000);
  const correlationId = params.correlationId || "openai-analyzer";
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...(params.retryConfig || {}) };

  const requestBody = {
    model,
    temperature: 0.1,
    input: [
      {
        role: "system",
        content:
          "Tu es un assistant PRA/PCA qui extrait des faits exploitables et structurés. Reste concis, inclue la catégorie (SERVICE, INFRA, RISK, RTO_RPO, OTHER), un label bref, des données structurées, et si possible une courte référence de source (page ou extrait <280 caractères). N'inclus jamais le texte complet du document.",
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

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await callOpenAiWithRetry(
    requestBody,
    headers,
    correlationId,
    retryConfig
  );

  try {
    const payload = await response.json();
    const parsed = extractJsonFromResponse(payload);
    return parsed.facts;
  } catch (err: any) {
    const message = err?.message || "Failed to parse OpenAI response";
    logOpenAiError(correlationId, {
      attempt: retryConfig.maxAttempts,
      status: undefined,
      message,
    });
    throw new OpenAiCallError(
      `${message} [correlationId=${correlationId}]`,
      correlationId
    );
  }
}

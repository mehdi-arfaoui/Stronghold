import {
  EXTRACTED_FACT_CATEGORIES,
  ExtractedFactCategory,
} from "./extractedFactSchema";

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

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
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
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI API error (${response.status}): ${message}`);
  }

  const payload = await response.json();
  const parsed = extractJsonFromResponse(payload);

  return parsed.facts;
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

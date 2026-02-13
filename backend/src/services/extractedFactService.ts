import { appLogger } from "../utils/logger.js";
import prisma from "../prismaClient.js";
import { analyzeExtractedFacts } from "../ai/extractedFactsAnalyzer.js";
import { Prisma, PrismaClient } from "@prisma/client";
import type { Document, ExtractedFact } from "@prisma/client";
import { EXTRACTED_FACT_CATEGORIES } from "../ai/extractedFactSchema.js";
import type { ExtractedFactCategory } from "../ai/extractedFactSchema.js";
import {
  classifyDocumentFacts,
  computeDocumentHash,
  updateCachedClassification,
} from "./classificationService.js";
import { resolveEncryptedDocumentText } from "./encryptionService.js";
import { recordUserFeedback } from "./userFeedbackService.js";

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export interface ExtractedFactPayload {
  id: string;
  documentId: string;
  type: string;
  category: ExtractedFactCategory;
  label: string;
  data: Record<string, unknown>;
  service?: string | null;
  infra?: string | null;
  sla?: string | null;
  source?: string | null;
  confidence?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export class DocumentNotFoundError extends Error {
  status = 404;
  constructor() {
    super("Document not found for tenant");
  }
}

export class MissingExtractedTextError extends Error {
  status = 400;
  constructor() {
    super("Document has no extracted text");
  }
}

export class ExtractedFactNotFoundError extends Error {
  status = 404;
  constructor() {
    super("Extracted fact not found for tenant");
  }
}

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function normalizeCategory(category: string | null | undefined): ExtractedFactCategory {
  const upper = (category ?? "OTHER").toString().toUpperCase();
  return EXTRACTED_FACT_CATEGORIES.includes(upper as ExtractedFactCategory)
    ? (upper as ExtractedFactCategory)
    : "OTHER";
}

function parseDataField(raw: string): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (_err) {
    return { raw };
  }
}

function pickOptionalStringField(
  data: Record<string, unknown>,
  key: string
): string | null {
  const value = data[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

function mapDbFact(fact: ExtractedFact): ExtractedFactPayload {
  const data = parseDataField(fact.data);
  return {
    id: fact.id,
    documentId: fact.documentId,
    type: fact.type,
    category: normalizeCategory(fact.category),
    label: fact.label,
    data,
    service: pickOptionalStringField(data, "service"),
    infra: pickOptionalStringField(data, "infra"),
    sla: pickOptionalStringField(data, "sla"),
    source: fact.source ?? null,
    confidence: clampConfidence(fact.confidence ?? null),
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
  };
}

function ensureDocumentHasText(textContent: string | null | undefined) {
  if (!textContent || textContent.trim().length === 0) {
    throw new MissingExtractedTextError();
  }
}

function buildMinimalFallbackFact(document: Document) {
  return {
    type: "MINIMAL_EXTRACTION",
    category: normalizeCategory("OTHER"),
    label: "Extraction minimale",
    data: {
      documentName: document.originalName,
      docType: document.docType ?? "INCONNU",
      note: "Extraction IA indisponible. Faits minimaux fournis.",
    },
    source: null,
    confidence: null,
  };
}

async function recordAiExtractionError(params: {
  tenantId: string;
  documentId: string;
  correlationId: string;
  error: unknown;
  prismaClient: PrismaClientOrTx;
}) {
  const error = params.error as { message?: string; name?: string };
  const cause = (error?.message || "Unknown AI extraction error").slice(0, 500);
  const errorName = error?.name ? String(error.name).slice(0, 120) : null;

  try {
    await params.prismaClient.aiExtractionError.create({
      data: {
        tenantId: params.tenantId,
        documentId: params.documentId,
        cause,
        errorName,
        correlationId: params.correlationId,
      },
    });
  } catch (storeErr) {
    appLogger.warn("[extractedFactService] unable to store AI extraction error", {
      tenantId: params.tenantId,
      documentId: params.documentId,
      correlationId: params.correlationId,
      errorName: (storeErr as Error)?.name,
    });
  }
}

export async function getOrCreateExtractedFacts(
  documentId: string,
  tenantId: string,
  force = false,
  prismaClient: PrismaClientOrTx = prisma,
  factAnalyzer: typeof analyzeExtractedFacts = analyzeExtractedFacts
): Promise<{ documentId: string; facts: ExtractedFactPayload[] }> {
  const document = await prismaClient.document.findFirst({
    where: { id: documentId, tenantId },
  });

  if (!document) {
    throw new DocumentNotFoundError();
  }

  let documentText = "";
  try {
    documentText = resolveEncryptedDocumentText(document) ?? "";
  } catch (err: any) {
    appLogger.warn("Failed to decrypt document text for facts extraction", {
      documentId: document.id,
      message: err?.message,
    });
    documentText = "";
  }
  ensureDocumentHasText(documentText);

  const existingFacts = await prismaClient.extractedFact.findMany({
    where: { tenantId, documentId: document.id },
    orderBy: { createdAt: "asc" },
  });

  if (existingFacts.length > 0 && !force) {
    return {
      documentId: document.id,
      facts: existingFacts.map(mapDbFact),
    };
  }

  if (force && existingFacts.length > 0) {
    await prismaClient.extractedFact.deleteMany({
      where: { tenantId, documentId: document.id },
    });
  }

  const correlationId = `doc-${document.id}`;

  let aiFacts;
  try {
    const classification = await classifyDocumentFacts({
      text: documentText,
      documentName: document.originalName,
      docType: document.docType,
      correlationId,
      tenantId,
      factAnalyzer,
    });
    aiFacts = classification.facts;
  } catch (err: any) {
    const message = err?.message || "Unknown OpenAI analysis error";
    appLogger.error("[extractedFactService] analysis failed", {
      event: "ai_extraction_error",
      correlationId,
      tenantId,
      documentId: document.id,
      errorName: err?.name,
      errorMessage: message.slice(0, 200),
    });
    await recordAiExtractionError({
      tenantId,
      documentId: document.id,
      correlationId,
      error: err,
      prismaClient,
    });
    aiFacts = [buildMinimalFallbackFact(document)];
  }

  const createdFacts: ExtractedFactPayload[] = [];

  for (const fact of aiFacts) {
    const confidence = clampConfidence(fact.confidence ?? null);
    const payloadData = fact.data ?? {};
    const serializedData = JSON.stringify(payloadData);

    const created = await prismaClient.extractedFact.create({
      data: {
        tenantId,
        documentId: document.id,
        type: fact.type || "PRA_PCA_FACT",
        category: normalizeCategory(fact.category),
        label: fact.label,
        data: serializedData,
        source: fact.source?.slice(0, 500) ?? null,
        confidence,
      },
    });

    createdFacts.push(mapDbFact(created));
  }

  return {
    documentId: document.id,
    facts: createdFacts,
  };
}

function applyOptionalDataField(
  data: Record<string, unknown>,
  key: string,
  value: string | null | undefined
) {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    delete data[key];
    return;
  }
  data[key] = value;
}

export async function applyClassificationFeedback(
  documentId: string,
  tenantId: string,
  payload: {
    factId: string;
    category?: ExtractedFactCategory;
    type?: string;
    label?: string;
    service?: string | null;
    infra?: string | null;
    sla?: string | null;
  },
  prismaClient: PrismaClientOrTx = prisma
): Promise<ExtractedFactPayload> {
  const existing = await prismaClient.extractedFact.findFirst({
    where: { id: payload.factId, tenantId, documentId },
  });

  if (!existing) {
    throw new ExtractedFactNotFoundError();
  }

  const updatedData = parseDataField(existing.data);
  applyOptionalDataField(updatedData, "service", payload.service);
  applyOptionalDataField(updatedData, "infra", payload.infra);
  applyOptionalDataField(updatedData, "sla", payload.sla);

  const updatedCategory = payload.category
    ? normalizeCategory(payload.category)
    : normalizeCategory(existing.category);

  const updatePayload: Prisma.ExtractedFactUpdateManyArgs["data"] = {
    category: updatedCategory,
    type: payload.type ?? existing.type,
    label: payload.label ?? existing.label,
    data: JSON.stringify(updatedData),
  };

  await prismaClient.extractedFact.updateMany({
    where: { id: existing.id, tenantId, documentId },
    data: updatePayload,
  });

  const refreshed = await prismaClient.extractedFact.findFirst({
    where: { id: existing.id, tenantId, documentId },
  });

  if (!refreshed) {
    throw new ExtractedFactNotFoundError();
  }

  await recordUserFeedback(
    {
      tenantId,
      resourceId: refreshed.id,
      type: "EXTRACTED_FACT_CORRECTION",
      rating: null,
      comment: null,
    },
    prismaClient
  );

  const document = await prismaClient.document.findFirst({
    where: { id: documentId, tenantId },
  });

  if (document) {
    const rawText = resolveEncryptedDocumentText(document) ?? "";
    if (rawText) {
      const docHash = computeDocumentHash(rawText);
      await updateCachedClassification({
        tenantId,
        docHash,
        originalFact: {
          type: existing.type,
          category: existing.category,
          label: existing.label,
        },
        updatedFact: {
          type: typeof updatePayload.type === "string" ? updatePayload.type : existing.type,
          category: updatedCategory,
          label: typeof updatePayload.label === "string" ? updatePayload.label : existing.label,
          data: updatedData,
          source: existing.source ?? null,
          confidence: existing.confidence ?? null,
        },
      });
    }
  }

  return mapDbFact(refreshed);
}

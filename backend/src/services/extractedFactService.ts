import prisma from "../prismaClient";
import { analyzeExtractedFacts } from "../ai/extractedFactsAnalyzer";
import { ExtractedFact, Prisma, PrismaClient } from "@prisma/client";
import {
  EXTRACTED_FACT_CATEGORIES,
  ExtractedFactCategory,
} from "../ai/extractedFactSchema";

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

function mapDbFact(fact: ExtractedFact): ExtractedFactPayload {
  return {
    id: fact.id,
    documentId: fact.documentId,
    type: fact.type,
    category: normalizeCategory(fact.category),
    label: fact.label,
    data: parseDataField(fact.data),
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

  const documentText = document.textContent ?? "";
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
    aiFacts = await factAnalyzer({
      text: documentText,
      documentName: document.originalName,
      docType: document.docType,
      correlationId,
      tenantId,
    });
  } catch (err: any) {
    const message = err?.message || "Unknown OpenAI analysis error";
    console.error("[extractedFactService] analysis failed", {
      event: "ai_extraction_error",
      correlationId,
      tenantId,
      documentId: document.id,
      errorName: err?.name,
      errorMessage: message.slice(0, 200),
    });
    throw err;
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

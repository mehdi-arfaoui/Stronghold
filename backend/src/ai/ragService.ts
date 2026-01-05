import prisma from "../prismaClient";
import { ExtractedFact, Prisma, PrismaClient } from "@prisma/client";
import { DR_SCENARIOS, DrScenario } from "../analysis/drStrategyEngine";
import { queryChromaCollection } from "../clients/chromaClient";
import { buildChromaCollectionName } from "../services/documentIntelligenceService";

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export type RagChunk = {
  documentId: string;
  documentName: string;
  documentType?: string | null;
  score: number;
  text: string;
};

export type RagFact = {
  id: string;
  documentId: string;
  label: string;
  category: string;
  dataPreview: string;
  confidence?: number | null;
  score: number;
};

export type RagContext = {
  chunks: RagChunk[];
  extractedFacts: RagFact[];
};

export type RagQueryOptions = {
  tenantId: string;
  question: string;
  documentIds?: string[] | null;
  documentTypes?: string[] | null;
  serviceFilter?: string | null;
  maxChunks?: number;
  maxFacts?: number;
  prismaClient?: PrismaClientOrTx;
};

export type RagScenarioRecommendation = {
  scenarioId: string;
  name: string;
  reason: string[];
  score: number;
  matchedServices: string[];
};

const MAX_CHARS_PER_CHUNK = 900;
const MAX_CHARS_PER_FACT = 320;
const DEFAULT_MAX_CHUNKS = 6;
const DEFAULT_MAX_FACTS = 8;
const PROMPT_MAX_TOTAL = 4_000;
const DEFAULT_VECTOR_SCORE = 0.1;

function sanitizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function clampText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function tokenize(text: string): string[] {
  return sanitizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ\s]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function buildTokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function similarityScore(queryTokens: Set<string>, targetText: string): number {
  const targetTokens = buildTokenSet(targetText);
  if (targetTokens.size === 0 || queryTokens.size === 0) return 0;

  let overlap = 0;
  targetTokens.forEach((token) => {
    if (queryTokens.has(token)) {
      overlap += 1;
    }
  });

  const precision = overlap / queryTokens.size;
  const coverage = overlap / targetTokens.size;
  return Number((precision * 0.6 + coverage * 0.4).toFixed(4));
}

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeDocType(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase();
}

function splitIntoChunks(text: string, maxChunks: number): string[] {
  const cleaned = sanitizeText(text);
  if (!cleaned) return [];

  const rawParts = cleaned.split(/\n{2,}/).filter(Boolean);
  const chunks: string[] = [];

  for (const part of rawParts) {
    if (chunks.length >= maxChunks * 2) break;
    if (part.length <= MAX_CHARS_PER_CHUNK) {
      chunks.push(part);
      continue;
    }

    for (let i = 0; i < part.length && chunks.length < maxChunks * 2; i += MAX_CHARS_PER_CHUNK) {
      chunks.push(part.slice(i, i + MAX_CHARS_PER_CHUNK));
    }
  }

  return chunks.slice(0, maxChunks);
}

function buildFactPreview(fact: ExtractedFact): RagFact {
  const parsed =
    fact.data && fact.data.length > 0
      ? (() => {
          try {
            return JSON.parse(fact.data) as Record<string, unknown>;
          } catch (_err) {
            return { raw: fact.data };
          }
        })()
      : {};

  const serialized = clampText(JSON.stringify(parsed), MAX_CHARS_PER_FACT);

  return {
    id: fact.id,
    documentId: fact.documentId,
    label: clampText(fact.label, 160),
    category: fact.category,
    dataPreview: serialized,
    confidence: fact.confidence ?? null,
    score: 0,
  };
}

async function fetchFactCandidates(params: {
  tenantId: string;
  questionTokens: Set<string>;
  documentIds?: string[] | null;
  maxFacts: number;
  prismaClient: PrismaClientOrTx;
}): Promise<RagFact[]> {
  const facts = await params.prismaClient.extractedFact.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.documentIds && params.documentIds.length > 0 ? { documentId: { in: params.documentIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  return facts
    .map(buildFactPreview)
    .map((fact) => {
      const basis = `${fact.label} ${fact.dataPreview} ${fact.category}`;
      return { ...fact, score: similarityScore(params.questionTokens, basis) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, params.maxFacts);
}

async function retrieveLexicalRagContext(options: RagQueryOptions): Promise<{
  context: RagContext;
  usedDocumentIds: string[];
  questionTokens: Set<string>;
}> {
  const prismaClient = options.prismaClient ?? prisma;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;

  const questionTokens = buildTokenSet(`${options.question} ${options.serviceFilter || ""}`);
  const docFilter: Prisma.DocumentWhereInput = {
    ...(options.documentIds && options.documentIds.length > 0 ? { id: { in: options.documentIds } } : {}),
    ...(options.documentTypes && options.documentTypes.length > 0
      ? { docType: { in: options.documentTypes.map((d) => d.toUpperCase()) } }
      : {}),
  };

  const [documents, facts] = await Promise.all([
    prismaClient.document.findMany({
      where: {
        tenantId: options.tenantId,
        extractionStatus: "SUCCESS",
        ...docFilter,
      },
      select: {
        id: true,
        originalName: true,
        docType: true,
        textContent: true,
      },
      take: 25,
    }),
    fetchFactCandidates({
      tenantId: options.tenantId,
      questionTokens,
      documentIds: docFilter.id ? docFilter.id.in : null,
      maxFacts,
      prismaClient,
    }),
  ]);

  const chunkCandidates: RagChunk[] = [];
  for (const doc of documents) {
    const chunks = splitIntoChunks(doc.textContent || "", maxChunks);
    for (const chunk of chunks) {
      chunkCandidates.push({
        documentId: doc.id,
        documentName: doc.originalName,
        documentType: doc.docType,
        text: clampText(chunk, MAX_CHARS_PER_CHUNK),
        score: similarityScore(questionTokens, chunk),
      });
    }
  }

  const allowedDocIds = new Set(documents.map((d) => d.id));

  const sortedChunks = chunkCandidates.sort((a, b) => b.score - a.score).slice(0, maxChunks);
  const sortedFacts = facts.filter((fact) => allowedDocIds.has(fact.documentId));

  return {
    context: {
      chunks: sortedChunks,
      extractedFacts: sortedFacts,
    },
    usedDocumentIds: documents.map((d) => d.id),
    questionTokens,
  };
}

async function retrieveVectorRagContext(options: RagQueryOptions): Promise<{
  context: RagContext;
  usedDocumentIds: string[];
  questionTokens: Set<string>;
} | null> {
  const prismaClient = options.prismaClient ?? prisma;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;

  const questionTokens = buildTokenSet(`${options.question} ${options.serviceFilter || ""}`);
  const baseQuestion = `${options.question} ${options.serviceFilter || ""}`.trim();
  if (!baseQuestion) {
    return null;
  }

  const collection = buildChromaCollectionName(
    process.env.CHROMADB_COLLECTION || "pra-documents",
    options.tenantId
  );

  const response = await queryChromaCollection({
    collection,
    queryTexts: [baseQuestion],
    tenantId: options.tenantId,
    documentIds: options.documentIds ?? null,
    nResults: maxChunks,
  });

  if (!response || !response.documents || !response.metadatas) {
    return null;
  }

  const documents = response.documents[0] || [];
  const metadatas = response.metadatas[0] || [];
  const distances = response.distances?.[0] || [];

  const chunkCandidates: RagChunk[] = [];
  for (let index = 0; index < documents.length; index += 1) {
    const text = documents[index];
    const metadata = metadatas[index] || {};
    const documentId = toOptionalString(metadata.documentId);
    if (!documentId) continue;
    const rawDocName =
      toOptionalString(metadata.originalName) ?? toOptionalString(metadata.documentName) ?? "Document";
    const rawDocType =
      toOptionalString(metadata.normalizedDocType) ??
      toOptionalString(metadata.declaredDocType) ??
      toOptionalString(metadata.classification);
    const distance = typeof distances[index] === "number" ? distances[index] : null;
    const score = distance !== null ? Number((1 / (1 + distance)).toFixed(4)) : DEFAULT_VECTOR_SCORE;

    chunkCandidates.push({
      documentId,
      documentName: rawDocName,
      documentType: normalizeDocType(rawDocType),
      text: clampText(text, MAX_CHARS_PER_CHUNK),
      score,
    });
  }

  if (chunkCandidates.length === 0) {
    return null;
  }

  const uniqueDocIds = Array.from(new Set(chunkCandidates.map((chunk) => chunk.documentId)));
  const documentRecords = await prismaClient.document.findMany({
    where: {
      tenantId: options.tenantId,
      id: { in: uniqueDocIds },
    },
    select: {
      id: true,
      originalName: true,
      docType: true,
    },
  });

  const docMap = new Map(documentRecords.map((doc) => [doc.id, doc]));
  const allowedDocTypes = options.documentTypes?.map((d) => d.toUpperCase());

  const filteredChunks = chunkCandidates
    .map((chunk) => {
      const doc = docMap.get(chunk.documentId);
      return {
        ...chunk,
        documentName: doc?.originalName || chunk.documentName,
        documentType: normalizeDocType(chunk.documentType || doc?.docType || null),
      };
    })
    .filter((chunk) => {
      if (!allowedDocTypes || allowedDocTypes.length === 0) return true;
      return chunk.documentType ? allowedDocTypes.includes(chunk.documentType) : false;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);

  const usedDocumentIds = Array.from(new Set(filteredChunks.map((chunk) => chunk.documentId)));
  let factDocumentIds: string[] | null = null;
  if (options.documentIds && options.documentIds.length > 0) {
    factDocumentIds = options.documentIds;
  } else if (usedDocumentIds.length > 0) {
    factDocumentIds = usedDocumentIds;
  } else if (options.documentTypes && options.documentTypes.length > 0) {
    const docsByType = await prismaClient.document.findMany({
      where: {
        tenantId: options.tenantId,
        docType: { in: options.documentTypes.map((d) => d.toUpperCase()) },
      },
      select: { id: true },
      take: 50,
    });
    factDocumentIds = docsByType.map((doc) => doc.id);
  }

  const facts = await fetchFactCandidates({
    tenantId: options.tenantId,
    questionTokens,
    documentIds: factDocumentIds,
    maxFacts,
    prismaClient,
  });

  return {
    context: {
      chunks: filteredChunks,
      extractedFacts: facts,
    },
    usedDocumentIds: usedDocumentIds.length > 0 ? usedDocumentIds : factDocumentIds ?? [],
    questionTokens,
  };
}

export async function retrieveRagContext(options: RagQueryOptions): Promise<{
  context: RagContext;
  usedDocumentIds: string[];
  questionTokens: Set<string>;
}> {
  try {
    const vectorResult = await retrieveVectorRagContext(options);
    if (vectorResult) {
      return vectorResult;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Vector RAG retrieval failed, falling back to lexical retrieval.", {
      tenantId: options.tenantId,
      message: message.slice(0, 300),
    });
  }

  return retrieveLexicalRagContext(options);
}

export function draftAnswerFromContext(question: string, context: RagContext): string {
  const facts = context.extractedFacts.slice(0, 3);
  const chunks = context.chunks.slice(0, 2);

  if (facts.length === 0 && chunks.length === 0) {
    return "Aucun contexte pertinent trouvé pour cette question. Revoir les documents indexés ou préciser le périmètre (documentId, type).";
  }

  const factLines =
    facts.length > 0
      ? facts.map((f) => `- ${f.label} (cat: ${f.category}, confiance: ${f.confidence ?? "?"})`).join("\n")
      : "- Aucun fait structuré disponible.";

  const chunkLines =
    chunks.length > 0
      ? chunks
          .map(
            (c) =>
              `- ${c.documentName} (${c.documentType || "doc"}) → ${clampText(c.text, 180)}`
          )
          .join("\n")
      : "- Aucun extrait textuel retenu.";

  return [
    `Question: ${question}`,
    "Indices structurés:",
    factLines,
    "Extraits textuels:",
    chunkLines,
    "Proposez une réponse concise en français en utilisant uniquement ces éléments.",
  ].join("\n");
}

export function buildRagPrompt(params: {
  question: string;
  context: RagContext;
  maxTotalLength?: number;
}): { prompt: string; totalChars: number } {
  const maxTotal = params.maxTotalLength ?? PROMPT_MAX_TOTAL;
  const header =
    `Tu es un assistant PRA/PCA. Réponds en français de manière concise et factuelle.\n` +
    `Utilise UNIQUEMENT le contexte fourni (chunks + faits) et cite l'origine sous la forme [doc=<id>].\n` +
    `Question: ${params.question}\n` +
    `Inclure: (1) résumé des dépendances clés, (2) stratégies DR adaptées (Backup & Restore, Pilot Light, Warm Standby, Multi-AZ, Active/Active, Active/Passive, CDP), ` +
    `(3) estimation RTO/RPO, coût et complexité, (4) mini-runbook étape par étape.`;

  const chunkLines = params.context.chunks
    .map(
      (c) =>
        `- [${c.documentId}] ${c.documentName} (${c.documentType || "doc"}): ${clampText(
          c.text,
          260
        )}`
    )
    .join("\n");

  const factLines = params.context.extractedFacts
    .map(
      (f) =>
        `- (${f.category}) ${f.label} -> ${clampText(f.dataPreview, 220)} [doc=${f.documentId}]`
    )
    .join("\n");

  const parts = [
    header,
    "Contexte textuel (chunks):",
    chunkLines || "- Aucun chunk sélectionné.",
    "Faits extraits:",
    factLines || "- Aucun fait structuré disponible.",
    "Règles: ignore les documents hors tenant, ne divulgue pas de données personnelles, ne fabrique pas de faits.",
  ];

  let prompt = "";
  for (const part of parts) {
    if ((prompt + "\n" + part).length > maxTotal) break;
    prompt = prompt ? `${prompt}\n${part}` : part;
  }

  return { prompt, totalChars: prompt.length };
}

export async function recommendScenariosWithRag(params: {
  tenantId: string;
  question?: string;
  services?: { id: string; name: string; type: string; criticality: string | null }[];
  scenarios?: DrScenario[];
  context?: RagContext;
  maxResults?: number;
  prismaClient?: PrismaClientOrTx;
}): Promise<RagScenarioRecommendation[]> {
  const prismaClient = params.prismaClient ?? prisma;
  const maxResults = params.maxResults ?? 5;
  const dbScenarios =
    params.scenarios ??
    (await prismaClient.scenario.findMany({
      where: { tenantId: params.tenantId },
      include: { services: { include: { service: true } } },
    }));

  const scenarioPool: any[] = [
    ...dbScenarios,
    ...DR_SCENARIOS.map((s) => ({
      ...s,
      name: s.label,
      type: s.id,
      services: [],
    })),
  ];

  const queryTokens = new Set<string>();
  tokenize(params.question || "").forEach((t) => queryTokens.add(t));

  (params.services || []).forEach((s) => {
    tokenize(`${s.name} ${s.type} ${s.criticality ?? ""}`).forEach((t) => queryTokens.add(t));
  });

  if (params.context) {
    params.context.extractedFacts.forEach((fact) => {
      tokenize(`${fact.label} ${fact.dataPreview} ${fact.category}`).forEach((t) => queryTokens.add(t));
    });
    params.context.chunks.forEach((chunk) => {
      tokenize(chunk.text).forEach((t) => queryTokens.add(t));
    });
  }

  const candidates = scenarioPool.map((scenario) => {
    const serviceNames =
      "services" in scenario
        ? (scenario as any).services?.map((link: any) => link.service?.name).filter(Boolean) ?? []
        : [];
    const basis = `${scenario.name ?? scenario.label} ${scenario.type ?? ""} ${scenario.description ?? ""} ${serviceNames.join(" ")}`;
    const score = similarityScore(queryTokens, basis);
    const reasons: string[] = [];

    if (score > 0.4) {
      reasons.push("Similarité élevée avec les risques/faits détectés.");
    } else if (score > 0.2) {
      reasons.push("Alignement partiel avec le contexte RAG.");
    } else {
      reasons.push("Peu de correspondances détectées, tri conservateur.");
    }

    if (serviceNames.length > 0) {
      reasons.push(`Services concernés: ${serviceNames.slice(0, 3).join(", ")}`);
    }

    return {
      scenarioId: (scenario as any).id,
      name: (scenario as any).name ?? (scenario as any).label,
      score,
      reason: reasons,
      matchedServices: serviceNames.slice(0, 5),
    };
  });

  return candidates.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

export async function generatePraReport(params: {
  tenantId: string;
  question: string;
  documentIds?: string[];
  documentTypes?: string[];
  serviceFilter?: string | null;
  maxChunks?: number;
  maxFacts?: number;
  prismaClient?: PrismaClientOrTx;
}) {
  const contextResult = await retrieveRagContext({
    tenantId: params.tenantId,
    question: params.question,
    documentIds: params.documentIds,
    documentTypes: params.documentTypes,
    serviceFilter: params.serviceFilter,
    maxChunks: params.maxChunks ?? 6,
    maxFacts: params.maxFacts ?? 8,
    prismaClient: params.prismaClient,
  });

  const prompt = buildRagPrompt({
    question: params.question,
    context: contextResult.context,
  });

  const scenarioRecommendations = await recommendScenariosWithRag({
    tenantId: params.tenantId,
    question: params.question,
    context: contextResult.context,
    maxResults: 6,
    prismaClient: params.prismaClient,
  });

  return {
    prompt: prompt.prompt,
    promptSize: prompt.totalChars,
    context: contextResult.context,
    draftAnswer: draftAnswerFromContext(params.question, contextResult.context),
    scenarioRecommendations,
    usedDocumentIds: contextResult.usedDocumentIds,
  };
}

export async function generateRunbookDraft(params: {
  tenantId: string;
  question: string;
  documentIds?: string[];
  documentTypes?: string[];
  serviceFilter?: string | null;
}) {
  const baseQuestion =
    params.question ||
    "Génère un runbook PRA détaillé incluant dépendances, sauvegardes et étapes de reprise.";

  const report = await generatePraReport({
    tenantId: params.tenantId,
    question: baseQuestion,
    documentIds: params.documentIds,
    documentTypes: params.documentTypes,
    serviceFilter: params.serviceFilter,
    maxChunks: 8,
    maxFacts: 10,
  });

  const sources = [
    ...new Set(report.context.chunks.map((c) => c.documentName)),
    ...report.context.extractedFacts.map((f) => f.documentId),
  ];

  return {
    ...report,
    sources,
    draftRunbook: [
      "# Runbook PRA (brouillon)",
      `Question utilisateur: ${baseQuestion}`,
      "## Services et dépendances clés",
      report.context.extractedFacts.slice(0, 5).map((f) => `- ${f.label} (${f.category})`).join("\n") ||
        "- Aucun fait structuré détecté.",
      "## Étapes de reprise (esquisse)",
      "- Déclencher la cellule de crise et confirmer le périmètre du sinistre.",
      "- Activer la stratégie DR recommandée (Pilot Light / Warm Standby / Multi-AZ) selon les contraintes RTO/RPO.",
      "- Restaurer les sauvegardes critiques ou promouvoir les réplicas.",
      "- Vérifier l'application et les dépendances (DB, messaging, réseau).",
      "- Communiquer la reprise et clôturer avec un post-mortem.",
      "",
      "## Sources utilisées",
      sources.map((s) => `- ${s || "document inconnu"}`).join("\n"),
    ].join("\n"),
  };
}

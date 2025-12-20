import prisma from "../prismaClient";
import { ExtractedFact, Prisma, PrismaClient } from "@prisma/client";
import { DR_SCENARIOS, DrScenario } from "../analysis/drStrategyEngine";

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

export async function retrieveRagContext(options: RagQueryOptions): Promise<{
  context: RagContext;
  usedDocumentIds: string[];
  questionTokens: Set<string>;
}> {
  const prismaClient = options.prismaClient ?? prisma;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;

  const questionTokens = buildTokenSet(options.question);
  const docFilter = options.documentIds && options.documentIds.length > 0 ? { id: { in: options.documentIds } } : {};

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
    prismaClient.extractedFact.findMany({
      where: {
        tenantId: options.tenantId,
        ...(docFilter.id ? { documentId: docFilter.id.in } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 120,
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

  const factCandidates = facts.map(buildFactPreview).map((fact) => {
    const basis = `${fact.label} ${fact.dataPreview} ${fact.category}`;
    return { ...fact, score: similarityScore(questionTokens, basis) };
  });

  const sortedChunks = chunkCandidates.sort((a, b) => b.score - a.score).slice(0, maxChunks);
  const sortedFacts = factCandidates.sort((a, b) => b.score - a.score).slice(0, maxFacts);

  return {
    context: {
      chunks: sortedChunks,
      extractedFacts: sortedFacts,
    },
    usedDocumentIds: documents.map((d) => d.id),
    questionTokens,
  };
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
  const header = `Tu es un assistant PRA/PCA. Réponds en français de manière concise et factuelle.\nQuestion: ${params.question}`;

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
    "Contexte textuel:",
    chunkLines || "- Aucun chunk sélectionné.",
    "Faits extraits:",
    factLines || "- Aucun fait structuré disponible.",
    "Règles: ignore les documents hors tenant, ne divulgue pas de données personnelles.",
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

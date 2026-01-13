"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
  return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRunbookDraft = exports.generatePraReport = exports.recommendScenariosWithRag = exports.buildRagPrompt = exports.draftAnswerFromContext = exports.retrieveRagContext = exports.rerankChunksRrf = exports.rerankChunksCrossEncoder = exports.fuseChunkScores = void 0;
const prismaClient_1 = __importDefault(require("../prismaClient"));
const client_1 = require("@prisma/client");
const drStrategyEngine_1 = require("../analysis/drStrategyEngine");
const chromaClient_1 = require("../clients/chromaClient");
const documentIntelligenceService_1 = require("../services/documentIntelligenceService");
const metrics_1 = require("../observability/metrics");
const ragRanking_1 = require("./ragRanking");
const elasticlunr_1 = __importDefault(require("elasticlunr"));
const crypto_1 = __importDefault(require("node:crypto"));
exports.fuseChunkScores = ragRanking_1.fuseChunkScores;
exports.rerankChunksCrossEncoder = ragRanking_1.rerankChunksCrossEncoder;
exports.rerankChunksRrf = ragRanking_1.rerankChunksRrf;
const BASE_CHARS_PER_CHUNK = 900;
const MIN_CHARS_PER_CHUNK = 480;
const MAX_CHARS_PER_CHUNK = 1200;
const MAX_CHARS_PER_FACT = 320;
const DEFAULT_MAX_CHUNKS = 6;
const DEFAULT_MAX_FACTS = 8;
const PROMPT_MAX_TOTAL = 4000;
const DEFAULT_VECTOR_SCORE = 0.1;
const DEFAULT_ALPHA = 0.6;
const DEFAULT_LEXICAL_CHUNKS_PER_DOC = 12;
const DEFAULT_RECALL_KS = [3, 5, 10];
function sanitizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}
function clampText(text, limit) {
  if (text.length <= limit)
    return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}
function tokenize(text) {
  return sanitizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ\s]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
function buildTokenSet(text) {
  return new Set(tokenize(text));
}
function similarityScore(queryTokens, targetText) {
  const targetTokens = buildTokenSet(targetText);
  if (targetTokens.size === 0 || queryTokens.size === 0)
    return 0;
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
function toOptionalString(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}
function normalizeDocType(value) {
  if (!value)
    return null;
  return value.toUpperCase();
}
function splitIntoSentences(text) {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
function infoDensity(text) {
  const tokens = text
    .replace(/[^a-zA-Z0-9À-ÿ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0)
    return 0;
  const informative = tokens.filter((token) => token.length >= 5 || /\d/.test(token)).length;
  return informative / tokens.length;
}
function buildSentenceChunks(sentences, maxLength) {
  const chunks = [];
  let current = "";
  const flush = () => {
    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }
    current = "";
  };
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed)
      continue;
    const candidate = current ? `${current} ${trimmed}` : trimmed;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    if (current && infoDensity(current) < 0.18 && current.length < maxLength * 0.6) {
      current = candidate.slice(0, maxLength);
      continue;
    }
    flush();
    current = trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
  }
  flush();
  return chunks;
}
function buildChunkKey(documentId, text) {
  const hash = crypto_1.default.createHash("sha256").update(`${documentId}:${text}`).digest("hex");
  return `${documentId}:${hash}`;
}
function computeChunkSizeForDocument(text) {
  const cleaned = sanitizeText(text);
  if (!cleaned)
    return BASE_CHARS_PER_CHUNK;
  const sentences = splitIntoSentences(cleaned);
  const sentenceCount = Math.max(1, sentences.length);
  const avgSentenceLength = cleaned.length / sentenceCount;
  const lineCount = text.split(/\n+/).filter(Boolean).length;
  const lineRatio = lineCount / sentenceCount;
  const density = infoDensity(cleaned);
  let target = BASE_CHARS_PER_CHUNK;
  if (lineRatio > 1.4 || avgSentenceLength < 80) {
    target = 650;
  }
  if (density > 0.28 && avgSentenceLength > 140) {
    target = 1050;
  }
  if (cleaned.length < 1400) {
    target = Math.min(target, 600);
  }
  return Math.max(MIN_CHARS_PER_CHUNK, Math.min(MAX_CHARS_PER_CHUNK, Math.round(target)));
}
function buildChunkTextCandidates(text, maxChunks, maxLength) {
  const cleaned = sanitizeText(text);
  if (!cleaned)
    return [];
  const sentences = splitIntoSentences(cleaned);
  const chunks = buildSentenceChunks(sentences, maxLength);
  if (chunks.length <= maxChunks)
    return chunks;
  return chunks.slice(0, maxChunks);
}
function parseAlpha(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    return DEFAULT_ALPHA;
  return Math.min(1, Math.max(0, parsed));
}
function parseRerankStrategy(value) {
  const normalized = (value || "").toLowerCase();
  if (normalized === "rrf")
    return "rrf";
  if (normalized === "cross" || normalized === "cross-encoder")
    return "cross";
  return "none";
}
function parseRecallKs(value) {
  if (!value)
    return DEFAULT_RECALL_KS;
  const parsed = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isFinite(num) && num > 0);
  return parsed.length > 0 ? parsed : DEFAULT_RECALL_KS;
}
function parseCrossWeights(value) {
  if (!value) {
    return { lexical: 0.5, vector: 0.25, bm25: 0.25 };
  }
  const parts = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isFinite(num) && num >= 0);
  if (parts.length !== 3) {
    return { lexical: 0.5, vector: 0.25, bm25: 0.25 };
  }
  return { lexical: parts[0], vector: parts[1], bm25: parts[2] };
}
function buildRankedDocumentIds(chunks) {
  const ranked = [];
  const seen = new Set();
  for (const chunk of chunks) {
    if (!seen.has(chunk.documentId)) {
      ranked.push(chunk.documentId);
      seen.add(chunk.documentId);
    }
  }
  return ranked;
}
function buildFactPreview(fact) {
  const parsed = fact.data && fact.data.length > 0
    ? (() => {
      try {
        return JSON.parse(fact.data);
      }
      catch (_err) {
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
async function fetchFactCandidates(params) {
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
async function retrieveLexicalRagContext(options) {
  const prismaClient = options.prismaClient ?? prismaClient_1.default;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;
  const questionTokens = buildTokenSet(`${options.question} ${options.serviceFilter || ""}`);
  const questionText = `${options.question} ${options.serviceFilter || ""}`.trim();
  const docFilter = {
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
  const chunkDocs = [];
  for (const doc of documents) {
    const rawText = doc.textContent || "";
    const chunkSize = computeChunkSizeForDocument(rawText);
    const chunks = buildChunkTextCandidates(rawText, DEFAULT_LEXICAL_CHUNKS_PER_DOC, chunkSize);
    for (const chunk of chunks) {
      chunkDocs.push({
        chunkKey: buildChunkKey(doc.id, chunk),
        documentId: doc.id,
        documentName: doc.originalName,
        documentType: doc.docType,
        text: clampText(chunk, chunkSize),
        score: 0,
        bm25Score: 0,
      });
    }
  }
  const allowedDocIds = new Set(documents.map((d) => d.id));
  if (chunkDocs.length === 0) {
    return {
      context: { chunks: [], extractedFacts: [] },
      usedDocumentIds: documents.map((d) => d.id),
      questionTokens,
    };
  }
  const index = (0, elasticlunr_1.default)(function () {
    this.setRef("chunkKey");
    this.addField("text");
  });
  for (const chunk of chunkDocs) {
    index.addDoc({ chunkKey: chunk.chunkKey, text: chunk.text });
  }
  const searchResults = questionText ? index.search(questionText, { expand: true }) : [];
  const resultScoreMap = new Map();
  for (const result of searchResults) {
    const score = typeof result.score === "number" ? result.score : 0;
    resultScoreMap.set(result.ref, score);
  }
  const rankedCandidates = searchResults.length > 0
    ? searchResults
      .map((result) => chunkDocs.find((chunk) => chunk.chunkKey === result.ref))
      .filter((chunk) => Boolean(chunk))
    : chunkDocs;
  const scoredCandidates = rankedCandidates.map((candidate) => {
    const bm25Score = resultScoreMap.get(candidate.chunkKey) ?? similarityScore(questionTokens, candidate.text);
    return {
      ...candidate,
      bm25Score,
      score: bm25Score,
    };
  });
  const sortedChunks = scoredCandidates
    .filter((candidate) => allowedDocIds.has(candidate.documentId))
    .sort((a, b) => (b.bm25Score ?? 0) - (a.bm25Score ?? 0))
    .slice(0, maxChunks);
  const sortedFacts = facts.filter((fact) => allowedDocIds.has(fact.documentId));
  return {
    context: {
      chunks: sortedChunks.map((chunk) => ({ ...chunk, score: chunk.score })),
      extractedFacts: sortedFacts,
    },
    usedDocumentIds: documents.map((d) => d.id),
    questionTokens,
  };
}
async function retrieveVectorRagContext(options) {
  const prismaClient = options.prismaClient ?? prismaClient_1.default;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;
  const questionTokens = buildTokenSet(`${options.question} ${options.serviceFilter || ""}`);
  const baseQuestion = `${options.question} ${options.serviceFilter || ""}`.trim();
  if (!baseQuestion) {
    return null;
  }
  const collection = (0, documentIntelligenceService_1.buildChromaCollectionName)(process.env.CHROMADB_COLLECTION || "pra-documents", options.tenantId);
  const response = await (0, chromaClient_1.queryChromaCollection)({
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
  const distances = (response.distances?.[0]) || [];
  const chunkCandidates = [];
  for (let index = 0; index < documents.length; index += 1) {
    const text = documents[index];
    const metadata = metadatas[index] || {};
    const documentId = toOptionalString(metadata.documentId);
    if (!documentId)
      continue;
    const rawDocName = toOptionalString(metadata.originalName) ?? toOptionalString(metadata.documentName) ?? "Document";
    const rawDocType = toOptionalString(metadata.normalizedDocType) ??
      toOptionalString(metadata.declaredDocType) ??
      toOptionalString(metadata.classification);
    const distance = typeof distances[index] === "number" ? distances[index] : null;
    const score = distance !== null ? Number((1 / (1 + distance)).toFixed(4)) : DEFAULT_VECTOR_SCORE;
    const chunkText = clampText(text, MAX_CHARS_PER_CHUNK);
    chunkCandidates.push({
      chunkKey: buildChunkKey(documentId, chunkText),
      documentId,
      documentName: rawDocName,
      documentType: normalizeDocType(rawDocType),
      text: chunkText,
      score,
      vectorScore: score,
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
      if (!allowedDocTypes || allowedDocTypes.length === 0)
        return true;
      return chunk.documentType ? allowedDocTypes.includes(chunk.documentType) : false;
    })
    .sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0))
    .slice(0, maxChunks);
  const usedDocumentIds = Array.from(new Set(filteredChunks.map((chunk) => chunk.documentId)));
  let factDocumentIds = null;
  if (options.documentIds && options.documentIds.length > 0) {
    factDocumentIds = options.documentIds;
  }
  else if (usedDocumentIds.length > 0) {
    factDocumentIds = usedDocumentIds;
  }
  else if (options.documentTypes && options.documentTypes.length > 0) {
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
async function retrieveRagContext(options) {
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const lexicalOptions = { ...options, maxChunks: Math.max(maxChunks * 3, maxChunks) };
  let vectorResult = null;
  try {
    vectorResult = await retrieveVectorRagContext(options);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Vector RAG retrieval failed, falling back to lexical retrieval.", {
      tenantId: options.tenantId,
      message: message.slice(0, 300),
    });
  }
  const lexicalResult = await retrieveLexicalRagContext(lexicalOptions);
  if (!vectorResult) {
    const trimmedLexical = {
      ...lexicalResult,
      context: {
        ...lexicalResult.context,
        chunks: lexicalResult.context.chunks.slice(0, maxChunks),
      },
    };
    if (options.documentIds && options.documentIds.length > 0) {
      const rankedDocIds = buildRankedDocumentIds(trimmedLexical.context.chunks);
      (0, metrics_1.recordRagRecall)({
        tenantId: options.tenantId,
        relevantDocumentIds: options.documentIds,
        rankedDocumentIds: rankedDocIds,
        ks: parseRecallKs(process.env.RAG_RECALL_KS),
      });
      (0, metrics_1.recordRagMrr)({
        tenantId: options.tenantId,
        relevantDocumentIds: options.documentIds,
        rankedDocumentIds: rankedDocIds,
      });
    }
    return trimmedLexical;
  }
  const alpha = parseAlpha(process.env.RAG_FUSION_ALPHA);
  const rerankStrategy = parseRerankStrategy(process.env.RAG_RERANKING);
  const combinedMap = new Map();
  for (const chunk of lexicalResult.context.chunks) {
    combinedMap.set(chunk.chunkKey, { ...chunk, bm25Score: chunk.bm25Score ?? chunk.score });
  }
  for (const chunk of vectorResult.context.chunks) {
    const existing = combinedMap.get(chunk.chunkKey);
    if (existing) {
      combinedMap.set(chunk.chunkKey, {
        ...existing,
        vectorScore: chunk.vectorScore ?? chunk.score,
      });
    }
    else {
      combinedMap.set(chunk.chunkKey, { ...chunk, vectorScore: chunk.vectorScore ?? chunk.score });
    }
  }
  const combinedCandidates = Array.from(combinedMap.values());
  const fusedCandidates = (0, ragRanking_1.fuseChunkScores)(combinedCandidates, alpha);
  let rerankedCandidates = fusedCandidates;
  if (rerankStrategy === "rrf") {
    const bm25Ranking = [...combinedCandidates]
      .sort((a, b) => (b.bm25Score ?? 0) - (a.bm25Score ?? 0))
      .map((chunk) => chunk.chunkKey);
    const vectorRanking = [...combinedCandidates]
      .sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0))
      .map((chunk) => chunk.chunkKey);
    rerankedCandidates = (0, ragRanking_1.rerankChunksRrf)(fusedCandidates, {
      vector: vectorRanking,
      bm25: bm25Ranking,
    });
  } else if (rerankStrategy === "cross") {
    const questionText = `${options.question} ${options.serviceFilter || ""}`.trim();
    rerankedCandidates = (0, ragRanking_1.rerankChunksCrossEncoder)(fusedCandidates, questionText, parseCrossWeights(process.env.RAG_CROSS_WEIGHTS));
  }
  const finalChunks = rerankedCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .map((chunk) => ({
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      documentType: chunk.documentType,
      score: chunk.score,
      text: chunk.text,
    }));
  const usedDocumentIds = buildRankedDocumentIds(finalChunks);
  if (options.documentIds && options.documentIds.length > 0) {
    (0, metrics_1.recordRagRecall)({
      tenantId: options.tenantId,
      relevantDocumentIds: options.documentIds,
      rankedDocumentIds: usedDocumentIds,
      ks: parseRecallKs(process.env.RAG_RECALL_KS),
    });
    (0, metrics_1.recordRagMrr)({
      tenantId: options.tenantId,
      relevantDocumentIds: options.documentIds,
      rankedDocumentIds: usedDocumentIds,
    });
  }
  const extractedFacts = vectorResult.context.extractedFacts.length > 0
    ? vectorResult.context.extractedFacts
    : lexicalResult.context.extractedFacts;
  return {
    context: {
      chunks: finalChunks,
      extractedFacts,
    },
    usedDocumentIds,
    questionTokens: vectorResult.questionTokens,
  };
}
exports.retrieveRagContext = retrieveRagContext;
function draftAnswerFromContext(question, context) {
  const facts = context.extractedFacts.slice(0, 3);
  const chunks = context.chunks.slice(0, 2);
  if (facts.length === 0 && chunks.length === 0) {
    return "Aucun contexte pertinent trouvé pour cette question. Revoir les documents indexés ou préciser le périmètre (documentId, type).";
  }
  const factLines = facts.length > 0
    ? facts.map((f) => `- ${f.label} (cat: ${f.category}, confiance: ${f.confidence ?? "?"})`).join("\n")
    : "- Aucun fait structuré disponible.";
  const chunkLines = chunks.length > 0
    ? chunks
      .map((c) => `- ${c.documentName} (${c.documentType || "doc"}) → ${clampText(c.text, 180)}`)
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
exports.draftAnswerFromContext = draftAnswerFromContext;
function buildRagPrompt(params) {
  const maxTotal = params.maxTotalLength ?? PROMPT_MAX_TOTAL;
  const header = `Tu es un assistant PRA/PCA. Réponds en français de manière concise et factuelle.\n` +
    `Utilise UNIQUEMENT le contexte fourni (chunks + faits) et cite l'origine sous la forme [doc=<id>].\n` +
    `Question: ${params.question}\n` +
    `Inclure: (1) résumé des dépendances clés, (2) stratégies DR adaptées (Backup & Restore, Pilot Light, Warm Standby, Multi-AZ, Active/Active, Active/Passive, CDP), ` +
    `(3) estimation RTO/RPO, coût et complexité, (4) mini-runbook étape par étape.`;
  const chunkLines = params.context.chunks
    .map((c) => `- [${c.documentId}] ${c.documentName} (${c.documentType || "doc"}): ${clampText(c.text, 260)}`)
    .join("\n");
  const factLines = params.context.extractedFacts
    .map((f) => `- (${f.category}) ${f.label} -> ${clampText(f.dataPreview, 220)} [doc=${f.documentId}]`)
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
    if ((prompt + "\n" + part).length > maxTotal)
      break;
    prompt = prompt ? `${prompt}\n${part}` : part;
  }
  return { prompt, totalChars: prompt.length };
}
exports.buildRagPrompt = buildRagPrompt;
async function recommendScenariosWithRag(params) {
  const prismaClient = params.prismaClient ?? prismaClient_1.default;
  const maxResults = params.maxResults ?? 5;
  const dbScenarios = params.scenarios ?? (await prismaClient.scenario.findMany({
    where: { tenantId: params.tenantId },
    include: { services: { include: { service: true } } },
  }));
  const scenarioPool = [
    ...dbScenarios,
    ...drStrategyEngine_1.DR_SCENARIOS.map((s) => ({
      ...s,
      name: s.label,
      type: s.id,
      services: [],
    })),
  ];
  const queryTokens = new Set();
  tokenize(params.question || "").forEach((t) => queryTokens.add(t));
  (params.services || []).forEach((s) => {
    tokenize(`${s.name} ${s.type} ${s.criticality ?? ""}`).forEach((t) => queryTokens.add(t));
  });
  const matchedScenario = scenarioPool
    .map((scenario) => {
    const serviceTokens = scenario.services
      ? scenario.services.map((svc) => svc.service?.name || "").join(" ")
      : "";
    const base = `${scenario.name || scenario.label} ${scenario.description || ""} ${serviceTokens}`;
    const score = similarityScore(queryTokens, base);
    const matchedServices = scenario.services
      ? scenario.services
        .filter((svc) => similarityScore(queryTokens, svc.service?.name || "") > 0.15)
        .map((svc) => svc.service?.name || "")
      : [];
    return {
      scenarioId: scenario.id || scenario.type,
      name: scenario.name || scenario.label,
      reason: score > 0 ? ["Pertinence textuelle", ...(scenario.tags || [])] : scenario.tags || [],
      score,
      matchedServices,
    };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
  if (params.context && params.context.chunks.length > 0) {
    const contextTokens = buildTokenSet(params.context.chunks.map((c) => c.text).join(" "));
    matchedScenario.forEach((scenario) => {
      const contextScore = similarityScore(contextTokens, scenario.name);
      scenario.score = Number(((scenario.score + contextScore) / 2).toFixed(4));
    });
    matchedScenario.sort((a, b) => b.score - a.score);
  }
  return matchedScenario;
}
exports.recommendScenariosWithRag = recommendScenariosWithRag;
async function generatePraReport(params) {
  const ragContext = await retrieveRagContext(params);
  const ragPrompt = buildRagPrompt({ question: params.question, context: ragContext.context });
  const draft = draftAnswerFromContext(params.question, ragContext.context);
  const ragScenarioRecommendations = await recommendScenariosWithRag({
    tenantId: params.tenantId,
    question: params.question,
    context: ragContext.context,
    prismaClient: params.prismaClient,
  });
  return {
    prompt: ragPrompt.prompt,
    promptSize: ragPrompt.totalChars,
    context: ragContext.context,
    draftAnswer: draft,
    scenarioRecommendations: ragScenarioRecommendations,
    usedDocumentIds: ragContext.usedDocumentIds,
  };
}
exports.generatePraReport = generatePraReport;
async function generateRunbookDraft(params) {
  const ragContext = await retrieveRagContext(params);
  const ragPrompt = buildRagPrompt({ question: params.question, context: ragContext.context });
  const draft = draftAnswerFromContext(params.question, ragContext.context);
  const ragScenarioRecommendations = await recommendScenariosWithRag({
    tenantId: params.tenantId,
    question: params.question,
    context: ragContext.context,
    prismaClient: params.prismaClient,
  });
  const sources = Array.from(new Set(ragContext.context.chunks.map((chunk) => chunk.documentName)));
  return {
    sources,
    draftRunbook: draft,
    prompt: ragPrompt.prompt,
    promptSize: ragPrompt.totalChars,
    context: ragContext.context,
    draftAnswer: draft,
    scenarioRecommendations: ragScenarioRecommendations,
    usedDocumentIds: ragContext.usedDocumentIds,
  };
}
exports.generateRunbookDraft = generateRunbookDraft;

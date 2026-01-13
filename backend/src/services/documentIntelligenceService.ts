import * as crypto from "crypto";

export type DetectedDocType =
  | "ARCHI"
  | "BACKUP_POLICY"
  | "POLICY"
  | "SLA"
  | "RUNBOOK"
  | "CMDB"
  | "CONTRACT"
  | "RISK"
  | "UNKNOWN";

export interface ClassifiedDocument {
  type: DetectedDocType;
  confidence: number;
  reasons: string[];
}

export interface DetectedMetadata {
  services: string[];
  slas: string[];
  rtoHours?: number;
  rpoMinutes?: number;
  mtpdHours?: number;
  backupMentions?: string[];
  dependencies?: string[];
  criticalProcesses?: string[];
  regulations?: string[];
  risks?: string[];
  testsExercises?: string[];
  structuredSummary?: string;
}

export interface DocumentChunk {
  id: string;
  content: string;
  hash: string;
  metadata: Record<string, unknown>;
}

export interface MetadataMapping {
  services: string[];
  dependencies: Array<{ from?: string; to: string; targetIsInfra: boolean }>;
  infra: Array<{ name: string; type: string; provider?: string }>;
}

function scoreKeywords(content: string, keywords: RegExp[]): number {
  return keywords.reduce((acc, regex) => (regex.test(content) ? acc + 1 : acc), 0);
}

function normalizeEntityLabel(value: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function parseDependencyExpression(raw: string): { from?: string; to: string } | null {
  if (!raw || raw.trim().length === 0) return null;
  const cleaned = normalizeEntityLabel(raw);

  const arrowMatch = cleaned.split(/(?:->|=>|→|>)/);
  if (arrowMatch.length >= 2) {
    const from = normalizeEntityLabel(arrowMatch[0] || "");
    const to = normalizeEntityLabel(arrowMatch.slice(1).join("->"));
    if (to) {
      return from ? { from, to } : { to };
    }
  }

  const dependsMatch = cleaned.match(/(.+?)\s+(?:d[ée]pend(?:s)? de|depends on)\s+(.+)/i);
  if (dependsMatch?.[2]) {
    const from = normalizeEntityLabel(dependsMatch[1] || "");
    const to = normalizeEntityLabel(dependsMatch[2]);
    return from ? { from, to } : { to };
  }

  if (cleaned.includes(":")) {
    const [lhs, rhs] = cleaned.split(/:/, 2);
    const to = normalizeEntityLabel(rhs || "");
    if (to) {
      const from = normalizeEntityLabel(lhs || "");
      return from ? { from, to } : { to };
    }
  }

  return { to: cleaned };
}

const INFRA_HINTS: Array<{ regex: RegExp; type: string; provider?: string }> = [
  { regex: /\b(postgres(?:ql)?|mysql|mariadb|oracle|sql\s*server)\b/i, type: "DATABASE" },
  { regex: /\b(redis|cache|memcached)\b/i, type: "CACHE" },
  { regex: /\b(kafka|rabbitmq|sqs|pubsub|activemq|mq)\b/i, type: "MESSAGE_BUS" },
  { regex: /\b(kubernetes|k8s|eks|aks|gke|openshift)\b/i, type: "CONTAINER_ORCHESTRATION" },
  { regex: /\b(nginx|haproxy|load balancer|reverse proxy|ingress)\b/i, type: "NETWORK" },
  { regex: /\b(vpn|firewall|waf|ids|ips)\b/i, type: "SECURITY" },
  { regex: /\b(storage|bucket|s3|blob|gcs|nas|san)\b/i, type: "STORAGE" },
  { regex: /\b(aws|ec2|lambda|rds|aurora)\b/i, type: "CLOUD", provider: "AWS" },
  { regex: /\b(azure|vmss|aks|cosmos|blob)\b/i, type: "CLOUD", provider: "AZURE" },
  { regex: /\b(gcp|gce|gke|cloud run|spanner)\b/i, type: "CLOUD", provider: "GCP" },
  { regex: /\b(vm|server|instance|bare[- ]metal)\b/i, type: "COMPUTE" },
];

export function inferInfraComponent(label: string): { name: string; type: string; provider?: string } | null {
  const normalized = normalizeEntityLabel(label);
  if (!normalized) return null;

  for (const hint of INFRA_HINTS) {
    if (hint.regex.test(normalized)) {
      const result: { name: string; type: string; provider?: string } = {
        name: normalized,
        type: hint.type,
      };
      if (hint.provider) {
        result.provider = hint.provider;
      }
      return result;
    }
  }

  return null;
}

export function deriveMetadataMappings(metadata: DetectedMetadata): MetadataMapping {
  const serviceMap = new Map<string, string>();
  const infraMap = new Map<string, { name: string; type: string; provider?: string }>();
  const dependencies: Array<{ from?: string; to: string; targetIsInfra: boolean }> = [];

  (metadata.services || []).forEach((svc) => {
    const normalized = normalizeEntityLabel(svc);
    if (normalized) {
      serviceMap.set(normalized.toLowerCase(), normalized);
    }
  });

  for (const rawDep of metadata.dependencies || []) {
    const parsed = parseDependencyExpression(rawDep);
    if (!parsed?.to) continue;

    const targetInfra = inferInfraComponent(parsed.to);
    const normalizedTo = normalizeEntityLabel(parsed.to);
    const normalizedFrom = parsed.from ? normalizeEntityLabel(parsed.from) : null;

    if (normalizedFrom && normalizedFrom.length > 0) {
      serviceMap.set(normalizedFrom.toLowerCase(), normalizedFrom);
    }
    if (!targetInfra && normalizedTo) {
      serviceMap.set(normalizedTo.toLowerCase(), normalizedTo);
    }
    if (targetInfra) {
      infraMap.set(targetInfra.name.toLowerCase(), targetInfra);
    }

    const dependencyBase: { from?: string; to: string; targetIsInfra: boolean } = {
      to: targetInfra ? targetInfra.name : normalizedTo,
      targetIsInfra: Boolean(targetInfra),
    };
    if (normalizedFrom) {
      dependencyBase.from = normalizedFrom;
    }

    dependencies.push(dependencyBase);
  }

  return {
    services: Array.from(serviceMap.values()),
    dependencies,
    infra: Array.from(infraMap.values()),
  };
}

export function classifyDocumentType(
  text: string,
  fileName?: string | null,
  providedDocType?: string | null
): ClassifiedDocument {
  const normalizedText = (text || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  const declared = (providedDocType || "").toUpperCase();
  if (declared && declared.length >= 3) {
    return { type: declared as DetectedDocType, confidence: 0.9, reasons: ["Type fourni par l'utilisateur"] };
  }

  const candidates: { type: DetectedDocType; score: number; reasons: string[] }[] = [];

  const archiScore =
    scoreKeywords(normalizedText, [/diagram/, /architecture/, /topologie/, /vpc/, /subnet/]) +
    scoreKeywords(name, [/archi/, /diagram/]);
  candidates.push({ type: "ARCHI", score: archiScore, reasons: ["Présence de termes d'architecture"] });

  const backupScore =
    scoreKeywords(normalizedText, [/backup/, /sauvegarde/, /r\s*to/, /r\s*po/, /restauration/]) +
    scoreKeywords(name, [/backup/, /sauvegarde/]);
  candidates.push({ type: "BACKUP_POLICY", score: backupScore, reasons: ["Mentions de sauvegarde/PRA"] });

  const slaScore = scoreKeywords(normalizedText, [/sla/, /service level/, /uptime/, /availability/]);
  candidates.push({ type: "SLA", score: slaScore, reasons: ["Mentions SLA/availability"] });

  const runbookScore = scoreKeywords(normalizedText, [/runbook/, /procédure/, /plan de reprise/, /étape/]);
  candidates.push({ type: "RUNBOOK", score: runbookScore, reasons: ["Structure en procédures ou runbook"] });

  const cmdbScore = scoreKeywords(normalizedText, [/cmdb/, /configuration item/, /inventaire/, /asset/]);
  candidates.push({ type: "CMDB", score: cmdbScore, reasons: ["Inventaire ou CMDB"] });

  const contractScore = scoreKeywords(normalizedText, [/contrat/, /agreement/, /annexe/, /tiers/]);
  candidates.push({ type: "CONTRACT", score: contractScore, reasons: ["Termes contractuels"] });

  const riskScore = scoreKeywords(normalizedText, [/risque/, /risk/, /impact/, /menace/]);
  candidates.push({ type: "RISK", score: riskScore, reasons: ["Analyse de risques"] });

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score === 0) {
    return { type: "UNKNOWN", confidence: 0.25, reasons: ["Aucune signature forte détectée"] };
  }
  const confidence = Math.min(0.95, Math.max(0.35, best.score / 4));
  return { type: best.type, confidence, reasons: best.reasons };
}

function extractNumericValue(text: string, regex: RegExp, multiplier: number): number | undefined {
  const match = regex.exec(text);
  if (!match) return undefined;
  const raw = match[1];
  if (!raw) return undefined;
  const value = Number(raw.replace(/,/g, "."));
  if (Number.isNaN(value)) return undefined;
  return Math.round(value * multiplier);
}

export function extractDocumentMetadata(text: string): DetectedMetadata {
  const normalized = text || "";
  const services = Array.from(
    new Set(
      Array.from(normalized.matchAll(/(?:service|application)\s*[:\-]\s*([A-Za-z0-9 _\-]{3,80})/gi))
        .map((m) => m[1]?.trim())
        .filter((s): s is string => Boolean(s && s.length > 0))
    )
  );

  const slaMatches = Array.from(normalized.matchAll(/sla\s*[:=]\s*([^\n\r]{1,120})/gi))
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim());

  const backupMentions = Array.from(
    normalized.matchAll(/(full|incr[ée]ment(al)?|differential|diff[ée]rentielle)/gi)
  )
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());

  const dependencies = Array.from(normalized.matchAll(/d[ée]pend[ea]nce\s*[:\-]\s*([^\n\r]{1,120})/gi))
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim());

  const criticalProcesses = Array.from(
    normalized.matchAll(
      /(?:processus|process)\s*(?:critique|vital|cl[ée]|core)\s*[:\-]\s*([^\n\r]{3,120})/gi
    )
  )
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim());

  const regulationMatches = Array.from(
    normalized.matchAll(
      /(?:r[ée]glementation|r[èe]glement|conformit[ée]|norme|standard)\s*[:\-]\s*([^\n\r]{3,120})/gi
    )
  )
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim());

  const regulationKeywords = Array.from(
    normalized.matchAll(
      /\b(rgpd|gdpr|dora|nis2|iso\s*22301|pci[- ]?dss|soc\s*2|sox|hipaa)\b/gi
    )
  )
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.toUpperCase());

  const risks = Array.from(
    normalized.matchAll(/(?:risque|menace|risk)\s*[:\-]\s*([^\n\r]{3,120})/gi)
  )
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim());

  const testsExercises = Array.from(
    normalized.matchAll(/(?:test|exercice|simulation|drill|table[- ]?top)\s*[:\-]\s*([^\n\r]{3,120})/gi)
  )
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim());

  const meta: DetectedMetadata = {
    services,
    slas: slaMatches,
  };

  const rtoHours = extractNumericValue(normalized.toLowerCase(), /rto\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)\s*h/i, 1);
  const rpoMinutes = extractNumericValue(normalized.toLowerCase(), /rpo\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)/i, 1);
  const mtpdHours = extractNumericValue(normalized.toLowerCase(), /mtpd\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)/i, 1);
  if (rtoHours != null) meta.rtoHours = rtoHours;
  if (rpoMinutes != null) meta.rpoMinutes = rpoMinutes;
  if (mtpdHours != null) meta.mtpdHours = mtpdHours;
  if (backupMentions.length > 0) meta.backupMentions = backupMentions;
  if (dependencies.length > 0) meta.dependencies = dependencies;
  if (criticalProcesses.length > 0) meta.criticalProcesses = criticalProcesses;
  if (regulationMatches.length > 0 || regulationKeywords.length > 0) {
    const combined = Array.from(new Set([...regulationMatches, ...regulationKeywords]));
    if (combined.length > 0) meta.regulations = combined;
  }
  if (risks.length > 0) meta.risks = risks;
  if (testsExercises.length > 0) meta.testsExercises = testsExercises;
  return meta;
}

export function extractStructuredMetadata(structuredPayload: unknown): DetectedMetadata {
  const metadata: DetectedMetadata = { services: [], slas: [] };

  if (!structuredPayload || typeof structuredPayload !== "object") {
    return metadata;
  }

  const asAny = structuredPayload as any;
  if (Array.isArray(asAny.services)) {
    metadata.services = asAny.services
      .map((s: any) => (typeof s === "string" ? s : s?.name))
      .filter((v: any): v is string => typeof v === "string")
      .map((s: string) => s.trim());
  }
  if (Array.isArray(asAny.sla)) {
    metadata.slas = asAny.sla
      .map((v: any) => (typeof v === "string" ? v : v?.details))
      .filter((v: any): v is string => typeof v === "string")
      .map((s: string) => s.trim());
  }
  if (asAny.rtoHours) metadata.rtoHours = Number(asAny.rtoHours);
  if (asAny.rpoMinutes) metadata.rpoMinutes = Number(asAny.rpoMinutes);
  if (asAny.mtpdHours) metadata.mtpdHours = Number(asAny.mtpdHours);
  if (Array.isArray(asAny.criticalProcesses)) {
    metadata.criticalProcesses = asAny.criticalProcesses
      .map((v: any) => (typeof v === "string" ? v : v?.name))
      .filter((v: any): v is string => typeof v === "string")
      .map((s: string) => s.trim());
  }
  if (Array.isArray(asAny.regulations)) {
    metadata.regulations = asAny.regulations
      .map((v: any) => (typeof v === "string" ? v : v?.label))
      .filter((v: any): v is string => typeof v === "string")
      .map((s: string) => s.trim());
  }
  if (Array.isArray(asAny.risks)) {
    metadata.risks = asAny.risks
      .map((v: any) => (typeof v === "string" ? v : v?.title))
      .filter((v: any): v is string => typeof v === "string")
      .map((s: string) => s.trim());
  }
  if (Array.isArray(asAny.tests) || Array.isArray(asAny.exercises)) {
    const tests = Array.isArray(asAny.tests) ? asAny.tests : [];
    const exercises = Array.isArray(asAny.exercises) ? asAny.exercises : [];
    metadata.testsExercises = [...tests, ...exercises]
      .map((v: any) => (typeof v === "string" ? v : v?.title))
      .filter((v: any): v is string => typeof v === "string")
      .map((s: string) => s.trim());
  }

  metadata.structuredSummary = JSON.stringify(asAny, null, 2).slice(0, 4000);
  return metadata;
}

export function buildChunks(
  text: string,
  baseMetadata: Record<string, unknown>,
  maxLength = 900,
  overlap = 80
): DocumentChunk[] {
  const sanitized = (text || "").replace(/\r\n/g, "\n");
  const paragraphs = sanitized.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks: DocumentChunk[] = [];
  const seen = new Set<string>();

  const sentences = paragraphs.flatMap((paragraph) => splitIntoSentences(paragraph));
  const sentenceChunks = buildSentenceChunks(sentences, maxLength);

  for (let index = 0; index < sentenceChunks.length; index += 1) {
    const baseText = sentenceChunks[index];
    const overlapText =
      overlap > 0 && index > 0
        ? sentenceChunks[index - 1].slice(Math.max(0, sentenceChunks[index - 1].length - overlap))
        : "";
    const mergedText = overlapText ? `${overlapText} ${baseText}`.trim() : baseText;
    const chunkText = mergedText.slice(0, maxLength).trim();
    if (!chunkText) continue;

    const hash = crypto.createHash("sha256").update(chunkText).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);

    const id = crypto.randomUUID();
    chunks.push({
      id,
      content: chunkText,
      hash,
      metadata: { ...baseMetadata, length: chunkText.length },
    });
  }

  return chunks;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function infoDensity(text: string): number {
  const tokens = text
    .replace(/[^a-zA-Z0-9À-ÿ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return 0;
  const informative = tokens.filter((token) => token.length >= 5 || /\d/.test(token)).length;
  return informative / tokens.length;
}

function buildSentenceChunks(sentences: string[], maxLength: number): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }
    current = "";
  };

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
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

function sanitizeCollectionPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  return normalized.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildChromaCollectionName(baseCollection: string, tenantId: string): string {
  const base = sanitizeCollectionPart(baseCollection || "pra-documents") || "pra-documents";
  const tenantPart = sanitizeCollectionPart(tenantId) || "tenant";
  return `${base}-${tenantPart}`.slice(0, 60);
}

export async function pushChunksToChroma(
  chunks: DocumentChunk[],
  tenantId: string,
  documentId: string,
  retention?: { document?: Date | null; embedding?: Date | null }
): Promise<{ submitted: number; skippedReason?: string }> {
  const chromaUrl = process.env.CHROMADB_URL;
  const collection = buildChromaCollectionName(
    process.env.CHROMADB_COLLECTION || "pra-documents",
    tenantId
  );

  if (!chromaUrl) {
    return { submitted: 0, skippedReason: "CHROMADB_URL not configured" };
  }
  if (chunks.length === 0) {
    return { submitted: 0, skippedReason: "No chunks to index" };
  }

  const payload = {
    ids: chunks.map((c) => c.id),
    documents: chunks.map((c) => c.content),
    metadatas: chunks.map((c) => ({
      ...c.metadata,
      tenantId,
      documentId,
      retentionUntil: retention?.document ? retention.document.toISOString() : undefined,
      embeddingRetentionUntil: retention?.embedding
        ? retention.embedding.toISOString()
        : undefined,
    })),
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.CHROMADB_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.CHROMADB_API_TOKEN}`;
  }

  const response = await fetch(`${chromaUrl}/api/v1/collections/${collection}/add`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to push chunks to ChromaDB: ${response.status} ${errText}`);
  }

  return { submitted: chunks.length };
}

export function serializeMetadata(metadata: DetectedMetadata): string {
  return JSON.stringify(metadata);
}

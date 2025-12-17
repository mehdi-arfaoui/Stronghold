import * as crypto from "crypto";

export type DetectedDocType =
  | "ARCHI"
  | "BACKUP_POLICY"
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
  structuredSummary?: string;
}

export interface DocumentChunk {
  id: string;
  content: string;
  hash: string;
  metadata: Record<string, unknown>;
}

function scoreKeywords(content: string, keywords: RegExp[]): number {
  return keywords.reduce((acc, regex) => (regex.test(content) ? acc + 1 : acc), 0);
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

  for (const paragraph of paragraphs) {
    let remaining = paragraph;
    while (remaining.length > 0) {
      const slice = remaining.slice(0, maxLength);
      const chunkText = slice.trim();
      if (chunkText.length === 0) break;
      const hash = crypto.createHash("sha256").update(chunkText).digest("hex");
      if (seen.has(hash)) {
        remaining = remaining.slice(maxLength - overlap);
        continue;
      }
      seen.add(hash);
      const id = crypto.randomUUID();
      chunks.push({
        id,
        content: chunkText,
        hash,
        metadata: { ...baseMetadata, length: chunkText.length },
      });
      if (remaining.length <= maxLength) break;
      remaining = remaining.slice(maxLength - overlap);
    }
  }

  return chunks;
}

export async function pushChunksToChroma(
  chunks: DocumentChunk[],
  tenantId: string,
  documentId: string
): Promise<{ submitted: number; skippedReason?: string }> {
  const chromaUrl = process.env.CHROMADB_URL;
  const collection = process.env.CHROMADB_COLLECTION || "pra-documents";

  if (!chromaUrl) {
    return { submitted: 0, skippedReason: "CHROMADB_URL not configured" };
  }
  if (chunks.length === 0) {
    return { submitted: 0, skippedReason: "No chunks to index" };
  }

  const payload = {
    ids: chunks.map((c) => c.id),
    documents: chunks.map((c) => c.content),
    metadatas: chunks.map((c) => ({ ...c.metadata, tenantId, documentId })),
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

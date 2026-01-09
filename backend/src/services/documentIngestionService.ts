import * as fs from "fs";
import * as path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFParse } from "pdf-parse";
import * as xlsx from "xlsx";
import prisma from "../prismaClient";
import * as crypto from "crypto";
import type { Prisma, Service, InfraComponent } from "@prisma/client";
import {
  buildChunks,
  classifyDocumentType,
  deriveMetadataMappings,
  extractDocumentMetadata,
  extractStructuredMetadata,
  pushChunksToChroma,
  serializeMetadata,
} from "./documentIntelligenceService";
import { createExtractionSuggestions } from "./extractionSuggestionService";
import {
  downloadObjectToTempFile,
  resolveBucketAndKey,
} from "../clients/s3Client";
import { recordExtractionResult } from "../observability/metrics";

const execFileAsync = promisify(execFile);

async function fileExists(filePath: string) {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch (_err) {
    return false;
  }
}

async function resolveDocumentFilePath(doc: { storagePath: string; tenantId: string; storedName: string }) {
  const localPath = path.isAbsolute(doc.storagePath)
    ? doc.storagePath
    : path.join(process.cwd(), doc.storagePath);

  if (await fileExists(localPath)) {
    return { filePath: localPath, cleanup: async () => undefined };
  }

  const { bucket, key } = resolveBucketAndKey(doc.storagePath, doc.tenantId, doc.storedName);
  const downloadPath = await downloadObjectToTempFile(bucket, key, doc.storedName);
  return {
    filePath: downloadPath,
    cleanup: async () => {
      const directory = path.dirname(downloadPath);
      await fs.promises.rm(directory, { recursive: true, force: true });
    },
  };
}

type TxClient = Prisma.TransactionClient;

const DEFAULT_SERVICE_TYPE = "DISCOVERED";
const DEFAULT_SERVICE_CRITICALITY = "MEDIUM";
const DEFAULT_DEPENDENCY_TYPE = "IMPLICIT_DOCUMENT";
const DEFAULT_INFRA_TYPE = "DISCOVERED";

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function dedupePreserveCase(values: string[]): string[] {
  const map = new Map<string, string>();
  values
    .map((v) => normalizeName(v))
    .filter((v) => v.length > 0)
    .forEach((v) => {
      const key = v.toLowerCase();
      if (!map.has(key)) {
        map.set(key, v);
      }
    });
  return Array.from(map.values());
}

async function extractTextFromPdf(filePath: string): Promise<string> {
  const buffer = await fs.promises.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const data = await parser.getText();
    return data.text || "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractTextWithOcr(filePath: string): Promise<string> {
  const enableOcr = String(process.env.ENABLE_OCR || "true").toLowerCase() === "true";
  if (!enableOcr) {
    throw new Error("OCR désactivé (ENABLE_OCR non défini)");
  }

  const ocrLangs = process.env.OCR_LANGS || "eng+fra";
  try {
    const { stdout } = await execFileAsync("tesseract", [filePath, "stdout", "-l", ocrLangs], {
      maxBuffer: 12 * 1024 * 1024,
    });
    return stdout.toString();
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error("OCR indisponible (tesseract manquant)");
    }
    throw err;
  }
}

async function extractTextFromXlsx(filePath: string): Promise<string> {
  const workbook = xlsx.readFile(filePath);
  const parts: string[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const sheetJson = xlsx.utils.sheet_to_json<any>(sheet, { header: 1 });
    parts.push(`# Feuille: ${sheetName}`);
    for (const row of sheetJson) {
      if (Array.isArray(row)) {
        const line = row
          .map((cell) => (cell != null ? String(cell) : ""))
          .join(" | ");
        if (line.trim().length > 0) {
          parts.push(line);
        }
      }
    }
  });

  return parts.join("\n");
}

async function extractTextFromPlain(filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath, "utf8");
  return data;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function unzipEntry(filePath: string, entryPath: string): Promise<string> {
  const { stdout } = await execFileAsync("unzip", ["-p", filePath, entryPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.toString();
}

async function listZipEntries(filePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("unzip", ["-Z1", filePath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function extractTextFromDocx(filePath: string): Promise<string> {
  const xml = await unzipEntry(filePath, "word/document.xml");
  const matches = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g));
  const parts = matches.map((m) => decodeXmlEntities(m[1] || ""));
  return parts.join(" ").trim();
}

async function extractTextFromPptx(filePath: string): Promise<string> {
  const entries = await listZipEntries(filePath);
  const slideEntries = entries
    .filter((e) => e.startsWith("ppt/slides/slide") && e.endsWith(".xml"))
    .sort();

  const parts: string[] = [];

  for (const entry of slideEntries) {
    const xml = await unzipEntry(filePath, entry);
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g)).map((m) =>
      decodeXmlEntities(m[1] || "")
    );
    if (texts.length > 0) {
      parts.push(texts.join(" ").trim());
    }
  }

  return parts.join("\n").trim();
}

function isPlainTextExtension(ext: string): boolean {
  const exts = [".txt", ".md", ".json", ".csv", ".log", ".yml", ".yaml"];
  return exts.includes(ext.toLowerCase());
}

function isDocxExtension(ext: string): boolean {
  const exts = [".docx", ".docm"];
  return exts.includes(ext.toLowerCase());
}

function isPptxExtension(ext: string): boolean {
  const exts = [".pptx", ".pptm"];
  return exts.includes(ext.toLowerCase());
}

function isExcelExtension(ext: string): boolean {
  const exts = [".xlsx", ".xlsm", ".xlsb"];
  return exts.includes(ext.toLowerCase());
}

function parseCsvQuick(text: string): Record<string, any>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = (lines[0] || "").split(/[,;\t]/).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(/[,;\t]/).map((v) => v.trim());
    const row: Record<string, any> = {};
    headers.forEach((h, idx) => (row[h || `col_${idx}`] = values[idx] ?? ""));
    return row;
  });
}

function mergeMetadata(primary: any, secondary: any) {
  const merged = { ...primary };
  if (secondary?.services) {
    const dedup = new Set([...(primary.services || []), ...secondary.services]);
    merged.services = Array.from(dedup);
  }
  if (secondary?.slas) {
    const dedup = new Set([...(primary.slas || []), ...secondary.slas]);
    merged.slas = Array.from(dedup);
  }
  merged.rtoHours = primary.rtoHours || secondary.rtoHours;
  merged.rpoMinutes = primary.rpoMinutes || secondary.rpoMinutes;
  merged.mtpdHours = primary.mtpdHours || secondary.mtpdHours;
  merged.backupMentions = Array.from(
    new Set([...(primary.backupMentions || []), ...(secondary.backupMentions || [])])
  );
  merged.dependencies = Array.from(
    new Set([...(primary.dependencies || []), ...(secondary.dependencies || [])])
  );
  merged.criticalProcesses = Array.from(
    new Set([...(primary.criticalProcesses || []), ...(secondary.criticalProcesses || [])])
  );
  merged.regulations = Array.from(
    new Set([...(primary.regulations || []), ...(secondary.regulations || [])])
  );
  merged.risks = Array.from(new Set([...(primary.risks || []), ...(secondary.risks || [])]));
  merged.testsExercises = Array.from(
    new Set([...(primary.testsExercises || []), ...(secondary.testsExercises || [])])
  );
  merged.structuredSummary = primary.structuredSummary || secondary.structuredSummary;
  return merged;
}

function expandDependencies(
  dependencies: Array<{ from?: string; to: string; targetIsInfra: boolean }>,
  anchors: string[]
): Array<{ from: string; to: string; targetIsInfra: boolean }> {
  const seen = new Set<string>();
  const expanded: Array<{ from: string; to: string; targetIsInfra: boolean }> = [];
  const normalizedAnchors = dedupePreserveCase(anchors);

  for (const dep of dependencies) {
    const fromCandidates = dep.from ? [normalizeName(dep.from)] : normalizedAnchors;
    for (const anchor of fromCandidates) {
      if (!anchor || !dep.to) continue;
      const key = `${anchor.toLowerCase()}::${dep.to.toLowerCase()}::${dep.targetIsInfra ? "infra" : "service"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push({
        from: anchor,
        to: normalizeName(dep.to),
        targetIsInfra: dep.targetIsInfra,
      });
    }
  }

  return expanded;
}

async function ensureServices(tx: TxClient, tenantId: string, serviceNames: string[]): Promise<Map<string, Service>> {
  const cleanedNames = dedupePreserveCase(serviceNames);
  if (cleanedNames.length === 0) return new Map();

  const existing = await tx.service.findMany({
    where: { tenantId, name: { in: cleanedNames } },
  });

  const byKey = new Map<string, Service>();
  existing.forEach((svc) => byKey.set(svc.name.toLowerCase(), svc));

  for (const name of cleanedNames) {
    const key = name.toLowerCase();
    if (byKey.has(key)) continue;
    const created = await tx.service.create({
      data: {
        tenantId,
        name,
        type: DEFAULT_SERVICE_TYPE,
        criticality: DEFAULT_SERVICE_CRITICALITY,
        description: "Créé automatiquement depuis l'ingestion de documents",
      },
    });
    byKey.set(key, created);
  }

  return byKey;
}

async function ensureInfraComponents(
  tx: TxClient,
  tenantId: string,
  infraInputs: Array<{ name: string; type: string; provider?: string }>
): Promise<Map<string, InfraComponent>> {
  const cleaned = dedupePreserveCase(infraInputs.map((i) => i.name));
  if (cleaned.length === 0) return new Map();

  const existing = await tx.infraComponent.findMany({
    where: { tenantId, name: { in: cleaned } },
  });

  const byKey = new Map<string, InfraComponent>();
  existing.forEach((infra) => byKey.set(infra.name.toLowerCase(), infra));

  for (const infraInput of infraInputs) {
    const name = normalizeName(infraInput.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (byKey.has(key)) continue;
    const created = await tx.infraComponent.create({
      data: {
        tenantId,
        name,
        type: infraInput.type || DEFAULT_INFRA_TYPE,
        provider: infraInput.provider ?? null,
        notes: "Composant détecté automatiquement via ingestion de document",
      },
    });
    byKey.set(key, created);
  }

  return byKey;
}

async function ensureServiceInfraLinks(
  tx: TxClient,
  tenantId: string,
  links: Array<{ serviceName: string; infraName: string }>,
  services: Map<string, Service>,
  infraComponents: Map<string, InfraComponent>
) {
  if (links.length === 0) return;

  const existing = await tx.serviceInfraLink.findMany({
    where: { tenantId },
  });
  const existingKeys = new Set(existing.map((l) => `${l.serviceId}:${l.infraId}`));

  for (const link of links) {
    const service = services.get(link.serviceName.toLowerCase());
    const infra = infraComponents.get(link.infraName.toLowerCase());
    if (!service || !infra) continue;
    const key = `${service.id}:${infra.id}`;
    if (existingKeys.has(key)) continue;

    await tx.serviceInfraLink.create({
      data: {
        tenantId,
        serviceId: service.id,
        infraId: infra.id,
      },
    });
    existingKeys.add(key);
  }
}

async function ensureServiceDependencies(
  tx: TxClient,
  tenantId: string,
  dependencies: Array<{ from: string; to: string }>,
  services: Map<string, Service>
) {
  if (dependencies.length === 0) return;

  const existing = await tx.serviceDependency.findMany({
    where: { tenantId },
  });
  const existingKeys = new Set(existing.map((d) => `${d.fromServiceId}:${d.toServiceId}`));

  for (const dep of dependencies) {
    const from = services.get(dep.from.toLowerCase());
    const to = services.get(dep.to.toLowerCase());
    if (!from || !to) continue;
    const key = `${from.id}:${to.id}`;
    if (existingKeys.has(key)) continue;

    await tx.serviceDependency.create({
      data: {
        tenantId,
        fromServiceId: from.id,
        toServiceId: to.id,
        dependencyType: DEFAULT_DEPENDENCY_TYPE,
      },
    });
    existingKeys.add(key);
  }
}

async function ensureContinuityFromMetadata(
  tx: TxClient,
  tenantId: string,
  services: Map<string, Service>,
  metadata: any
) {
  const hasContinuityData =
    metadata.rtoHours != null || metadata.rpoMinutes != null || metadata.mtpdHours != null;
  const slaNotes =
    Array.isArray(metadata.slas) && metadata.slas.length > 0
      ? `SLAs détectés: ${metadata.slas.join(" | ").slice(0, 600)}`
      : undefined;

  if (!hasContinuityData && !slaNotes) return;

  const serviceIds = Array.from(services.values()).map((s) => s.id);
  const existing = await tx.serviceContinuity.findMany({
    where: { serviceId: { in: serviceIds } },
  });
  const continuityByService = new Map(existing.map((c) => [c.serviceId, c]));

  for (const service of services.values()) {
    const existingContinuity = continuityByService.get(service.id);
    const data: any = {};
    if (metadata.rtoHours != null) data.rtoHours = metadata.rtoHours;
    if (metadata.rpoMinutes != null) data.rpoMinutes = metadata.rpoMinutes;
    if (metadata.mtpdHours != null) data.mtpdHours = metadata.mtpdHours;
    if (slaNotes) {
      data.notes = existingContinuity?.notes
        ? `${existingContinuity.notes}\n${slaNotes}`.slice(0, 1000)
        : slaNotes;
    }

    if (existingContinuity) {
      await tx.serviceContinuity.update({
        where: { serviceId: service.id },
        data,
      });
    } else if (metadata.rtoHours != null || metadata.rpoMinutes != null) {
      await tx.serviceContinuity.create({
        data: {
          serviceId: service.id,
          rtoHours: metadata.rtoHours ?? metadata.mtpdHours ?? 0,
          rpoMinutes: metadata.rpoMinutes ?? 0,
          mtpdHours: metadata.mtpdHours ?? metadata.rtoHours ?? 0,
          notes: slaNotes ?? null,
        },
      });
    }
  }
}

export async function ingestDocumentText(documentId: string, tenantId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, tenantId },
  });

  if (!doc) {
    throw new Error("Document not found or not owned by tenant");
  }

  await prisma.document.updateMany({
    where: { id: doc.id, tenantId: doc.tenantId },
    data: { ingestionStatus: "PROCESSING", ingestionError: null },
  });

  const correlationId = `doc-${doc.id}`;

  const ext = path.extname(doc.originalName || "").toLowerCase();
  const mime = (doc.mimeType || "").toLowerCase();

  let text = "";
  let status: "SUCCESS" | "FAILED" | "UNSUPPORTED" = "SUCCESS";
  let error: string | null = null;
  let detectedDocType: string | null = null;
  let detectedMetadata: string | null = null;
  let textHash: string | null = null;
  let textExtractedAt: Date | null = null;
  let mergedMetadata: any = null;
  let chunks: ReturnType<typeof buildChunks> = [];
  let ingestionError: string | null = null;

  const resolvedFile = await resolveDocumentFilePath({
    storagePath: doc.storagePath,
    tenantId: doc.tenantId,
    storedName: doc.storedName,
  });

  try {
    if (mime.startsWith("image/")) {
      text = await extractTextWithOcr(resolvedFile.filePath);
    } else if (mime === "application/pdf" || ext === ".pdf") {
      text = await extractTextFromPdf(resolvedFile.filePath);
      if (text.trim().length === 0) {
        text = await extractTextWithOcr(resolvedFile.filePath);
      }
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      isDocxExtension(ext)
    ) {
      text = await extractTextFromDocx(resolvedFile.filePath);
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      isPptxExtension(ext)
    ) {
      text = await extractTextFromPptx(resolvedFile.filePath);
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      isExcelExtension(ext)
    ) {
      text = await extractTextFromXlsx(resolvedFile.filePath);
    } else if (isPlainTextExtension(ext) || mime.startsWith("text/")) {
      text = await extractTextFromPlain(resolvedFile.filePath);
    } else {
      status = "UNSUPPORTED";
      error = `Type de document non supporté pour l'instant (mime=${mime}, ext=${ext})`;
    }

    if (status === "SUCCESS" && text.trim().length === 0) {
      status = "FAILED";
      error = "Aucun contenu extrait du document";
    }

    if (status === "SUCCESS") {
      textHash = crypto.createHash("sha256").update(text).digest("hex");
      textExtractedAt = new Date();
      const classification = classifyDocumentType(text, doc.originalName, doc.docType);
      detectedDocType = classification.type;

      const textMetadata = extractDocumentMetadata(text);
      let structuredPayload: unknown = null;
      if (ext === ".json") {
        try {
          structuredPayload = JSON.parse(text);
        } catch (_err) {
          structuredPayload = null;
        }
      }
      if (ext === ".csv") {
        structuredPayload = parseCsvQuick(text);
      }

      const structuredMetadata = structuredPayload
        ? extractStructuredMetadata(structuredPayload)
        : { services: [], slas: [] };
      mergedMetadata = mergeMetadata(textMetadata, structuredMetadata);
      detectedMetadata = serializeMetadata(mergedMetadata);

      const baseMetadata = {
        classification: classification.type,
        classificationConfidence: classification.confidence,
        declaredDocType: doc.docType,
        documentId: doc.id,
        tenantId,
        originalName: doc.originalName,
        normalizedDocType: (doc.docType || classification.type || "").toString().toUpperCase(),
      } as Record<string, unknown>;
      chunks = buildChunks(text, baseMetadata);
    }
  } catch (e: any) {
    const message = e?.message || String(e);
    console.error("[documentIngestion] extraction error", {
      event: "extraction_error",
      correlationId,
      tenantId,
      documentId: doc.id,
      errorName: e?.name,
      errorMessage: message.slice(0, 200),
    });
    const errMessage = e?.message || String(e);
    const isOcrDisabled = errMessage.toLowerCase().includes("ocr") &&
      errMessage.toLowerCase().includes("désactivé");
    status = isOcrDisabled ? "UNSUPPORTED" : "FAILED";
    error = errMessage;
    ingestionError = errMessage;
  } finally {
    await resolvedFile.cleanup().catch(() => undefined);
  }

  const mapping = mergedMetadata
    ? deriveMetadataMappings(mergedMetadata)
    : { services: [], dependencies: [], infra: [] };
  const anchoredDependencies = expandDependencies(mapping.dependencies, mapping.services);

  const updatedAfterExtraction = await prisma.$transaction(async (tx) => {
    if (status === "SUCCESS" && mergedMetadata) {
      await createExtractionSuggestions({
        tenantId,
        documentId: doc.id,
        metadata: mergedMetadata,
        mapping,
        anchoredDependencies,
        prismaClient: tx,
      });
    } else {
      await tx.documentExtractionSuggestion.deleteMany({
        where: { tenantId, documentId: doc.id },
      });
    }

    const ingestionStatusValue =
      status === "SUCCESS" ? "TEXT_EXTRACTED" : status === "UNSUPPORTED" ? "UNSUPPORTED" : "ERROR";

    const updateResult = await tx.document.updateMany({
      where: { id: doc.id, tenantId: doc.tenantId },
      data: {
        extractionStatus: status,
        extractionError: error,
        textContent: status === "SUCCESS" ? text : null,
        detectedDocType: detectedDocType,
        detectedMetadata: detectedMetadata,
        textHash,
        vectorizedAt: null,
        ingestionStatus: ingestionStatusValue,
        ingestionError,
        textExtractedAt: status === "SUCCESS" ? textExtractedAt : null,
      },
    });

    if (updateResult.count !== 1) {
      throw new Error("Failed to update document for this tenant");
    }

    return tx.document.findFirstOrThrow({
      where: { id: doc.id, tenantId: doc.tenantId },
    });
  });

  if (status !== "SUCCESS") {
    return updatedAfterExtraction;
  }

  if (chunks.length === 0) {
    await prisma.document.updateMany({
      where: { id: doc.id, tenantId: doc.tenantId },
      data: { ingestionError: "Vectorisation ignorée: aucun chunk généré" },
    });
    return prisma.document.findFirstOrThrow({ where: { id: doc.id, tenantId: doc.tenantId } });
  }

  try {
    const retentionUntil = (doc as any).retentionUntil ?? null;
    const embeddingRetentionUntil = (doc as any).embeddingRetentionUntil ?? null;
    const vecResult = await pushChunksToChroma(chunks, tenantId, doc.id, {
      document: retentionUntil,
      embedding: embeddingRetentionUntil,
    });
    if (vecResult.submitted > 0) {
      const updated = await prisma.document.updateMany({
        where: { id: doc.id, tenantId: doc.tenantId },
        data: {
          vectorizedAt: new Date(),
          ingestionStatus: "VECTORIZED",
          ingestionError: null,
        },
      });

      if (updated.count !== 1) {
        throw new Error("Failed to update document after vectorization");
      }
    } else if (vecResult.skippedReason) {
      await prisma.document.updateMany({
        where: { id: doc.id, tenantId: doc.tenantId },
        data: { ingestionError: `Vectorisation ignorée: ${vecResult.skippedReason}`.slice(0, 255) },
      });
    }
  } catch (vecErr: any) {
    console.error("[documentIngestion] vectorization error", {
      correlationId,
      tenantId,
      documentId: doc.id,
      message: (vecErr?.message || "vectorization failed").slice(0, 200),
    });
    await prisma.document.updateMany({
      where: { id: doc.id, tenantId: doc.tenantId },
      data: {
        ingestionError: (vecErr?.message || "vectorization failed").slice(0, 255),
        ingestionStatus: "ERROR",
      },
    });
  }

  recordExtractionResult(status === "SUCCESS", tenantId);
  return prisma.document.findFirstOrThrow({ where: { id: doc.id, tenantId: doc.tenantId } });
}

function resolveCallbackUrl(): string | null {
  if (process.env.N8N_INGESTION_CALLBACK_URL) {
    return process.env.N8N_INGESTION_CALLBACK_URL;
  }
  if (process.env.API_PUBLIC_URL) {
    return `${process.env.API_PUBLIC_URL.replace(/\/$/, "")}/webhooks/n8n/document-ingestion`;
  }
  return null;
}

export async function enqueueDocumentIngestion(documentId: string, tenantId: string) {
  const queueUrl = process.env.N8N_INGESTION_TRIGGER_URL;
  const doc = await prisma.document.findFirst({
    where: { id: documentId, tenantId },
  });

  if (!doc) {
    throw new Error("Document not found or not owned by tenant");
  }

  await prisma.document.updateMany({
    where: { id: doc.id, tenantId: doc.tenantId },
    data: {
      ingestionStatus: queueUrl ? "QUEUED" : "PROCESSING",
      ingestionQueuedAt: queueUrl ? new Date() : null,
      ingestionError: null,
      extractionStatus: "PENDING",
      extractionError: null,
    },
  });

  if (!queueUrl) {
    return ingestDocumentText(documentId, tenantId);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.N8N_WEBHOOK_TOKEN) {
    headers["x-webhook-token"] = process.env.N8N_WEBHOOK_TOKEN;
  }

  const payload = {
    documentId: doc.id,
    tenantId,
    storagePath: doc.storagePath,
    mimeType: doc.mimeType,
    callbackUrl: resolveCallbackUrl(),
  };

  try {
    const response = await fetch(queueUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Queue dispatch failed: ${response.status} ${errText}`);
    }
  } catch (err: any) {
    const message = err?.message || "Queue dispatch failed";
    await prisma.document.updateMany({
      where: { id: doc.id, tenantId: doc.tenantId },
      data: { ingestionStatus: "ERROR", ingestionError: message.slice(0, 255) },
    });
    throw err;
  }

  return prisma.document.findFirstOrThrow({
    where: { id: doc.id, tenantId: doc.tenantId },
  });
}

export const __test__ = {
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPptx,
  decodeXmlEntities,
};

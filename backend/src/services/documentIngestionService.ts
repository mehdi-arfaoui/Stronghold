import * as fs from "fs";
import * as path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFParse } from "pdf-parse";
import * as xlsx from "xlsx";
import prisma from "../prismaClient";
import * as crypto from "crypto";
import {
  buildChunks,
  classifyDocumentType,
  extractDocumentMetadata,
  extractStructuredMetadata,
  pushChunksToChroma,
  serializeMetadata,
} from "./documentIntelligenceService";



// même logique que dans documentRoutes pour le dossier uploads
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

const execFileAsync = promisify(execFile);

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
  const enableOcr = String(process.env.ENABLE_OCR || "false").toLowerCase() === "true";
  if (!enableOcr) {
    throw new Error("OCR désactivé (ENABLE_OCR non défini)");
  }

  const { stdout } = await execFileAsync("tesseract", [filePath, "stdout", "-l", "eng+fra"], {
    maxBuffer: 12 * 1024 * 1024,
  });
  return stdout.toString();
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
  merged.structuredSummary = primary.structuredSummary || secondary.structuredSummary;
  return merged;
}

export async function ingestDocumentText(documentId: string, tenantId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, tenantId },
  });

  if (!doc) {
    throw new Error("Document not found or not owned by tenant");
  }

  const correlationId = `doc-${doc.id}`;

  const filePath = path.isAbsolute(doc.storagePath)
    ? doc.storagePath
    : path.join(process.cwd(), doc.storagePath);

  const ext = path.extname(doc.originalName || "").toLowerCase();
  const mime = (doc.mimeType || "").toLowerCase();

  let text = "";
  let status: "SUCCESS" | "FAILED" | "UNSUPPORTED" = "SUCCESS";
  let error: string | null = null;
  let detectedDocType: string | null = null;
  let detectedMetadata: string | null = null;
  let textHash: string | null = null;
  let vectorizedAt: Date | null = null;

  try {
    if (mime.startsWith("image/")) {
      text = await extractTextWithOcr(filePath);
    } else if (mime === "application/pdf" || ext === ".pdf") {
      text = await extractTextFromPdf(filePath);
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      isDocxExtension(ext)
    ) {
      text = await extractTextFromDocx(filePath);
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      isPptxExtension(ext)
    ) {
      text = await extractTextFromPptx(filePath);
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      isExcelExtension(ext)
    ) {
      text = await extractTextFromXlsx(filePath);
    } else if (isPlainTextExtension(ext) || mime.startsWith("text/")) {
      text = await extractTextFromPlain(filePath);
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
      const mergedMetadata = mergeMetadata(textMetadata, structuredMetadata);
      detectedMetadata = serializeMetadata(mergedMetadata);

      const baseMetadata = {
        classification: classification.type,
        classificationConfidence: classification.confidence,
        declaredDocType: doc.docType,
      } as Record<string, unknown>;
      const chunks = buildChunks(text, baseMetadata);
      if (chunks.length > 0) {
        try {
          await pushChunksToChroma(chunks, tenantId, doc.id);
          vectorizedAt = new Date();
        } catch (vecErr: any) {
          console.error("[documentIngestion] vectorization error", {
            correlationId,
            tenantId,
            documentId: doc.id,
            message: (vecErr?.message || "vectorization failed").slice(0, 200),
          });
        }
      }
    }
  } catch (e: any) {
    const message = e?.message || String(e);
    console.error("[documentIngestion] extraction error", {
      correlationId,
      tenantId,
      documentId: doc.id,
      message: message.slice(0, 300),
    });
    const errMessage = e?.message || String(e);
    const isOcrDisabled = errMessage.toLowerCase().includes("ocr") &&
      errMessage.toLowerCase().includes("désactivé");
    status = isOcrDisabled ? "UNSUPPORTED" : "FAILED";
    error = errMessage;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.document.updateMany({
      where: { id: doc.id, tenantId: doc.tenantId },
      data: {
        extractionStatus: status,
        extractionError: error,
        textContent: status === "SUCCESS" ? text : null,
        detectedDocType: detectedDocType,
        detectedMetadata: detectedMetadata,
        textHash,
        vectorizedAt,
      },
    });

    if (updateResult.count !== 1) {
      throw new Error("Failed to update document for this tenant");
    }

    return tx.document.findFirstOrThrow({
      where: { id: doc.id, tenantId: doc.tenantId },
    });
  });

  return updated;
}

export const __test__ = {
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPptx,
  decodeXmlEntities,
};

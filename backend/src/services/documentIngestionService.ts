import * as fs from "fs";
import * as path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFParse } from "pdf-parse";
import * as xlsx from "xlsx";
import prisma from "../prismaClient";



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

  try {
    if (mime.startsWith("image/")) {
      // TODO: plus tard, OCR / vision IA
      status = "UNSUPPORTED";
      error = "Extraction OCR non implémentée (image)";
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
  } catch (e: any) {
    const message = e?.message || String(e);
    console.error("[documentIngestion] extraction error", {
      correlationId,
      tenantId,
      documentId: doc.id,
      message: message.slice(0, 300),
    });
    status = "FAILED";
    error = e?.message || String(e);
  }

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: {
      extractionStatus: status,
      extractionError: error,
      textContent: status === "SUCCESS" ? text : null,
    },
  });

  return updated;
}

export const __test__ = {
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPptx,
  decodeXmlEntities,
};

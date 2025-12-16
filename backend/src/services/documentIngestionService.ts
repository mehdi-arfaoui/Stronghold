import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParseModule = require("pdf-parse");
import * as xlsx from "xlsx";
import prisma from "../prismaClient";

// On normalise pour couvrir tous les cas possibles d'export du module pdf-parse
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = (
  (pdfParseModule as any)?.default?.default ??
  (pdfParseModule as any)?.default ??
  pdfParseModule
);



// même logique que dans documentRoutes pour le dossier uploads
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

async function extractTextFromPdf(filePath: string): Promise<string> {
    const buffer = await fs.promises.readFile(filePath);
  
    const data = await pdfParse(buffer);
  
    return (data as any).text || "";
  }
  
  

async function extractTextFromXlsx(filePath: string): Promise<string> {
  const workbook = xlsx.readFile(filePath);
  const parts: string[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
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

function isPlainTextExtension(ext: string): boolean {
  const exts = [".txt", ".md", ".json", ".csv", ".log", ".yml", ".yaml"];
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
      // 🔧 Temporairement, on ne traite pas les PDF pour ne pas bloquer le projet.
      // Quand on résoudra le problème de pdf-parse ou qu'on changera de lib,
      // on activera à nouveau l'extraction ici.
      status = "UNSUPPORTED";
      error =
        "Extraction PDF non activée pour l'instant (problème de librairie côté serveur)";
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      isExcelExtension(ext)
    ) {
      text = await extractTextFromXlsx(filePath);
    } else if (isPlainTextExtension(ext) || mime.startsWith("text/")) {
      text = await extractTextFromPlain(filePath);
    } else if (
      mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      // Pour DOCX, on peut ajouter une lib dédiée plus tard (mammoth, etc.)
      status = "UNSUPPORTED";
      error = "Extraction DOCX non implémentée pour l'instant";
    } else {
      status = "UNSUPPORTED";
      error = `Type de document non supporté pour l'instant (mime=${mime}, ext=${ext})`;
    }
  } catch (e: any) {

    console.error("Error extracting document text:", e);
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

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFParse } from "pdf-parse";
import * as xlsx from "xlsx";

const execFileAsync = promisify(execFile);

const MAX_TEXT_LENGTH = 200_000;

const SENSITIVE_TYPES = [
  "CREDIT_CARD",
  "IBAN",
  "NATIONAL_ID",
  "EMAIL",
  "PHONE",
  "ADDRESS",
  "BIRTH_DATE",
  "PASSWORD",
  "API_KEY",
] as const;

export type SensitiveType = (typeof SENSITIVE_TYPES)[number];

export type SensitiveFinding = {
  type: SensitiveType;
  count: number;
};

export type SensitiveScanResult = {
  findings: SensitiveFinding[];
  blockedTypes: SensitiveType[];
  allowedTypes: SensitiveType[];
};

function parseAllowedTypes(): Set<SensitiveType> {
  const raw = process.env.ALLOWED_SENSITIVE_DATA_TYPES;
  if (!raw) return new Set();
  const allowed = raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean) as SensitiveType[];
  return new Set(allowed.filter((value) => SENSITIVE_TYPES.includes(value)));
}

function limitText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return text.slice(0, MAX_TEXT_LENGTH);
}

function countMatches(pattern: RegExp, text: string): number {
  if (!text) return 0;
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function luhnCheck(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const digit = Number(digits[i]);
    if (Number.isNaN(digit)) return false;
    let value = digit;
    if (shouldDouble) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function countCreditCards(text: string): number {
  const candidates = text.match(/(?:\d[ -]*?){13,19}/g) || [];
  let count = 0;
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (luhnCheck(digits)) count += 1;
  }
  return count;
}

function countIbans(text: string): number {
  const upper = text.toUpperCase();
  const matches = upper.match(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g) || [];
  return matches.filter((value) => value.length >= 15 && value.length <= 34).length;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function writeTempFile(buffer: Buffer, ext: string) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scan-"));
  const filePath = path.join(dir, `upload${ext || ""}`);
  await fs.promises.writeFile(filePath, buffer);
  return {
    filePath,
    cleanup: async () => {
      await fs.promises.rm(dir, { recursive: true, force: true });
    },
  };
}

async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const data = await parser.getText();
    return data.text || "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
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

async function extractTextFromDocxBuffer(buffer: Buffer, ext: string): Promise<string> {
  const temp = await writeTempFile(buffer, ext);
  try {
    const xml = await unzipEntry(temp.filePath, "word/document.xml");
    const matches = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g));
    const parts = matches.map((m) => decodeXmlEntities(m[1] || ""));
    return parts.join(" ").trim();
  } finally {
    await temp.cleanup();
  }
}

async function extractTextFromPptxBuffer(buffer: Buffer, ext: string): Promise<string> {
  const temp = await writeTempFile(buffer, ext);
  try {
    const entries = await listZipEntries(temp.filePath);
    const slideEntries = entries
      .filter((e) => e.startsWith("ppt/slides/slide") && e.endsWith(".xml"))
      .sort();

    const parts: string[] = [];

    for (const entry of slideEntries) {
      const xml = await unzipEntry(temp.filePath, entry);
      const texts = Array.from(xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g)).map((m) =>
        decodeXmlEntities(m[1] || "")
      );
      if (texts.length > 0) {
        parts.push(texts.join(" ").trim());
      }
    }

    return parts.join("\n").trim();
  } finally {
    await temp.cleanup();
  }
}

function extractTextFromXlsxBuffer(buffer: Buffer): string {
  const workbook = xlsx.read(buffer, { type: "buffer" });
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

async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<string> {
  const ext = path.extname(fileName || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (mime.startsWith("image/")) return "";

  if (mime === "application/pdf" || ext === ".pdf") {
    return extractTextFromPdfBuffer(buffer);
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    isDocxExtension(ext)
  ) {
    return extractTextFromDocxBuffer(buffer, ext || ".docx");
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    isPptxExtension(ext)
  ) {
    return extractTextFromPptxBuffer(buffer, ext || ".pptx");
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    isExcelExtension(ext)
  ) {
    return extractTextFromXlsxBuffer(buffer);
  }

  if (isPlainTextExtension(ext) || mime.startsWith("text/")) {
    return buffer.toString("utf8");
  }

  return "";
}

function buildFindings(text: string): SensitiveFinding[] {
  const trimmedText = limitText(text);
  if (!trimmedText) return [];

  const findings: SensitiveFinding[] = [];

  const creditCards = countCreditCards(trimmedText);
  if (creditCards > 0) {
    findings.push({ type: "CREDIT_CARD", count: creditCards });
  }

  const ibanCount = countIbans(trimmedText);
  if (ibanCount > 0) {
    findings.push({ type: "IBAN", count: ibanCount });
  }

  const nationalIdCount = countMatches(/\b\d{13}\b/g, trimmedText);
  if (nationalIdCount > 0) {
    findings.push({ type: "NATIONAL_ID", count: nationalIdCount });
  }

  const emailCount = countMatches(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, trimmedText);
  if (emailCount > 0) {
    findings.push({ type: "EMAIL", count: emailCount });
  }

  const phoneCount = countMatches(/\b\+?[0-9][0-9\s().-]{7,}[0-9]\b/g, trimmedText);
  if (phoneCount > 0) {
    findings.push({ type: "PHONE", count: phoneCount });
  }

  const addressCount = countMatches(
    /\b\d{1,4}\s+[A-ZÀ-ÿ][A-ZÀ-ÿ'’.\s-]{3,}\b/gi,
    trimmedText
  );
  if (addressCount > 0) {
    findings.push({ type: "ADDRESS", count: addressCount });
  }

  const birthDateCount = countMatches(
    /\b(?:0?[1-9]|[12]\d|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}\b/g,
    trimmedText
  );
  if (birthDateCount > 0) {
    findings.push({ type: "BIRTH_DATE", count: birthDateCount });
  }

  const passwordCount = countMatches(/(?:password|mot de passe)\s*[:=]\s*\S{6,}/gi, trimmedText);
  if (passwordCount > 0) {
    findings.push({ type: "PASSWORD", count: passwordCount });
  }

  const apiKeyCount = countMatches(/(?:api[_-]?key\s*[:=]\s*\S{10,}|sk_[a-f0-9]{32,})/gi, trimmedText);
  if (apiKeyCount > 0) {
    findings.push({ type: "API_KEY", count: apiKeyCount });
  }

  return findings;
}

export async function scanSensitiveDataOnUpload(options: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}): Promise<SensitiveScanResult> {
  const allowedTypes = parseAllowedTypes();
  const text = await extractTextFromBuffer(options.buffer, options.fileName, options.mimeType);
  const findings = buildFindings(text);
  const blockedTypes = findings
    .map((finding) => finding.type)
    .filter((type) => !allowedTypes.has(type));

  return {
    findings,
    blockedTypes: Array.from(new Set(blockedTypes)),
    allowedTypes: Array.from(allowedTypes),
  };
}

export function scanSensitiveText(text: string): SensitiveFinding[] {
  return buildFindings(text);
}

export const __test__ = {
  buildFindings,
  luhnCheck,
  countIbans,
  scanSensitiveText,
};

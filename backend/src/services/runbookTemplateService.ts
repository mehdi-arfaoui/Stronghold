import * as crypto from "crypto";
import AdmZip from "adm-zip";
import fs from "fs";
import mammoth from "mammoth";
import type { RunbookTemplate } from "@prisma/client";
import { downloadObjectToTempFile, resolveBucketAndKey } from "../clients/s3Client.js";

export type TemplateFormat = "DOCX" | "ODT" | "MARKDOWN";

export function detectTemplateFormat(mimeType: string, originalName: string): TemplateFormat | null {
  const lowerMime = (mimeType || "").toLowerCase();
  const lowerName = originalName.toLowerCase();

  if (lowerMime.includes("officedocument.wordprocessingml.document") || lowerName.endsWith(".docx")) {
    return "DOCX";
  }
  if (lowerMime.includes("application/vnd.oasis.opendocument.text") || lowerName.endsWith(".odt")) {
    return "ODT";
  }
  if (lowerMime.includes("markdown") || lowerMime.includes("text/markdown") || lowerName.endsWith(".md")) {
    return "MARKDOWN";
  }

  // fallback: treat plain text as markdown for simplicity
  if (lowerMime.startsWith("text/")) {
    return "MARKDOWN";
  }

  return null;
}

export function computeBufferHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<\/text:p>/g, "\n")
    .replace(/<\/text:h>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readOdtText(filePath: string): Promise<string> {
  const zip = new AdmZip(filePath);
  const contentEntry = zip.getEntry("content.xml");
  if (!contentEntry) {
    return "";
  }
  const content = contentEntry.getData().toString("utf8");
  return stripXmlTags(content);
}

async function readDocxText(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || "";
}

export async function loadTemplateText(template: RunbookTemplate): Promise<string> {
  const { bucket, key } = resolveBucketAndKey(template.storagePath, template.tenantId, template.storedName);
  const tempFile = await downloadObjectToTempFile(bucket, key, template.originalName);

  const format = (template.format || "").toUpperCase();
  if (format === "DOCX") {
    return readDocxText(tempFile);
  }
  if (format === "ODT") {
    return readOdtText(tempFile);
  }

  return fs.promises.readFile(tempFile, "utf8");
}

export function applyPlaceholders(content: string, placeholders: Record<string, string>): string {
  let output = content;
  Object.entries(placeholders).forEach(([token, value]) => {
    const pattern = new RegExp(`{{\\s*${token}\\s*}}`, "gi");
    output = output.replace(pattern, value);
  });
  return output;
}

export function sanitizeTemplateDescription(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.trim().slice(0, 2000) || null;
}

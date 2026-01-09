import * as fs from "fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OcrProvider = "TESSERACT" | "AWS_TEXTRACT";

export type OcrResult = {
  text: string;
  provider: OcrProvider;
};

const OCR_DISABLED_MESSAGE = "OCR désactivé (ENABLE_OCR non défini)";

function isOcrEnabled(): boolean {
  return String(process.env.ENABLE_OCR || "true").toLowerCase() === "true";
}

function isTextractEnabled(): boolean {
  const enabled = String(process.env.AWS_TEXTRACT_ENABLED || "").toLowerCase() === "true";
  const region = process.env.AWS_TEXTRACT_REGION || process.env.AWS_REGION;
  return enabled && Boolean(region);
}

function resolveProvider(): OcrProvider {
  return isTextractEnabled() ? "AWS_TEXTRACT" : "TESSERACT";
}

async function runTesseract(filePath: string): Promise<string> {
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

async function runTextract(filePath: string): Promise<string> {
  const region = process.env.AWS_TEXTRACT_REGION || process.env.AWS_REGION;
  if (!region) {
    throw new Error("OCR indisponible (AWS_TEXTRACT_REGION manquant)");
  }

  const buffer = await fs.promises.readFile(filePath);
  const { TextractClient, DetectDocumentTextCommand } = await import("@aws-sdk/client-textract");

  const client = new TextractClient({ region });
  const response = await client.send(
    new DetectDocumentTextCommand({
      Document: { Bytes: buffer },
    })
  );

  const lines = (response.Blocks || [])
    .filter((block) => block.BlockType === "LINE" && block.Text)
    .map((block) => block.Text as string);

  return lines.join("\n");
}

export async function extractTextWithOcr(filePath: string): Promise<OcrResult> {
  if (!isOcrEnabled()) {
    throw new Error(OCR_DISABLED_MESSAGE);
  }

  const provider = resolveProvider();
  if (provider === "AWS_TEXTRACT") {
    try {
      const text = await runTextract(filePath);
      return { text, provider };
    } catch (_err) {
      const text = await runTesseract(filePath);
      return { text, provider: "TESSERACT" };
    }
  }

  const text = await runTesseract(filePath);
  return { text, provider };
}

export const __test__ = {
  isOcrEnabled,
  isTextractEnabled,
  resolveProvider,
  OCR_DISABLED_MESSAGE,
};

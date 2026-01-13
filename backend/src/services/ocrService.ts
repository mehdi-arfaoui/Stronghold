import * as fs from "fs";
type TesseractModule = {
  recognize: (filePath: string, config?: { lang?: string }) => Promise<string>;
};

export type OcrProvider = "TESSERACT" | "AWS_TEXTRACT";

export type OcrResult = {
  text: string;
  provider: OcrProvider;
};

type OcrRunners = {
  runTesseract: (filePath: string) => Promise<string>;
  runTextract: (filePath: string) => Promise<string>;
};

const OCR_DISABLED_MESSAGE = "OCR désactivé (ENABLE_OCR non défini)";
const OCR_TESSERACT_DOC_URL =
  "Consultez TROUBLESHOOTING.md#ocr-indisponible-tesseract-manquant pour l'installation.";
const OCR_TESSERACT_MISSING_MESSAGE = `OCR indisponible (tesseract manquant). ${OCR_TESSERACT_DOC_URL}`;

function isOcrEnabled(): boolean {
  return String(process.env.ENABLE_OCR || "true").toLowerCase() === "true";
}

function isTextractEnabled(): boolean {
  const enabled = String(process.env.AWS_TEXTRACT_ENABLED || "").toLowerCase() === "true";
  const region = process.env.AWS_TEXTRACT_REGION || process.env.AWS_REGION;
  return enabled && Boolean(region);
}

function resolveProvider(): OcrProvider {
  const explicitProvider = String(process.env.OCR_PROVIDER || "").toLowerCase();
  if (explicitProvider === "aws_textract" || explicitProvider === "textract") {
    return "AWS_TEXTRACT";
  }
  if (explicitProvider === "tesseract") {
    return "TESSERACT";
  }
  return "TESSERACT";
}

async function runTesseract(filePath: string): Promise<string> {
  const ocrLangs = process.env.OCR_LANGS || "eng+fra";
  try {
    const tesseractModule = (await import("node-tesseract-ocr")) as {
      default?: TesseractModule;
    } & TesseractModule;
    const tesseract = tesseractModule.default ?? tesseractModule;
    return await tesseract.recognize(filePath, { lang: ocrLangs });
  } catch (err: any) {
    if (err?.code === "ENOENT" || String(err?.message || "").toLowerCase().includes("tesseract")) {
      throw new Error(OCR_TESSERACT_MISSING_MESSAGE);
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

export async function extractTextWithOcr(
  filePath: string,
  runners: OcrRunners = { runTesseract, runTextract }
): Promise<OcrResult> {
  if (!isOcrEnabled()) {
    throw new Error(OCR_DISABLED_MESSAGE);
  }

  const provider = resolveProvider();
  if (provider === "AWS_TEXTRACT") {
    try {
      const text = await runners.runTextract(filePath);
      return { text, provider: "AWS_TEXTRACT" };
    } catch (_err) {
      const text = await runners.runTesseract(filePath);
      return { text, provider: "TESSERACT" };
    }
  }

  try {
    const text = await runners.runTesseract(filePath);
    return { text, provider: "TESSERACT" };
  } catch (err: any) {
    if (isTextractEnabled() && err instanceof Error && err.message.includes("tesseract manquant")) {
      const text = await runners.runTextract(filePath);
      return { text, provider: "AWS_TEXTRACT" };
    }
    throw err;
  }
}

export const __test__ = {
  isOcrEnabled,
  isTextractEnabled,
  resolveProvider,
  OCR_DISABLED_MESSAGE,
  OCR_TESSERACT_MISSING_MESSAGE,
};

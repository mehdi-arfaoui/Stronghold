require("ts-node/register");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { ingestDocumentText } = require("../src/services/documentIngestionService");

function createTempFile(filename) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ingestion-"));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, "fake image content");
  return { dir, filePath };
}

function buildDocument(filePath, overrides = {}) {
  return {
    id: "doc-image",
    tenantId: "tenant-1",
    storagePath: filePath,
    originalName: path.basename(filePath),
    mimeType: "image/png",
    extractionStatus: "PENDING",
    extractionError: null,
    textContent: null,
    ...overrides,
  };
}

function buildPrismaStub(document) {
  return {
    document: {
      findFirst: async ({ where }) => {
        if (where.id === document.id && where.tenantId === document.tenantId) {
          return document;
        }
        return null;
      },
      update: async ({ data }) => ({ ...document, ...data }),
    },
  };
}

test("ingests images via OCR when enabled", async () => {
  const { dir, filePath } = createTempFile("image.png");
  const previousOcrEnabled = process.env.OCR_ENABLED;
  const previousOcrThreshold = process.env.OCR_CONFIDENCE_THRESHOLD;

  try {
    process.env.OCR_ENABLED = "true";
    process.env.OCR_CONFIDENCE_THRESHOLD = "60";

    const document = buildDocument(filePath);
    const prismaStub = buildPrismaStub(document);
    const updated = await ingestDocumentText(document.id, document.tenantId, {
      prismaClient: prismaStub,
      ocrProvider: async (inputPath) => {
        assert.equal(inputPath, filePath);
        return { text: "Texte extrait par OCR", confidence: 95 };
      },
    });

    assert.equal(updated.extractionStatus, "SUCCESS");
    assert.equal(updated.extractionError, null);
    assert.equal(updated.textContent, "Texte extrait par OCR");
  } finally {
    if (previousOcrEnabled === undefined) {
      delete process.env.OCR_ENABLED;
    } else {
      process.env.OCR_ENABLED = previousOcrEnabled;
    }

    if (previousOcrThreshold === undefined) {
      delete process.env.OCR_CONFIDENCE_THRESHOLD;
    } else {
      process.env.OCR_CONFIDENCE_THRESHOLD = previousOcrThreshold;
    }

    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("flags images as unsupported when OCR is disabled", async () => {
  const { dir, filePath } = createTempFile("photo.jpg");
  const previousOcrEnabled = process.env.OCR_ENABLED;

  try {
    process.env.OCR_ENABLED = "false";

    const document = buildDocument(filePath, {
      id: "doc-image-disabled",
      mimeType: "image/jpeg",
    });
    const prismaStub = buildPrismaStub(document);

    const updated = await ingestDocumentText(document.id, document.tenantId, {
      prismaClient: prismaStub,
      ocrProvider: async () => {
        throw new Error("OCR provider should not be called when disabled");
      },
    });

    assert.equal(updated.extractionStatus, "UNSUPPORTED");
    assert.equal(updated.textContent, null);
    assert.match(updated.extractionError || "", /ocr désactivée/i);
  } finally {
    if (previousOcrEnabled === undefined) {
      delete process.env.OCR_ENABLED;
    } else {
      process.env.OCR_ENABLED = previousOcrEnabled;
    }

    fs.rmSync(dir, { recursive: true, force: true });
  }
});

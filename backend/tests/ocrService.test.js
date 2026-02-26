const assert = require("node:assert/strict");
const { test } = require("node:test");
const { __test__, extractTextWithOcr } = require("../src/services/ocrService.ts");

test("resolveProvider respecte OCR_PROVIDER", (t) => {
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });

  process.env.OCR_PROVIDER = "aws_textract";
  assert.equal(__test__.resolveProvider(), "AWS_TEXTRACT");

  process.env.OCR_PROVIDER = "tesseract";
  assert.equal(__test__.resolveProvider(), "TESSERACT");
});

test("isOcrEnabled respecte ENABLE_OCR", (t) => {
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });

  process.env.ENABLE_OCR = "false";
  assert.equal(__test__.isOcrEnabled(), false);

  process.env.ENABLE_OCR = "true";
  assert.equal(__test__.isOcrEnabled(), true);
});

test("extractTextWithOcr bascule vers Textract si tesseract est manquant", async (t) => {
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });

  process.env.ENABLE_OCR = "true";
  process.env.AWS_TEXTRACT_ENABLED = "true";
  process.env.AWS_TEXTRACT_REGION = "eu-west-1";

  let textractCalled = 0;
  const result = await extractTextWithOcr("dummy.pdf", {
    runTesseract: async () => {
      throw new Error("OCR indisponible (tesseract manquant)");
    },
    runTextract: async () => {
      textractCalled += 1;
      return "cloud text";
    },
  });

  assert.equal(result.provider, "AWS_TEXTRACT");
  assert.equal(result.text, "cloud text");
  assert.equal(textractCalled, 1);
});

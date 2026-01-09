require("ts-node/register");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { __test__ } = require("../src/services/ocrService");

test("resolveProvider privilégie Textract quand configuré", (t) => {
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });

  process.env.AWS_TEXTRACT_ENABLED = "true";
  process.env.AWS_TEXTRACT_REGION = "eu-west-1";

  assert.equal(__test__.resolveProvider(), "AWS_TEXTRACT");

  process.env.AWS_TEXTRACT_ENABLED = "false";
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

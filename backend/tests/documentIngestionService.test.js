const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const AdmZip = require("adm-zip");
const { test } = require("node:test");
const { __test__ } = require("../src/services/documentIngestionService.ts");

async function zipFixtureDirectory(root, archivePath) {
  const zip = new AdmZip();
  zip.addLocalFolder(root);
  zip.writeZip(archivePath);
}

async function createDocxFixture(text) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "docx-fixture-"));
  const docxPath = path.join(root, "sample.docx");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  await fs.promises.writeFile(path.join(root, "[Content_Types].xml"), contentTypes);

  await fs.promises.mkdir(path.join(root, "_rels"), { recursive: true });
  await fs.promises.writeFile(
    path.join(root, "_rels/.rels"),
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" />
    </Relationships>`
  );

  await fs.promises.mkdir(path.join(root, "word/_rels"), { recursive: true });
  await fs.promises.writeFile(path.join(root, "word/_rels/document.xml.rels"), "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>");

  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  await fs.promises.mkdir(path.join(root, "word"), { recursive: true });
  await fs.promises.writeFile(path.join(root, "word/document.xml"), documentXml);

  await zipFixtureDirectory(root, docxPath);

  return {
    path: docxPath,
    cleanup: () => fs.promises.rm(root, { recursive: true, force: true }),
  };
}

async function createPptxFixture(text) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pptx-fixture-"));
  const pptxPath = path.join(root, "sample.pptx");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`;

  await fs.promises.writeFile(path.join(root, "[Content_Types].xml"), contentTypes);

  await fs.promises.mkdir(path.join(root, "_rels"), { recursive: true });
  await fs.promises.writeFile(
    path.join(root, "_rels/.rels"),
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml" />
    </Relationships>`
  );

  await fs.promises.mkdir(path.join(root, "ppt/_rels"), { recursive: true });
  await fs.promises.writeFile(
    path.join(root, "ppt/_rels/presentation.xml.rels"),
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml" />
    </Relationships>`
  );

  await fs.promises.mkdir(path.join(root, "ppt/slides"), { recursive: true });
  const slideXml = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r><a:t>${text}</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
  await fs.promises.writeFile(path.join(root, "ppt/slides/slide1.xml"), slideXml);

  await zipFixtureDirectory(root, pptxPath);

  return {
    path: pptxPath,
    cleanup: () => fs.promises.rm(root, { recursive: true, force: true }),
  };
}

test("extracts text from PDF using pdf-parse", async () => {
  const pdfPath = path.join(__dirname, "..", "test.pdf");
  const text = await __test__.extractTextFromPdf(pdfPath);
  assert.ok(text.length > 0, "Expected some text to be extracted from the PDF");
});

test("extracts text from generated DOCX", async () => {
  const fixture = await createDocxFixture("Hello DOCX world");
  try {
    const text = await __test__.extractTextFromDocx(fixture.path);
    assert.match(text, /Hello DOCX world/);
  } finally {
    await fixture.cleanup();
  }
});

test("extracts text from generated PPTX", async () => {
  const fixture = await createPptxFixture("Hello PPTX slide");
  try {
    const text = await __test__.extractTextFromPptx(fixture.path);
    assert.match(text, /Hello PPTX slide/);
  } finally {
    await fixture.cleanup();
  }
});

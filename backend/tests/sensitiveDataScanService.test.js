require("ts-node/register");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { __test__ } = require("../src/services/sensitiveDataScanService");

test("scanSensitiveText détecte IBAN, carte bancaire et PII", () => {
  const text = [
    "IBAN FR7612345987650123456789014",
    "Carte 4111 1111 1111 1111",
    "Email jean.dupont@example.com",
    "Téléphone +33 6 12 34 56 78",
    "Adresse 10 Rue de la Paix",
    "Né le 01/02/1990",
  ].join("\n");

  const findings = __test__.scanSensitiveText(text);
  const types = findings.map((finding) => finding.type);

  assert.ok(types.includes("IBAN"));
  assert.ok(types.includes("CREDIT_CARD"));
  assert.ok(types.includes("EMAIL"));
  assert.ok(types.includes("PHONE"));
  assert.ok(types.includes("ADDRESS"));
  assert.ok(types.includes("BIRTH_DATE"));
});

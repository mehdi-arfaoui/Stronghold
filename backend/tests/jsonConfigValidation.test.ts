import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCriticalJsonConfig,
  validateFrameworkDefinition,
  validatePricingCatalog,
} from "../src/config/jsonConfigValidation.ts";

test("validateCriticalJsonConfig validates compliance and pricing JSON files", () => {
  const summary = validateCriticalJsonConfig();

  assert.deepEqual(summary.frameworks, ["iso22301", "nis2"]);
  assert.deepEqual(summary.pricingProviders, ["aws", "azure", "gcp"]);
});

test("validateFrameworkDefinition rejects frameworks without requirements", () => {
  assert.throws(
    () => validateFrameworkDefinition({ id: "iso22301" }, "iso22301.json"),
    /missing non-empty requirements array/,
  );
});

test("validatePricingCatalog rejects catalogs without regions", () => {
  assert.throws(
    () => validatePricingCatalog({ _meta: {} }, "aws-prices.json"),
    /missing non-empty regions object/,
  );
});

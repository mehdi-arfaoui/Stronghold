const assert = require("node:assert/strict");
const { test } = require("node:test");
const { omitUndefined } = require("../src/utils/objectUtils.ts");
const { isJsonValue, toPrismaJson } = require("../src/utils/prismaJson.ts");

test("omitUndefined removes undefined keys and preserves null", () => {
  const input = { a: 1, b: undefined, c: null, d: "ok" };
  const result = omitUndefined(input);
  assert.deepEqual(result, { a: 1, c: null, d: "ok" });
});

test("isJsonValue validates JSON-safe values", () => {
  assert.equal(isJsonValue({ a: 1, b: [true, "ok"], c: "value" }), true);
  assert.equal(isJsonValue(null), true);
  assert.equal(isJsonValue(undefined), false);
  assert.equal(isJsonValue({ a: undefined }), false);
  assert.equal(isJsonValue(new Date()), false);
});

test("toPrismaJson coerces dates and rejects unserializable values", () => {
  const date = new Date("2024-01-01T00:00:00.000Z");
  assert.equal(toPrismaJson(date), "2024-01-01T00:00:00.000Z");
  assert.equal(toPrismaJson(null), null);
  assert.throws(() => toPrismaJson({ value: BigInt(10) }), /Invalid JSON value/);
});

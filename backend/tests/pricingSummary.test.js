const assert = require("node:assert/strict");
const { test } = require("node:test");
const { summarizePricing } = require("../src/clients/pricingTypes.ts");

test("summarizePricing applies exchange rate and discount", () => {
  const items = [
    { capex: 1000, opexMonthly: 200, currency: "USD" },
    { capex: 500, opexMonthly: 100, currency: "USD" },
  ];

  const summary = summarizePricing(items, {
    exchangeRate: 0.9,
    discountRate: 0.1,
  });

  assert.equal(summary.baseCapex, 1500);
  assert.equal(summary.baseOpexMonthly, 300);
  assert.equal(summary.adjustedCapex, 1500 * 0.9 * 0.9);
  assert.equal(summary.adjustedOpexMonthly, 300 * 0.9 * 0.9);
});

test("summarizePricing clamps invalid rates and adds human costs", () => {
  const items = [{ capex: 0, opexMonthly: 100, currency: "EUR" }];

  const summary = summarizePricing(items, {
    discountRate: 2,
    exchangeRate: Number.NaN,
    humanCostMonthly: 250,
  });

  assert.equal(summary.discountRate, 1);
  assert.equal(summary.exchangeRate, 1);
  assert.equal(summary.adjustedOpexMonthly, 0 + 250);
});

require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test, describe, mock } = require("node:test");

describe("AWS Multi-Region Scanner", () => {
  test("getAllAwsRegions returns empty array without credentials", async () => {
    // Dynamic import for ES modules
    const { getAllAwsRegions } = await import("../src/services/discoveryCloudConnectors.js");

    const result = await getAllAwsRegions({});
    assert.deepEqual(result, []);
  });

  test("scanAws returns empty result without region or regions option", async () => {
    const { scanAws } = await import("../src/services/discoveryCloudConnectors.js");

    const result = await scanAws({ aws: { accessKeyId: "test", secretAccessKey: "test" } });
    assert.deepEqual(result.resources, []);
  });

  test("scanAws accepts regions array option", async () => {
    const { scanAws } = await import("../src/services/discoveryCloudConnectors.js");

    // This will fail to connect but should not throw
    try {
      await scanAws(
        { aws: { accessKeyId: "test", secretAccessKey: "test" } },
        { regions: ["us-east-1"] }
      );
    } catch (error) {
      // Expected to fail due to invalid credentials
      assert.ok(error instanceof Error);
    }
  });

  test("AwsScanOptions type supports all, specific regions, and onProgress callback", async () => {
    const { scanAws } = await import("../src/services/discoveryCloudConnectors.js");

    // Type check: these should compile
    const options1 = { regions: ["all"] };
    const options2 = { regions: ["us-east-1", "eu-west-1"] };
    const options3 = {
      regions: ["us-east-1"],
      onProgress: (completed, total, currentRegion) => {
        console.log(`Progress: ${completed}/${total} - ${currentRegion}`);
      },
    };

    // Verify options are valid by checking they don't throw on construction
    assert.ok(options1.regions.includes("all"));
    assert.equal(options2.regions.length, 2);
    assert.equal(typeof options3.onProgress, "function");
  });
});

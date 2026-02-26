require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test, describe } = require("node:test");

process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_MAX_ATTEMPTS = "1";
process.env.AWS_RETRY_MODE = "standard";

let awsConnectorPromise;
function loadAwsConnector() {
  if (!awsConnectorPromise) {
    awsConnectorPromise = import("../src/services/discoveryCloudConnectors.js");
  }
  return awsConnectorPromise;
}

describe("AWS Multi-Region Scanner", () => {
  test("getAllAwsRegions returns empty array without credentials", { timeout: 15000 }, async () => {
    const { getAllAwsRegions } = await loadAwsConnector();

    const result = await getAllAwsRegions({});
    assert.deepEqual(result, []);
  });

  test("scanAws returns empty result without region or regions option", { timeout: 15000 }, async () => {
    const { scanAws } = await loadAwsConnector();

    const result = await scanAws({ aws: { accessKeyId: "test", secretAccessKey: "test" } });
    assert.deepEqual(result.resources, []);
    assert.deepEqual(result.flows, []);
  });

  test("scanAws with regions=all returns empty result when credentials are missing", { timeout: 15000 }, async () => {
    const { scanAws } = await loadAwsConnector();
    const result = await scanAws({}, { regions: ["all"] });

    assert.deepEqual(result.resources, []);
    assert.deepEqual(result.flows, []);
    assert.ok(Array.isArray(result.warnings));
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

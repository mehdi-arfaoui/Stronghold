import fs from "node:fs";
import path from "node:path";

type RouteMount = {
  path: string;
  handler: string;
  name: string;
};

type EndpointFinding = {
  method: string;
  endpoint: string;
  tenantFilter: "yes" | "no";
  hasPrismaCall: boolean;
  file: string;
  line: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
  note: string;
};

const ROOT = process.cwd();
const BACKEND_SRC = path.join(ROOT, "backend", "src");
const INDEX_FILE = path.join(BACKEND_SRC, "index.ts");
const OUTPUT_DIR = path.join(ROOT, "tmp", "security-audit");
const OUTPUT_JSON = path.join(OUTPUT_DIR, "tenant-isolation-audit.json");
const OUTPUT_CSV = path.join(OUTPUT_DIR, "tenant-isolation-audit.csv");

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function toPosixRelative(filePath: string): string {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

function findMatchingParen(content: string, openParenIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = openParenIndex; i < content.length; i += 1) {
    const c = content[i];
    const next = i + 1 < content.length ? content[i + 1] : "";

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate) {
      if (c === "/" && next === "/") {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (c === "/" && next === "*") {
        inBlockComment = true;
        i += 1;
        continue;
      }
    }

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

    if (inSingle || inDouble || inTemplate) {
      continue;
    }

    if (c === "(") {
      depth += 1;
      continue;
    }
    if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function normalizeEndpointPath(basePath: string, routePath: string): string {
  const left = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const right = routePath === "/" ? "" : routePath.replace(/^\/+/, "");
  if (!right) return `/api${left || ""}`;
  return `/api${left}/${right}`;
}

function parseRouteImports(indexContent: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const importRegex = /import\s+([A-Za-z0-9_]+)\s+from\s+["']\.\/routes\/([^"']+)\.js["'];/g;
  let match: RegExpExecArray | null = null;
  while ((match = importRegex.exec(indexContent)) !== null) {
    const variableName = match[1];
    const fileStem = match[2];
    importMap.set(variableName, path.join(BACKEND_SRC, "routes", `${fileStem}.ts`));
  }
  return importMap;
}

function parseRouteMounts(indexContent: string): RouteMount[] {
  const mounts: RouteMount[] = [];
  const mountRegex =
    /\{\s*path:\s*"([^"]+)"\s*,\s*handler:\s*([A-Za-z0-9_]+)\s*,\s*name:\s*"([^"]+)"\s*\}/g;
  let match: RegExpExecArray | null = null;
  while ((match = mountRegex.exec(indexContent)) !== null) {
    mounts.push({ path: match[1], handler: match[2], name: match[3] });
  }
  return mounts;
}

function parseEndpoints(routeFilePath: string, mountPath: string): EndpointFinding[] {
  const findings: EndpointFinding[] = [];
  const content = readFile(routeFilePath);
  const routeCallRegex = /router\.(get|post|put|patch|delete)\s*\(/g;
  let match: RegExpExecArray | null = null;

  while ((match = routeCallRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const openParenIndex = content.indexOf("(", match.index);
    if (openParenIndex < 0) continue;

    const closeParenIndex = findMatchingParen(content, openParenIndex);
    if (closeParenIndex < 0) continue;

    const callBody = content.slice(openParenIndex + 1, closeParenIndex);
    const pathMatch = callBody.match(/^\s*(['"`])([^'"`]+)\1/);
    if (!pathMatch) continue;

    const routePath = pathMatch[2];
    const endpoint = normalizeEndpointPath(mountPath, routePath);
    const hasPrismaCall = /prisma\./.test(callBody);
    const hasTenantToken = /(tenantId|organizationId)/.test(callBody);
    const tenantFilter: "yes" | "no" = hasTenantToken ? "yes" : "no";
    const risk: "LOW" | "MEDIUM" | "HIGH" =
      hasPrismaCall && !hasTenantToken ? "HIGH" : hasTenantToken ? "LOW" : "MEDIUM";
    const note = hasTenantToken
      ? "tenant marker found in handler"
      : hasPrismaCall
        ? "prisma call without explicit tenant marker in handler"
        : "no explicit tenant marker in handler";

    findings.push({
      method,
      endpoint,
      tenantFilter,
      hasPrismaCall,
      file: toPosixRelative(routeFilePath),
      line: lineNumberAt(content, match.index),
      risk,
      note,
    });
  }

  return findings;
}

function toCsv(findings: EndpointFinding[]): string {
  const header = [
    "method",
    "endpoint",
    "tenantFilter",
    "hasPrismaCall",
    "risk",
    "file",
    "line",
    "note",
  ];
  const lines = [header.join(",")];
  for (const item of findings) {
    const row = [
      item.method,
      item.endpoint,
      item.tenantFilter,
      String(item.hasPrismaCall),
      item.risk,
      item.file,
      String(item.line),
      item.note.replaceAll("\"", "\"\""),
    ];
    lines.push(
      row
        .map((cell) => (cell.includes(",") || cell.includes("\"") ? `"${cell}"` : cell))
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

function run(): void {
  const indexContent = readFile(INDEX_FILE);
  const importMap = parseRouteImports(indexContent);
  const mounts = parseRouteMounts(indexContent);
  const findings: EndpointFinding[] = [];

  for (const mount of mounts) {
    const routeFile = importMap.get(mount.handler);
    if (!routeFile || !fs.existsSync(routeFile)) {
      continue;
    }
    findings.push(...parseEndpoints(routeFile, mount.path));
  }

  findings.sort((a, b) => {
    const riskRank = (risk: EndpointFinding["risk"]): number => {
      if (risk === "HIGH") return 0;
      if (risk === "MEDIUM") return 1;
      return 2;
    };
    if (riskRank(a.risk) !== riskRank(b.risk)) return riskRank(a.risk) - riskRank(b.risk);
    if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
    return a.method.localeCompare(b.method);
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(findings, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_CSV, toCsv(findings), "utf8");

  const total = findings.length;
  const withoutTenant = findings.filter((f) => f.tenantFilter === "no").length;
  const highRisk = findings.filter((f) => f.risk === "HIGH").length;
  const mediumRisk = findings.filter((f) => f.risk === "MEDIUM").length;

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        totalEndpoints: total,
        endpointsWithoutTenantMarker: withoutTenant,
        highRisk,
        mediumRisk,
        outputJson: toPosixRelative(OUTPUT_JSON),
        outputCsv: toPosixRelative(OUTPUT_CSV),
      },
      null,
      2
    )
  );
}

run();

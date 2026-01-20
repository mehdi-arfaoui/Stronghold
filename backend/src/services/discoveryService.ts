import crypto from "crypto";
import { z, ZodError } from "zod";
import prisma from "../prismaClient.js";
import { decryptJsonSecret, encryptJsonSecret, isSecretVaultEnabled } from "./secretVaultService.js";

type DiscoveryNodeKind = "service" | "infra";

type DiscoveryNode = {
  externalId: string;
  name: string;
  kind: DiscoveryNodeKind;
  type: string;
  criticality?: string | null;
  provider?: string | null;
  location?: string | null;
  ip?: string | null;
  hostname?: string | null;
  description?: string | null;
};

type DiscoveryEdge = {
  source: string;
  target: string;
  dependencyType?: string | null;
};

type DiscoveryImportPayload = {
  nodes: DiscoveryNode[];
  edges: DiscoveryEdge[];
};

type DiscoveryImportSummary = {
  createdServices: number;
  createdInfra: number;
  createdDependencies: number;
  createdInfraLinks: number;
  ignoredEdges: number;
};

type DiscoveryImportRejectedRow = {
  line: number;
  recordType: "node" | "edge" | "unknown";
  reasons: string[];
};

type DiscoveryImportReport = {
  rejectedRows: number;
  rejectedEntries: DiscoveryImportRejectedRow[];
};

type DiscoveryImportResult = {
  payload: DiscoveryImportPayload;
  report: DiscoveryImportReport;
};

export type DiscoverySuggestion = {
  externalId: string;
  name: string;
  kind: DiscoveryNodeKind;
  type: string;
  match: {
    id: string;
    name: string;
    score: number;
    rtoHours: number | null;
    rpoMinutes: number | null;
    mtpdHours: number | null;
  } | null;
};

export type DiscoverySuggestionSummary = {
  totalNodes: number;
  serviceNodes: number;
  infraNodes: number;
  edges: number;
};

export type DiscoverySuggestionResponse = {
  summary: DiscoverySuggestionSummary;
  suggestions: DiscoverySuggestion[];
};

type DiscoveryImportErrorDetail = {
  field: string;
  message: string;
};

export class DiscoveryImportError extends Error {
  details: DiscoveryImportErrorDetail[];

  constructor(message: string, details: DiscoveryImportErrorDetail[]) {
    super(message);
    this.name = "DiscoveryImportError";
    this.details = details;
  }
}

export class DiscoveryGitHubImportError extends Error {
  details: DiscoveryImportErrorDetail[];

  constructor(message: string, details: DiscoveryImportErrorDetail[]) {
    super(message);
    this.name = "DiscoveryGitHubImportError";
    this.details = details;
  }
}

type DiscoveryGitHubSource = {
  repoUrl?: string;
  filePath?: string;
  ref?: string;
  rawUrl?: string;
};

type ExternalImportRecord = Record<string, any>;

const MAX_GITHUB_IMPORT_BYTES = 5 * 1024 * 1024;

const expectedCsvHeaders = [
  "record_type",
  "id",
  "name",
  "type",
  "source",
  "target",
  "dependency_type",
];

const discoveryNodeSchema = z
  .object({
    externalId: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["service", "infra"]),
    type: z.string().min(1),
    criticality: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    ip: z.string().nullable().optional(),
    hostname: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict();

const discoveryEdgeSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    dependencyType: z.string().nullable().optional(),
  })
  .strict();

const discoveryImportSchema = z
  .object({
    nodes: z.array(discoveryNodeSchema),
    edges: z.array(discoveryEdgeSchema),
  })
  .strict();

const discoveryJsonNodeSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    kind: z.enum(["service", "infra"]).optional(),
    nodeKind: z.string().optional(),
    criticality: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    ip: z.string().nullable().optional(),
    hostname: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    payload: z
      .object({
        externalId: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        kind: z.enum(["service", "infra"]).optional(),
        nodeKind: z.string().optional(),
        criticality: z.string().nullable().optional(),
        provider: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        ip: z.string().nullable().optional(),
        hostname: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        tags: z.any().optional(),
        metadata: z.any().optional(),
      })
      .optional(),
  })
  .passthrough();

const discoveryJsonEdgeSchema = z
  .object({
    source: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    dependency_type: z.string().nullable().optional(),
    dependencyType: z.string().nullable().optional(),
    payload: z
      .object({
        source: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
        dependency_type: z.string().nullable().optional(),
        dependencyType: z.string().nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

function formatZodError(error: ZodError, prefix = ""): DiscoveryImportErrorDetail[] {
  return error.issues.map((issue) => ({
    field: `${prefix}${issue.path.join(".") || "payload"}`,
    message: issue.message,
  }));
}

function ensurePayloadSchema(payload: DiscoveryImportPayload) {
  const result = discoveryImportSchema.safeParse(payload);
  if (!result.success) {
    throw new DiscoveryImportError("Schéma import invalide", formatZodError(result.error));
  }
}

function normalizeCriticality(value?: string | null) {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized.includes("crit")) return "critical";
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium")) return "medium";
  if (normalized.includes("low")) return "low";
  return "medium";
}

function classifyNodeKind(value?: string | null): DiscoveryNodeKind {
  const normalized = (value || "").toLowerCase();
  if (
    normalized.includes("infra") ||
    normalized.includes("vm") ||
    normalized.includes("host") ||
    normalized.includes("server") ||
    normalized.includes("database") ||
    normalized.includes("db") ||
    normalized.includes("container") ||
    normalized.includes("network")
  ) {
    return "infra";
  }
  if (normalized.includes("service") || normalized.includes("app")) {
    return "service";
  }
  return "service";
}

function normalizeNodeType(value?: string | null, kind?: DiscoveryNodeKind) {
  const trimmed = (value || "").trim();
  if (trimmed) return trimmed;
  return kind === "infra" ? "HOST" : "APP";
}

function buildDiscoveryDescription(node: DiscoveryNode) {
  const parts: string[] = [];
  if (node.description) parts.push(node.description);
  if (node.ip) parts.push(`IP: ${node.ip}`);
  if (node.hostname) parts.push(`Hostname: ${node.hostname}`);
  return parts.length > 0 ? parts.join(" | ") : null;
}

function normalizeExternalId(input: string | null | undefined, fallback: string) {
  const trimmed = (input || "").trim();
  return trimmed || fallback;
}

function readStringField(record: ExternalImportRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function mapExternalRecords(records: ExternalImportRecord[], source: string): DiscoveryNode[] {
  return records
    .map((record, index) => {
      if (!record || typeof record !== "object") return null;
      const externalId =
        readStringField(record, ["id", "assetId", "deviceId", "sys_id", "resourceId"]) ||
        `${source}-${index + 1}`;
      const name =
        readStringField(record, ["name", "hostname", "hostName", "fqdn", "assetName"]) ||
        readStringField(record, ["ip", "ipAddress", "ip_address", "primary_ip"]) ||
        externalId;
      const rawType =
        readStringField(record, ["type", "assetType", "deviceType", "class", "ci_type"]) ||
        "HOST";
      const kind = classifyNodeKind(rawType);
      const ip = readStringField(record, ["ip", "ipAddress", "ip_address", "primary_ip"]);
      const hostname = readStringField(record, ["hostname", "hostName", "fqdn"]);
      const description =
        readStringField(record, ["description", "os", "operatingSystem", "model", "manufacturer"]);

      return {
        externalId,
        name,
        kind,
        type: normalizeNodeType(rawType, kind),
        criticality: normalizeCriticality(readStringField(record, ["criticality", "criticity"])),
        provider: readStringField(record, ["provider", "cloud", "vendor"]),
        location: readStringField(record, ["location", "site", "datacenter"]),
        ip,
        hostname,
        description,
      } satisfies DiscoveryNode;
    })
    .filter(Boolean) as DiscoveryNode[];
}

function mapExternalEdges(records: ExternalImportRecord[]): DiscoveryEdge[] {
  return records
    .map((record) => {
      if (!record || typeof record !== "object") return null;
      const source = readStringField(record, ["source", "from", "parent", "from_id"]);
      const target = readStringField(record, ["target", "to", "child", "to_id"]);
      if (!source || !target) return null;
      return {
        source,
        target,
        dependencyType: readStringField(record, ["dependencyType", "dependency_type", "relation"]),
      } satisfies DiscoveryEdge;
    })
    .filter(Boolean) as DiscoveryEdge[];
}

function parseExternalImportPayload(parsed: Record<string, any>): DiscoveryImportResult | null {
  const source = (parsed.source || parsed.tool || parsed.vendor || "external").toString();
  const records =
    parsed.assets ||
    parsed.devices ||
    parsed.items ||
    parsed.records ||
    parsed.result ||
    parsed.resources;

  if (!Array.isArray(records)) return null;

  const nodes = mapExternalRecords(records, source);
  const edgeRecords = Array.isArray(parsed.edges || parsed.dependencies || parsed.relations)
    ? parsed.edges || parsed.dependencies || parsed.relations
    : [];
  const edges = mapExternalEdges(edgeRecords);

  const payload = { nodes, edges };
  ensurePayloadSchema(payload);

  return { payload, report: { rejectedRows: 0, rejectedEntries: [] } };
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenizeName(value: string) {
  return new Set(normalizeName(value).split(" ").filter(Boolean));
}

function scoreSimilarity(source: string, target: string) {
  const sourceTokens = tokenizeName(source);
  const targetTokens = tokenizeName(target);
  if (sourceTokens.size === 0 || targetTokens.size === 0) return 0;

  let matches = 0;
  sourceTokens.forEach((token) => {
    if (targetTokens.has(token)) {
      matches += 1;
    }
  });
  const unionSize = new Set([...sourceTokens, ...targetTokens]).size;
  const overlapScore = unionSize === 0 ? 0 : matches / unionSize;
  const directMatch =
    normalizeName(source) === normalizeName(target) ||
    normalizeName(source).includes(normalizeName(target)) ||
    normalizeName(target).includes(normalizeName(source));
  return directMatch ? Math.max(overlapScore, 0.95) : overlapScore;
}

function toLowerHeader(value: string) {
  return value.trim().toLowerCase();
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    current.push(field);
    field = "";
  };

  const pushRow = () => {
    pushField();
    rows.push(current);
    current = [];
  };

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '"') {
      const next = content[i + 1];
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === ",") {
      pushField();
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && content[i + 1] === "\n") {
        i += 1;
      }
      if (field.length > 0 || current.length > 0) {
        pushRow();
      } else {
        field = "";
      }
      continue;
    }
    field += char;
  }
  if (field.length > 0 || current.length > 0) {
    pushRow();
  }
  return rows;
}

function parseCsvPayload(content: string): DiscoveryImportResult {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return {
      payload: { nodes: [], edges: [] },
      report: { rejectedRows: 0, rejectedEntries: [] },
    };
  }
  const headers = rows[0].map(toLowerHeader);
  const missingHeaders = expectedCsvHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new DiscoveryImportError("Header CSV invalide", [
      {
        field: "csv_headers",
        message: `Colonnes manquantes: ${missingHeaders.join(", ")}`,
      },
    ]);
  }
  const nodes: DiscoveryNode[] = [];
  const edges: DiscoveryEdge[] = [];
  const rejectedEntries: DiscoveryImportRejectedRow[] = [];

  for (const [index, row] of rows.slice(1).entries()) {
    const lineNumber = index + 2;
    const record: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      record[header] = (row[headerIndex] || "").trim();
    });
    const recordType = (record["record_type"] || "").toLowerCase();

    if (recordType === "edge") {
      const source = normalizeExternalId(record["source"], "");
      const target = normalizeExternalId(record["target"], "");
      const reasons: string[] = [];
      if (!source) reasons.push("source manquant");
      if (!target) reasons.push("target manquant");
      if (reasons.length > 0) {
        rejectedEntries.push({ line: lineNumber, recordType: "edge", reasons });
        continue;
      }
      edges.push({
        source,
        target,
        dependencyType: record["dependency_type"] || null,
      });
      continue;
    }

    if (recordType === "node") {
      const externalId = normalizeExternalId(record["id"], "");
      const name = record["name"];
      const rawKind = record["type"];
      const reasons: string[] = [];
      if (!externalId) reasons.push("id manquant");
      if (!name) reasons.push("name manquant");
      if (!rawKind) reasons.push("type manquant");
      if (reasons.length > 0) {
        rejectedEntries.push({ line: lineNumber, recordType: "node", reasons });
        continue;
      }
      const kind = classifyNodeKind(rawKind);
      const node: DiscoveryNode = {
        externalId,
        name,
        kind,
        type: normalizeNodeType(rawKind, kind),
        criticality: normalizeCriticality(record["criticality"]),
        provider: record["provider"] || null,
        location: record["location"] || null,
        ip: record["ip"] || null,
        hostname: record["hostname"] || null,
        description: record["description"] || null,
      };
      nodes.push(node);
      continue;
    }

    rejectedEntries.push({
      line: lineNumber,
      recordType: "unknown",
      reasons: ["record_type invalide (attendu node ou edge)"],
    });
  }

  const payload = { nodes, edges };
  ensurePayloadSchema(payload);

  return {
    payload,
    report: { rejectedRows: rejectedEntries.length, rejectedEntries },
  };
}

function parseJsonPayload(content: string): DiscoveryImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON invalide";
    throw new DiscoveryImportError("JSON invalide", [{ field: "payload", message }]);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new DiscoveryImportError("Schéma import invalide", [
      { field: "payload", message: "Objet JSON attendu" },
    ]);
  }

  const externalPayload = parseExternalImportPayload(parsed as Record<string, any>);
  if (externalPayload) {
    return externalPayload;
  }

  const rawNodes = Array.isArray((parsed as any).nodes) ? (parsed as any).nodes : null;
  const rawEdges = Array.isArray((parsed as any).edges) ? (parsed as any).edges : null;
  if (!rawNodes || !rawEdges) {
    throw new DiscoveryImportError("Schéma import invalide", [
      { field: "payload", message: "nodes et edges doivent être des tableaux" },
    ]);
  }

  const issues: DiscoveryImportErrorDetail[] = [];
  const nodes: DiscoveryNode[] = rawNodes
    .map((node: any, index: number) => {
      const result = discoveryJsonNodeSchema.safeParse(node);
      if (!result.success) {
        issues.push(...formatZodError(result.error, `nodes.${index}.`));
        return null;
      }
      const payload = result.data.payload;
      const rawKind =
        result.data.kind ||
        payload?.kind ||
        result.data.nodeKind ||
        payload?.nodeKind ||
        result.data.type ||
        payload?.type;
      const kind = classifyNodeKind(rawKind);
      const name =
        result.data.name || payload?.name || result.data.label || payload?.label || payload?.externalId;
      const externalId =
        result.data.id ||
        payload?.externalId ||
        payload?.id ||
        name ||
        `import-node-${index + 1}`;
      const rawType = result.data.type || payload?.type || rawKind || "HOST";

      if (!name) {
        issues.push({
          field: `nodes.${index}.name`,
          message: "name manquant",
        });
        return null;
      }
      return {
        externalId,
        name,
        kind,
        type: normalizeNodeType(rawType, kind),
        criticality: normalizeCriticality(result.data.criticality ?? payload?.criticality),
        provider: result.data.provider ?? payload?.provider ?? null,
        location: result.data.location ?? payload?.location ?? null,
        ip: result.data.ip ?? payload?.ip ?? null,
        hostname: result.data.hostname ?? payload?.hostname ?? null,
        description: result.data.description ?? payload?.description ?? null,
      } as DiscoveryNode;
    })
    .filter(Boolean) as DiscoveryNode[];

  const edges: DiscoveryEdge[] = rawEdges
    .map((edge: any, index: number) => {
      const result = discoveryJsonEdgeSchema.safeParse(edge);
      if (!result.success) {
        issues.push(...formatZodError(result.error, `edges.${index}.`));
        return null;
      }
      const payload = result.data.payload;
      const source =
        result.data.source || payload?.source || result.data.from || payload?.from || null;
      const target =
        result.data.target || payload?.target || result.data.to || payload?.to || null;
      if (!source || !target) {
        issues.push({
          field: `edges.${index}`,
          message: "source ou target manquant",
        });
        return null;
      }
      return {
        source,
        target,
        dependencyType:
          result.data.dependency_type ||
          result.data.dependencyType ||
          payload?.dependency_type ||
          payload?.dependencyType ||
          null,
      } as DiscoveryEdge;
    })
    .filter(Boolean) as DiscoveryEdge[];

  if (issues.length > 0) {
    throw new DiscoveryImportError("Schéma import invalide", issues);
  }

  const payload = { nodes, edges };
  ensurePayloadSchema(payload);

  return { payload, report: { rejectedRows: 0, rejectedEntries: [] } };
}

function sanitizeGitHubFilePath(filePath: string) {
  return filePath.replace(/^\/+/, "").trim();
}

function buildRawGitHubUrlFromRepo(source: DiscoveryGitHubSource) {
  const repoUrl = source.repoUrl;
  const filePath = source.filePath;
  if (!repoUrl || !filePath) {
    throw new DiscoveryGitHubImportError("Paramètres GitHub incomplets", [
      { field: "repoUrl", message: "repoUrl et filePath sont requis" },
    ]);
  }
  const url = new URL(repoUrl);
  if (url.hostname !== "github.com") {
    throw new DiscoveryGitHubImportError("Hôte GitHub invalide", [
      { field: "repoUrl", message: "URL github.com requise" },
    ]);
  }
  const segments = url.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
  const owner = segments[0];
  const repo = segments[1];
  if (!owner || !repo) {
    throw new DiscoveryGitHubImportError("URL GitHub invalide", [
      { field: "repoUrl", message: "Organisation et dépôt requis" },
    ]);
  }
  const ref = (source.ref || "main").trim() || "main";
  const normalizedPath = sanitizeGitHubFilePath(filePath);
  if (!normalizedPath) {
    throw new DiscoveryGitHubImportError("Chemin de fichier invalide", [
      { field: "filePath", message: "filePath est requis" },
    ]);
  }
  return {
    rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${normalizedPath}`,
    filename: normalizedPath.split("/").pop() || "discovery.json",
  };
}

function buildRawGitHubUrlFromRaw(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.hostname === "raw.githubusercontent.com") {
    return { rawUrl, filename: url.pathname.split("/").pop() || "discovery.json" };
  }
  if (url.hostname !== "github.com") {
    throw new DiscoveryGitHubImportError("URL GitHub invalide", [
      { field: "rawUrl", message: "URL github.com ou raw.githubusercontent.com requise" },
    ]);
  }
  const segments = url.pathname.replace(/^\/+/, "").split("/");
  const blobIndex = segments.indexOf("blob");
  const rawIndex = segments.indexOf("raw");
  if (blobIndex > 1 || rawIndex > 1) {
    const index = blobIndex > -1 ? blobIndex : rawIndex;
    const owner = segments[0];
    const repo = segments[1];
    const ref = segments[index + 1];
    const path = segments.slice(index + 2).join("/");
    if (!owner || !repo || !ref || !path) {
      throw new DiscoveryGitHubImportError("URL GitHub invalide", [
        { field: "rawUrl", message: "Lien blob/raw GitHub incomplet" },
      ]);
    }
    return {
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
      filename: path.split("/").pop() || "discovery.json",
    };
  }
  throw new DiscoveryGitHubImportError("URL GitHub invalide", [
    { field: "rawUrl", message: "Utilisez un lien raw ou blob GitHub" },
  ]);
}

export async function fetchDiscoveryImportFromGitHub(source: DiscoveryGitHubSource) {
  const { rawUrl, filename } = source.rawUrl
    ? buildRawGitHubUrlFromRaw(source.rawUrl)
    : buildRawGitHubUrlFromRepo(source);

  let response: Response;
  try {
    response = await fetch(rawUrl, { headers: { "User-Agent": "Stronghold-Discovery" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur réseau";
    throw new DiscoveryGitHubImportError("Impossible de joindre GitHub", [
      { field: "rawUrl", message },
    ]);
  }

  if (!response.ok) {
    throw new DiscoveryGitHubImportError("Téléchargement GitHub échoué", [
      { field: "rawUrl", message: `HTTP ${response.status}` },
    ]);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_GITHUB_IMPORT_BYTES) {
    throw new DiscoveryGitHubImportError("Fichier GitHub trop volumineux", [
      { field: "rawUrl", message: "Limite 5 Mo" },
    ]);
  }

  const text = await response.text();
  if (text.length > MAX_GITHUB_IMPORT_BYTES) {
    throw new DiscoveryGitHubImportError("Fichier GitHub trop volumineux", [
      { field: "rawUrl", message: "Limite 5 Mo" },
    ]);
  }

  return { buffer: Buffer.from(text), filename };
}

export function parseDiscoveryImport(
  buffer: Buffer,
  filename: string,
  mimeType?: string | null
): DiscoveryImportResult {
  const content = buffer.toString("utf-8").trim();
  const lowerName = filename.toLowerCase();
  if (mimeType?.includes("json") || lowerName.endsWith(".json")) {
    return parseJsonPayload(content);
  }
  if (mimeType?.includes("csv") || lowerName.endsWith(".csv")) {
    return parseCsvPayload(content);
  }
  if (content.startsWith("{") || content.startsWith("[")) {
    return parseJsonPayload(content);
  }
  return parseCsvPayload(content);
}

export async function buildDiscoverySuggestions(
  tenantId: string,
  payload: DiscoveryImportPayload
): Promise<DiscoverySuggestionResponse> {
  const services = await prisma.service.findMany({
    where: { tenantId },
    include: { continuity: true },
  });

  const suggestions = payload.nodes.map((node) => {
    if (node.kind !== "service") {
      return {
        externalId: node.externalId,
        name: node.name,
        kind: node.kind,
        type: node.type,
        match: null,
      };
    }

    let bestMatch: DiscoverySuggestion["match"] = null;
    for (const service of services) {
      const score = scoreSimilarity(node.name, service.name);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          id: service.id,
          name: service.name,
          score,
          rtoHours: service.continuity?.rtoHours ?? null,
          rpoMinutes: service.continuity?.rpoMinutes ?? null,
          mtpdHours: service.continuity?.mtpdHours ?? null,
        };
      }
    }

    if (bestMatch && bestMatch.score < 0.5) {
      bestMatch = null;
    }

    return {
      externalId: node.externalId,
      name: node.name,
      kind: node.kind,
      type: node.type,
      match: bestMatch,
    };
  });

  const serviceNodes = payload.nodes.filter((node) => node.kind === "service").length;
  const infraNodes = payload.nodes.filter((node) => node.kind === "infra").length;

  return {
    summary: {
      totalNodes: payload.nodes.length,
      serviceNodes,
      infraNodes,
      edges: payload.edges.length,
    },
    suggestions,
  };
}

export async function applyDiscoveryImport(
  tenantId: string,
  payload: DiscoveryImportPayload
): Promise<DiscoveryImportSummary> {
  return prisma.$transaction(async (tx) => {
    const serviceMap = new Map<string, string>();
    const infraMap = new Map<string, string>();
    let createdServices = 0;
    let createdInfra = 0;
    let createdDependencies = 0;
    let createdInfraLinks = 0;
    let ignoredEdges = 0;

    for (const node of payload.nodes) {
      const description = buildDiscoveryDescription(node);
      if (node.kind === "service") {
        const existing = await tx.service.findFirst({
          where: { tenantId, name: node.name },
        });
        if (existing) {
          serviceMap.set(node.externalId, existing.id);
          continue;
        }
        const created = await tx.service.create({
          data: {
            tenantId,
            name: node.name,
            type: node.type,
            description,
            criticality: normalizeCriticality(node.criticality),
            businessPriority: null,
            recoveryPriority: null,
            domain: null,
          },
        });
        serviceMap.set(node.externalId, created.id);
        createdServices += 1;
        continue;
      }

      const infraExisting = await tx.infraComponent.findFirst({
        where: { tenantId, name: node.name, type: node.type },
      });
      if (infraExisting) {
        infraMap.set(node.externalId, infraExisting.id);
        continue;
      }
      const infraCreated = await tx.infraComponent.create({
        data: {
          tenantId,
          name: node.name,
          type: node.type,
          provider: node.provider,
          location: node.location,
          criticality: node.criticality ? normalizeCriticality(node.criticality) : null,
          notes: description,
          isSingleAz: false,
        },
      });
      infraMap.set(node.externalId, infraCreated.id);
      createdInfra += 1;
    }

    for (const edge of payload.edges) {
      const fromServiceId = serviceMap.get(edge.source);
      const toServiceId = serviceMap.get(edge.target);
      const sourceInfraId = infraMap.get(edge.source);
      const targetInfraId = infraMap.get(edge.target);

      if (fromServiceId && toServiceId) {
        const existing = await tx.serviceDependency.findFirst({
          where: {
            tenantId,
            fromServiceId,
            toServiceId,
            dependencyType: edge.dependencyType || "dépendance",
          },
        });
        if (!existing) {
          await tx.serviceDependency.create({
            data: {
              tenantId,
              fromServiceId,
              toServiceId,
              dependencyType: edge.dependencyType || "dépendance",
            },
          });
          createdDependencies += 1;
        }
        continue;
      }

      if (fromServiceId && targetInfraId) {
        const existing = await tx.serviceInfraLink.findFirst({
          where: {
            tenantId,
            serviceId: fromServiceId,
            infraId: targetInfraId,
          },
        });
        if (!existing) {
          await tx.serviceInfraLink.create({
            data: {
              tenantId,
              serviceId: fromServiceId,
              infraId: targetInfraId,
            },
          });
          createdInfraLinks += 1;
        }
        continue;
      }

      if (toServiceId && sourceInfraId) {
        const existing = await tx.serviceInfraLink.findFirst({
          where: {
            tenantId,
            serviceId: toServiceId,
            infraId: sourceInfraId,
          },
        });
        if (!existing) {
          await tx.serviceInfraLink.create({
            data: {
              tenantId,
              serviceId: toServiceId,
              infraId: sourceInfraId,
            },
          });
          createdInfraLinks += 1;
        }
        continue;
      }

      ignoredEdges += 1;
    }

    return {
      createdServices,
      createdInfra,
      createdDependencies,
      createdInfraLinks,
      ignoredEdges,
    };
  });
}

export function encryptDiscoveryCredentials(payload: Record<string, unknown>, secret: string) {
  const vaultEncrypted = encryptJsonSecret(payload);
  if (vaultEncrypted) {
    return vaultEncrypted;
  }
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptDiscoveryCredentials(
  payload: { ciphertext: string; iv: string; tag: string },
  secret: string
): Record<string, unknown> {
  if (isSecretVaultEnabled()) {
    try {
      return decryptJsonSecret({
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        tag: payload.tag,
        algorithm: "AES-256-GCM",
      });
    } catch (error) {
      console.warn("Secret vault decryption failed, falling back to legacy key", {
        message: (error as Error).message,
      });
    }
  }
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
  return JSON.parse(decrypted) as Record<string, unknown>;
}

export function buildJobResponse(job: any) {
  const parse = (value: string | null) => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (_err) {
      return value;
    }
  };

  return {
    id: job.id,
    tenantId: job.tenantId,
    status: job.status,
    jobType: job.jobType,
    progress: job.progress,
    step: job.step,
    parameters: parse(job.parameters),
    resultSummary: parse(job.resultSummary),
    errorMessage: job.errorMessage,
    requestedByApiKeyId: job.requestedByApiKeyId,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

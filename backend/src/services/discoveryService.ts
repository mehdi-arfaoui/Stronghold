import crypto from "crypto";
import { z, ZodError } from "zod";
import prisma from "../prismaClient.js";

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
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    kind: z.enum(["service", "infra"]).optional(),
    criticality: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    ip: z.string().nullable().optional(),
    hostname: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict();

const discoveryJsonEdgeSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    dependency_type: z.string().nullable().optional(),
  })
  .strict();

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
      const rawKind = result.data.kind || result.data.type;
      const kind = classifyNodeKind(rawKind);
      return {
        externalId: result.data.id,
        name: result.data.name,
        kind,
        type: normalizeNodeType(result.data.type, kind),
        criticality: normalizeCriticality(result.data.criticality),
        provider: result.data.provider || null,
        location: result.data.location || null,
        ip: result.data.ip || null,
        hostname: result.data.hostname || null,
        description: result.data.description || null,
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
      return {
        source: result.data.source,
        target: result.data.target,
        dependencyType: result.data.dependency_type || null,
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

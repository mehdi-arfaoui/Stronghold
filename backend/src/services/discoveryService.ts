import crypto from "crypto";
import prisma from "../prismaClient";

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

function parseCsvPayload(content: string): DiscoveryImportPayload {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return { nodes: [], edges: [] };
  }
  const headers = rows[0].map(toLowerHeader);
  const nodes: DiscoveryNode[] = [];
  const edges: DiscoveryEdge[] = [];

  for (const row of rows.slice(1)) {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (row[index] || "").trim();
    });
    const recordType = (record["record_type"] || record["kind"] || "").toLowerCase();
    const hasEdgeFields = Boolean(record["source"] || record["from"] || record["target"] || record["to"]);

    if (recordType === "edge" || hasEdgeFields) {
      const source = normalizeExternalId(record["source"] || record["from"], "");
      const target = normalizeExternalId(record["target"] || record["to"], "");
      if (!source || !target) {
        continue;
      }
      edges.push({
        source,
        target,
        dependencyType: record["dependency_type"] || record["type"] || record["dependency"],
      });
      continue;
    }

    const name = record["name"] || record["nom"] || record["label"];
    if (!name) {
      continue;
    }
    const rawKind = record["node_type"] || record["type"] || record["kind"];
    const kind = classifyNodeKind(rawKind);
    const externalId = normalizeExternalId(record["id"] || record["node_id"], name);
    const node: DiscoveryNode = {
      externalId,
      name,
      kind,
      type: normalizeNodeType(rawKind, kind),
      criticality: normalizeCriticality(record["criticality"] || record["criticite"] || record["criticalite"]),
      provider: record["provider"] || null,
      location: record["location"] || null,
      ip: record["ip"] || record["ip_address"] || null,
      hostname: record["hostname"] || record["host"] || null,
      description: record["description"] || null,
    };
    nodes.push(node);
  }

  return { nodes, edges };
}

function parseJsonPayload(content: string): DiscoveryImportPayload {
  const parsed = JSON.parse(content) as any;
  const rawNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const rawEdges = Array.isArray(parsed?.edges) ? parsed.edges : [];

  const nodes: DiscoveryNode[] = rawNodes
    .map((node: any) => {
      if (!node) return null;
      const name = node.name || node.nom || node.label;
      if (!name) return null;
      const rawKind = node.nodeType || node.kind || node.type;
      const kind = classifyNodeKind(rawKind);
      const externalId = normalizeExternalId(node.id || node.externalId, name);
      return {
        externalId,
        name,
        kind,
        type: normalizeNodeType(node.serviceType || node.infraType || node.type, kind),
        criticality: normalizeCriticality(node.criticality || node.criticite || node.criticalite),
        provider: node.provider || null,
        location: node.location || null,
        ip: node.ip || node.ipAddress || null,
        hostname: node.hostname || node.host || null,
        description: node.description || null,
      } as DiscoveryNode;
    })
    .filter(Boolean) as DiscoveryNode[];

  const edges: DiscoveryEdge[] = rawEdges
    .map((edge: any) => {
      if (!edge) return null;
      const source = edge.source || edge.from;
      const target = edge.target || edge.to;
      if (!source || !target) return null;
      return {
        source: String(source),
        target: String(target),
        dependencyType: edge.dependencyType || edge.type || edge.dependency,
      } as DiscoveryEdge;
    })
    .filter(Boolean) as DiscoveryEdge[];

  return { nodes, edges };
}

export function parseDiscoveryImport(buffer: Buffer, filename: string, mimeType?: string | null) {
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

import prisma from "../prismaClient.js";
import type { DiscoveryResourceKind } from "./discoveryTypes.js";

export type MergeDiscoveredResourceInput = {
  source: string;
  externalId: string;
  name: string;
  kind: DiscoveryResourceKind;
  type: string;
  ip?: string | null;
  hostname?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type MergeDiscoveredResourcesSummary = {
  createdDiscoveredResources: number;
  updatedDiscoveredResources: number;
  matchedServices: number;
  createdServices: number;
  matchedInfra: number;
  createdInfra: number;
};

function normalizeName(value: string) {
  return value.trim();
}

function normalizeMetadata(metadata?: Record<string, unknown> | null) {
  return metadata && Object.keys(metadata).length > 0 ? metadata : null;
}

function resolveMetadataString(metadata: Record<string, unknown> | null, key: string) {
  const rawValue = metadata?.[key];
  if (typeof rawValue === "string" && rawValue.trim()) {
    return rawValue.trim();
  }
  return null;
}

function resolveCriticality(metadata: Record<string, unknown> | null) {
  const rawValue = resolveMetadataString(metadata, "criticality");
  if (!rawValue) return "medium";
  const normalized = rawValue.toLowerCase();
  if (normalized.includes("crit")) return "critical";
  if (normalized.includes("high")) return "high";
  if (normalized.includes("low")) return "low";
  return "medium";
}

async function ensureServiceMatch(
  tenantId: string,
  resource: MergeDiscoveredResourceInput
): Promise<{ id: string; created: boolean } | null> {
  const name = normalizeName(resource.name);
  if (!name) return null;
  const matched = await prisma.service.findFirst({
    where: {
      tenantId,
      name: { equals: name, mode: "insensitive" },
    },
  });
  if (matched) {
    return { id: matched.id, created: false };
  }

  const created = await prisma.service.create({
    data: {
      tenantId,
      name,
      type: resource.type,
      description: resolveMetadataString(resource.metadata ?? null, "description"),
      criticality: resolveCriticality(resource.metadata ?? null),
    },
  });
  return { id: created.id, created: true };
}

async function ensureInfraMatch(
  tenantId: string,
  resource: MergeDiscoveredResourceInput
): Promise<{ id: string; created: boolean } | null> {
  const name = normalizeName(resource.name);
  if (!name) return null;
  const matched = await prisma.infraComponent.findFirst({
    where: {
      tenantId,
      name: { equals: name, mode: "insensitive" },
      type: resource.type,
    },
  });
  if (matched) {
    return { id: matched.id, created: false };
  }

  const created = await prisma.infraComponent.create({
    data: {
      tenantId,
      name,
      type: resource.type,
      provider: resolveMetadataString(resource.metadata ?? null, "provider"),
      location: resolveMetadataString(resource.metadata ?? null, "location"),
      criticality: resolveMetadataString(resource.metadata ?? null, "criticality"),
    },
  });
  return { id: created.id, created: true };
}

export async function mergeDiscoveredResources(
  tenantId: string,
  resources: MergeDiscoveredResourceInput[]
): Promise<MergeDiscoveredResourcesSummary> {
  const summary: MergeDiscoveredResourcesSummary = {
    createdDiscoveredResources: 0,
    updatedDiscoveredResources: 0,
    matchedServices: 0,
    createdServices: 0,
    matchedInfra: 0,
    createdInfra: 0,
  };
  const now = new Date();

  for (const resource of resources) {
    const normalizedName = normalizeName(resource.name);
    const metadata = normalizeMetadata(resource.metadata ?? null);
    let serviceId: string | null = null;
    let infraId: string | null = null;

    if (resource.kind === "service") {
      const match = await ensureServiceMatch(tenantId, {
        ...resource,
        name: normalizedName,
        metadata,
      });
      if (match) {
        serviceId = match.id;
        if (match.created) {
          summary.createdServices += 1;
        } else {
          summary.matchedServices += 1;
        }
      }
    } else {
      const match = await ensureInfraMatch(tenantId, {
        ...resource,
        name: normalizedName,
        metadata,
      });
      if (match) {
        infraId = match.id;
        if (match.created) {
          summary.createdInfra += 1;
        } else {
          summary.matchedInfra += 1;
        }
      }
    }

    const result = await prisma.discoveredResource.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId,
          source: resource.source,
          externalId: resource.externalId,
        },
      },
      update: {
        name: normalizedName,
        type: resource.type,
        kind: resource.kind,
        ip: resource.ip ?? null,
        hostname: resource.hostname ?? null,
        tags: resource.tags ?? undefined,
        metadata: metadata ?? undefined,
        serviceId,
        infraId,
        lastSeenAt: now,
      },
      create: {
        tenantId,
        source: resource.source,
        externalId: resource.externalId,
        name: normalizedName,
        kind: resource.kind,
        type: resource.type,
        ip: resource.ip ?? null,
        hostname: resource.hostname ?? null,
        tags: resource.tags ?? undefined,
        metadata: metadata ?? undefined,
        serviceId,
        infraId,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      summary.createdDiscoveredResources += 1;
    } else {
      summary.updatedDiscoveredResources += 1;
    }
  }

  return summary;
}

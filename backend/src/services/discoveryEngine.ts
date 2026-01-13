import crypto from "crypto";
import prisma from "../prismaClient.js";
import {
  scanNetwork,
  scanHyperV,
  scanVmware,
  scanKubernetes,
  scanFlows,
} from "./discoveryConnectors.js";
import { scanAws, scanAzure, scanGcp } from "./discoveryCloudConnectors.js";
import type {
  DiscoveryRunContext,
  DiscoveredFlow,
  DiscoveredResource,
} from "./discoveryTypes.js";
import { correlateDiscoveryResources } from "./discoveryCorrelationService.js";
import { applyDiscoveryImport } from "./discoveryService.js";

type DiscoveryEngineSummary = {
  discoveredResources: number;
  discoveredFlows: number;
  matchedResources: number;
  createdServices: number;
  createdInfra: number;
  createdDependencies: number;
  createdInfraLinks: number;
  ignoredEdges: number;
  warnings: string[];
};

function buildFingerprint(resource: DiscoveredResource) {
  const hash = crypto.createHash("sha256");
  hash.update(
    JSON.stringify({
      source: resource.source,
      externalId: resource.externalId,
      name: resource.name,
      kind: resource.kind,
      type: resource.type,
      ip: resource.ip,
      hostname: resource.hostname,
      tags: resource.tags,
    })
  );
  return hash.digest("hex");
}

function normalizeProvider(provider: string) {
  return provider.trim().toLowerCase();
}

function hasProvider(target: string, providers: string[]) {
  const normalized = normalizeProvider(target);
  return providers.some((provider) => normalizeProvider(provider) === normalized);
}

async function collectDiscoveryData(context: DiscoveryRunContext) {
  const results: Array<Promise<{
    resources: DiscoveredResource[];
    flows: DiscoveredFlow[];
    warnings: string[];
  }>> = [];

  if (context.ipRanges.length > 0) {
    results.push(scanNetwork(context.ipRanges, context.credentials));
  }

  results.push(scanHyperV(context.credentials));
  results.push(scanVmware(context.credentials));
  results.push(scanKubernetes(context.credentials));
  results.push(scanFlows(context.credentials));

  if (hasProvider("aws", context.cloudProviders)) {
    results.push(scanAws(context.credentials));
  }
  if (hasProvider("azure", context.cloudProviders)) {
    results.push(scanAzure(context.credentials));
  }
  if (hasProvider("gcp", context.cloudProviders)) {
    results.push(scanGcp(context.credentials));
  }

  const settled = await Promise.allSettled(results);
  const resources: DiscoveredResource[] = [];
  const flows: DiscoveredFlow[] = [];
  const warnings: string[] = [];

  settled.forEach((entry) => {
    if (entry.status === "fulfilled") {
      resources.push(...entry.value.resources);
      flows.push(...entry.value.flows);
      warnings.push(...entry.value.warnings);
    } else {
      const message = entry.reason instanceof Error ? entry.reason.message : "Connector error";
      warnings.push(message);
    }
  });

  return { resources, flows, warnings };
}

function toDiscoveryNode(resource: DiscoveredResource) {
  return {
    externalId: resource.externalId,
    name: resource.name,
    kind: resource.kind,
    type: resource.type,
    ip: resource.ip ?? null,
    hostname: resource.hostname ?? null,
    description: resource.metadata?.description ? String(resource.metadata.description) : null,
    provider: resource.metadata?.provider ? String(resource.metadata.provider) : null,
  };
}

function toDiscoveryEdge(source: DiscoveredResource, target: DiscoveredResource) {
  return {
    source: source.externalId,
    target: target.externalId,
    dependencyType: "netflow",
  };
}

export async function runDiscoveryEngine(context: DiscoveryRunContext): Promise<DiscoveryEngineSummary> {
  const { resources, flows, warnings } = await collectDiscoveryData(context);
  const matches = await correlateDiscoveryResources(context.tenantId, resources);

  const createdResources = await prisma.$transaction(async (tx) => {
    const created: Array<{
      id: string;
      externalId: string;
      ip: string | null;
      hostname: string | null;
    }> = [];

    for (const resource of resources) {
      const createdResource = await tx.discoveryResource.create({
        data: {
          tenantId: context.tenantId,
          jobId: context.jobId,
          source: resource.source,
          externalId: resource.externalId,
          name: resource.name,
          kind: resource.kind,
          type: resource.type,
          ip: resource.ip ?? null,
          hostname: resource.hostname ?? null,
          tags: resource.tags ?? undefined,
          metadata: resource.metadata ?? undefined,
          fingerprint: buildFingerprint(resource),
          discoveredAt: new Date(),
        },
      });
      created.push({
        id: createdResource.id,
        externalId: createdResource.externalId,
        ip: createdResource.ip,
        hostname: createdResource.hostname,
      });
    }

    for (const match of matches) {
      const resource = created.find((item) => item.externalId === match.resourceExternalId);
      if (!resource) continue;
      await tx.discoveryResourceMatch.create({
        data: {
          tenantId: context.tenantId,
          resourceId: resource.id,
          matchType: match.matchType,
          matchId: match.matchId,
          strategy: match.strategy,
          score: match.score,
          status: match.status,
        },
      });
    }

    if (flows.length > 0) {
      for (const flow of flows) {
        const sourceResource = flow.sourceIp
          ? created.find((item) => item.ip === flow.sourceIp) || null
          : null;
        const targetResource = flow.targetIp
          ? created.find((item) => item.ip === flow.targetIp) || null
          : null;
        await tx.discoveryFlow.create({
          data: {
            tenantId: context.tenantId,
            jobId: context.jobId,
            sourceResourceId: sourceResource?.id ?? null,
            targetResourceId: targetResource?.id ?? null,
            sourceIp: flow.sourceIp ?? null,
            targetIp: flow.targetIp ?? null,
            sourcePort: flow.sourcePort ?? null,
            targetPort: flow.targetPort ?? null,
            protocol: flow.protocol ?? null,
            bytes: flow.bytes ?? null,
            packets: flow.packets ?? null,
            observedAt: flow.observedAt ?? new Date(),
          },
        });
      }
    }

    return created;
  });

  let createdServices = 0;
  let createdInfra = 0;
  let createdDependencies = 0;
  let createdInfraLinks = 0;
  let ignoredEdges = 0;

  if (context.autoCreate && resources.length > 0) {
    const nodes = resources.map(toDiscoveryNode);
    const edges = flows
      .map((flow) => {
        const source = resources.find((resource) => resource.ip === flow.sourceIp);
        const target = resources.find((resource) => resource.ip === flow.targetIp);
        if (!source || !target) return null;
        return toDiscoveryEdge(source, target);
      })
      .filter(Boolean) as Array<{ source: string; target: string; dependencyType: string }>;

    const summary = await applyDiscoveryImport(context.tenantId, { nodes, edges });
    createdServices = summary.createdServices;
    createdInfra = summary.createdInfra;
    createdDependencies = summary.createdDependencies;
    createdInfraLinks = summary.createdInfraLinks;
    ignoredEdges = summary.ignoredEdges;
  }

  return {
    discoveredResources: createdResources.length,
    discoveredFlows: flows.length,
    matchedResources: matches.length,
    createdServices,
    createdInfra,
    createdDependencies,
    createdInfraLinks,
    ignoredEdges,
    warnings,
  };
}

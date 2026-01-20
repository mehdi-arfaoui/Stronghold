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
import { mergeDiscoveredResources } from "./discoveryMergeService.js";
import { toPrismaJson } from "../utils/prismaJson.js";

type DiscoveryEngineSummary = {
  discoveredResources: number;
  discoveredFlows: number;
  matchedResources: number;
  createdServices: number;
  createdInfra: number;
  createdDependencies: number;
  createdInfraLinks: number;
  ignoredEdges: number;
  addedResources: number;
  modifiedResources: number;
  removedResources: number;
  unmatchedResources: number;
  shadowFlows: number;
  mergedDiscoveredResources: number;
  updatedDiscoveredResources: number;
  mergedServiceMatches: number;
  mergedInfraMatches: number;
  mergedServicesCreated: number;
  mergedInfraCreated: number;
  newResourceSamples: Array<{ source: string; externalId: string; name: string }>;
  shadowFlowSamples: Array<{
    sourceIp: string | null;
    targetIp: string | null;
    protocol: string | null;
    sourcePort: number | null;
    targetPort: number | null;
  }>;
  warnings: string[];
};

type DiscoveryResourceSnapshot = {
  source: string;
  externalId: string;
  name: string;
  kind: string;
  type: string;
  ip: string | null;
  hostname: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  fingerprint: string;
};

type DiscoveryResourceChangeInput = {
  tenantId: string;
  jobId: string;
  source: string;
  externalId: string;
  changeType: "ADDED" | "MODIFIED" | "REMOVED";
  previousFingerprint: string | null;
  newFingerprint: string | null;
  metadata: Record<string, unknown> | null;
  detectedAt: Date;
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

function buildResourceKey(resource: { source: string; externalId: string }) {
  return `${resource.source}::${resource.externalId}`;
}

function toSnapshot(resource: DiscoveredResource, fingerprint: string): DiscoveryResourceSnapshot {
  return {
    source: resource.source,
    externalId: resource.externalId,
    name: resource.name,
    kind: resource.kind,
    type: resource.type,
    ip: resource.ip ?? null,
    hostname: resource.hostname ?? null,
    tags: resource.tags ?? null,
    metadata: resource.metadata ?? null,
    fingerprint,
  };
}

function stripSnapshot(snapshot: DiscoveryResourceSnapshot) {
  return {
    source: snapshot.source,
    externalId: snapshot.externalId,
    name: snapshot.name,
    kind: snapshot.kind,
    type: snapshot.type,
    ip: snapshot.ip,
    hostname: snapshot.hostname,
    tags: snapshot.tags,
    metadata: snapshot.metadata,
  };
}

async function fetchPreviousDiscoveryResources(tenantId: string, jobId: string) {
  const lastJob = await prisma.discoveryJob.findFirst({
    where: {
      tenantId,
      status: "COMPLETED",
      completedAt: { not: null },
      id: { not: jobId },
    },
    orderBy: { completedAt: "desc" },
  });

  if (!lastJob) return null;

  const resources = await prisma.discoveryResource.findMany({
    where: { tenantId, jobId: lastJob.id },
    select: {
      source: true,
      externalId: true,
      name: true,
      kind: true,
      type: true,
      ip: true,
      hostname: true,
      tags: true,
      metadata: true,
      fingerprint: true,
    },
  });

  return resources as DiscoveryResourceSnapshot[];
}

function computeResourceChanges(
  currentSnapshots: DiscoveryResourceSnapshot[],
  previousSnapshots: DiscoveryResourceSnapshot[] | null,
  detectedAt: Date,
  tenantId: string,
  jobId: string
) {
  const addedResources: DiscoveryResourceSnapshot[] = [];
  const modifiedResources: DiscoveryResourceSnapshot[] = [];
  const removedResources: DiscoveryResourceSnapshot[] = [];
  const changes: DiscoveryResourceChangeInput[] = [];

  const previousMap = new Map<string, DiscoveryResourceSnapshot>();
  previousSnapshots?.forEach((resource) => {
    previousMap.set(buildResourceKey(resource), resource);
  });

  const currentMap = new Map<string, DiscoveryResourceSnapshot>();
  currentSnapshots.forEach((resource) => {
    currentMap.set(buildResourceKey(resource), resource);
  });

  currentSnapshots.forEach((resource) => {
    const previous = previousMap.get(buildResourceKey(resource));
    if (!previous) {
      addedResources.push(resource);
      changes.push({
        tenantId,
        jobId,
        source: resource.source,
        externalId: resource.externalId,
        changeType: "ADDED",
        previousFingerprint: null,
        newFingerprint: resource.fingerprint,
        metadata: { current: stripSnapshot(resource) },
        detectedAt,
      });
      return;
    }

    if (previous.fingerprint !== resource.fingerprint) {
      modifiedResources.push(resource);
      changes.push({
        tenantId,
        jobId,
        source: resource.source,
        externalId: resource.externalId,
        changeType: "MODIFIED",
        previousFingerprint: previous.fingerprint,
        newFingerprint: resource.fingerprint,
        metadata: {
          previous: stripSnapshot(previous),
          current: stripSnapshot(resource),
        },
        detectedAt,
      });
    }
  });

  previousSnapshots?.forEach((resource) => {
    if (!currentMap.has(buildResourceKey(resource))) {
      removedResources.push(resource);
      changes.push({
        tenantId,
        jobId,
        source: resource.source,
        externalId: resource.externalId,
        changeType: "REMOVED",
        previousFingerprint: resource.fingerprint,
        newFingerprint: null,
        metadata: { previous: stripSnapshot(resource) },
        detectedAt,
      });
    }
  });

  return {
    changes,
    addedResources,
    modifiedResources,
    removedResources,
  };
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
  const detectedAt = new Date();
  const previousResources = await fetchPreviousDiscoveryResources(context.tenantId, context.jobId);
  const currentSnapshots = resources.map((resource) =>
    toSnapshot(resource, buildFingerprint(resource))
  );
  const changeSummary = computeResourceChanges(
    currentSnapshots,
    previousResources,
    detectedAt,
    context.tenantId,
    context.jobId
  );
  const matches = await correlateDiscoveryResources(context.tenantId, resources);

  const matchedExternalIds = new Set(matches.map((match) => match.resourceExternalId));
  const unmatchedAddedResources = changeSummary.addedResources.filter(
    (resource) => !matchedExternalIds.has(resource.externalId)
  );

  const knownIps = new Set(
    resources.map((resource) => resource.ip).filter((value): value is string => Boolean(value))
  );
  const shadowFlows = flows.filter((flow) => {
    const sourceKnown = flow.sourceIp ? knownIps.has(flow.sourceIp) : false;
    const targetKnown = flow.targetIp ? knownIps.has(flow.targetIp) : false;
    return !sourceKnown || !targetKnown;
  });

  if (shadowFlows.length > 0) {
    warnings.push(
      `${shadowFlows.length} flux réseau impliquent des hôtes non identifiés (shadow IT potentielle)`
    );
  }

  const createdResources = await prisma.$transaction(async (tx) => {
    const created: Array<{
      id: string;
      externalId: string;
      ip: string | null;
      hostname: string | null;
    }> = [];

    for (const resource of resources) {
      const fingerprint = buildFingerprint(resource);
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
          ...(resource.tags != null ? { tags: toPrismaJson(resource.tags) } : {}),
          ...(resource.metadata != null ? { metadata: toPrismaJson(resource.metadata) } : {}),
          fingerprint,
          discoveredAt: detectedAt,
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

    if (changeSummary.changes.length > 0) {
      await tx.discoveryResourceChange.createMany({
        data: changeSummary.changes.map((change) => ({
          tenantId: change.tenantId,
          jobId: change.jobId,
          source: change.source,
          externalId: change.externalId,
          changeType: change.changeType,
          previousFingerprint: change.previousFingerprint,
          newFingerprint: change.newFingerprint,
          ...(change.metadata != null ? { metadata: toPrismaJson(change.metadata) } : {}),
          detectedAt: change.detectedAt,
        })),
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

  const mergeSummary = await mergeDiscoveredResources(context.tenantId, resources);

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
    addedResources: changeSummary.addedResources.length,
    modifiedResources: changeSummary.modifiedResources.length,
    removedResources: changeSummary.removedResources.length,
    unmatchedResources: unmatchedAddedResources.length,
    shadowFlows: shadowFlows.length,
    mergedDiscoveredResources: mergeSummary.createdDiscoveredResources,
    updatedDiscoveredResources: mergeSummary.updatedDiscoveredResources,
    mergedServiceMatches: mergeSummary.matchedServices,
    mergedInfraMatches: mergeSummary.matchedInfra,
    mergedServicesCreated: mergeSummary.createdServices,
    mergedInfraCreated: mergeSummary.createdInfra,
    newResourceSamples: unmatchedAddedResources.slice(0, 20).map((resource) => ({
      source: resource.source,
      externalId: resource.externalId,
      name: resource.name,
    })),
    shadowFlowSamples: shadowFlows.slice(0, 20).map((flow) => ({
      sourceIp: flow.sourceIp ?? null,
      targetIp: flow.targetIp ?? null,
      protocol: flow.protocol ?? null,
      sourcePort: flow.sourcePort ?? null,
      targetPort: flow.targetPort ?? null,
    })),
    warnings,
  };
}

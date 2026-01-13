import prisma from "../prismaClient.js";
import type { DiscoveredResource } from "./discoveryTypes.js";

type ResourceMatch = {
  resourceExternalId: string;
  matchType: "service" | "infra";
  matchId: string;
  strategy: string;
  score: number;
  status: "MATCHED" | "PROPOSED";
};

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

function scoreTags(resourceTags: string[] | null | undefined, targetName: string) {
  if (!resourceTags || resourceTags.length === 0) return 0;
  const normalizedTarget = normalizeName(targetName);
  const matches = resourceTags.filter((tag) => normalizeName(tag).includes(normalizedTarget));
  return matches.length > 0 ? 0.6 : 0;
}

export async function correlateDiscoveryResources(
  tenantId: string,
  resources: DiscoveredResource[]
): Promise<ResourceMatch[]> {
  const services = await prisma.service.findMany({
    where: { tenantId },
    select: { id: true, name: true, type: true },
  });
  const infra = await prisma.infraComponent.findMany({
    where: { tenantId },
    select: { id: true, name: true, type: true },
  });

  const matches: ResourceMatch[] = [];

  for (const resource of resources) {
    if (resource.kind === "service") {
      let best: ResourceMatch | null = null;
      for (const service of services) {
        const nameScore = scoreSimilarity(resource.name, service.name);
        const tagScore = scoreTags(resource.tags, service.name);
        const score = Math.max(nameScore, tagScore);
        if (!best || score > best.score) {
          best = {
            resourceExternalId: resource.externalId,
            matchType: "service",
            matchId: service.id,
            strategy: nameScore >= tagScore ? "name" : "tags",
            score,
            status: score >= 0.7 ? "MATCHED" : "PROPOSED",
          };
        }
      }
      if (best && best.score >= 0.4) {
        matches.push(best);
      }
      continue;
    }

    let best: ResourceMatch | null = null;
    for (const component of infra) {
      const score = scoreSimilarity(resource.name, component.name);
      if (!best || score > best.score) {
        best = {
          resourceExternalId: resource.externalId,
          matchType: "infra",
          matchId: component.id,
          strategy: "name",
          score,
          status: score >= 0.75 ? "MATCHED" : "PROPOSED",
        };
      }
    }
    if (best && best.score >= 0.4) {
      matches.push(best);
    }
  }

  return matches;
}

import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest } from "../middleware/tenantMiddleware";

type Criticality = "critical" | "high" | "medium" | "low";
type EdgeKind = "CRITICAL" | "STRONG" | "NORMAL";

const criticalityScore: Record<Criticality, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function normalizeCriticality(value: string | null | undefined): Criticality {
  const normalized = (value || "").toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function resolveCategory(domain: string | null, type: string | null): string {
  const normalizedDomain = (domain || "").toUpperCase();
  const normalizedType = (type || "").toUpperCase();

  if (normalizedDomain.includes("NETWORK") || normalizedType.includes("NETWORK")) {
    return "Network";
  }
  if (normalizedDomain.includes("SECURITY") || normalizedDomain.includes("GOV")) {
    return "Foundation";
  }
  if (normalizedDomain.includes("DATA") || normalizedDomain.includes("DB")) {
    return "Platform";
  }
  if (normalizedDomain.includes("IAC") || normalizedDomain.includes("PLATFORM")) {
    return "Platform";
  }
  if (normalizedDomain.includes("APP")) {
    return "Application";
  }
  return "Application";
}

function resolveNodeKind(type: string | null): "service" | "application" {
  const normalizedType = (type || "").toLowerCase();
  if (normalizedType.includes("app")) return "application";
  return "service";
}

function isStrongDependency(dependencyType: string | null | undefined) {
  const normalized = (dependencyType || "").toLowerCase();
  return normalized.includes("fort") || normalized.includes("strong");
}

function resolveEdgeKind(criticality: Criticality, dependencyType: string | null | undefined): EdgeKind {
  const strong = isStrongDependency(dependencyType);
  if (criticality === "critical") return "CRITICAL";
  if (criticality === "high" && strong) return "CRITICAL";
  if (strong) return "STRONG";
  return "NORMAL";
}

function resolveEdgeWeight(criticality: Criticality, dependencyType: string | null | undefined): number {
  const base = criticalityScore[criticality] ?? 1;
  return base + (isStrongDependency(dependencyType) ? 1 : 0);
}

function buildSummaryLabel(name: string, type: string | null): string {
  const trimmed = (name || "").trim();
  const shortName = trimmed.length > 24 ? `${trimmed.slice(0, 21)}…` : trimmed;
  const suffix = type ? ` (${type})` : "";
  const combined = `${shortName}${suffix}`;
  return combined.length > 32 ? `${combined.slice(0, 29)}…` : combined;
}

const router = Router();

router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const services = await prisma.service.findMany({
      where: { tenantId },
      include: {
        continuity: true,
        dependenciesFrom: true,
        dependenciesTo: true,
      },
    });

    const nodes = services.map((s) => {
      const category = resolveCategory(s.domain, s.type);
      const crit = normalizeCriticality(s.criticality);
      const summaryLabel = buildSummaryLabel(s.name, s.type);
      return {
        id: s.id,
        label: s.name,
        summaryLabel,
        detailPayload: {
          name: s.name,
          type: s.type,
          category,
          criticality: crit,
          businessPriority: s.businessPriority,
          domain: s.domain,
          isLandingZone: category === "Foundation" || category === "Network" || category === "Platform",
          rtoHours: s.continuity?.rtoHours ?? null,
          rpoMinutes: s.continuity?.rpoMinutes ?? null,
          mtpdHours: s.continuity?.mtpdHours ?? null,
          dependsOnCount: s.dependenciesFrom.length,
          usedByCount: s.dependenciesTo.length,
        },
        type: s.type,
        nodeKind: resolveNodeKind(s.type),
        category,
        criticality: crit,
        businessPriority: s.businessPriority,
        domain: s.domain,
        isLandingZone: category === "Foundation" || category === "Network" || category === "Platform",
        rtoHours: s.continuity?.rtoHours ?? null,
        rpoMinutes: s.continuity?.rpoMinutes ?? null,
        mtpdHours: s.continuity?.mtpdHours ?? null,
        dependsOnCount: s.dependenciesFrom.length,
        usedByCount: s.dependenciesTo.length,
      };
    });

    const serviceNameById = services.reduce<Record<string, string>>((acc, service) => {
      acc[service.id] = service.name;
      return acc;
    }, {});

    const edges = services.flatMap((s) => {
      const sourceCrit = normalizeCriticality(s.criticality);
      return s.dependenciesFrom.map((d) => ({
        id: d.id,
        from: d.fromServiceId,
        to: d.toServiceId,
        type: d.dependencyType,
        edgeLabelShort: d.dependencyType || "dépendance",
        edgeLabelLong: `${serviceNameById[d.fromServiceId] || d.fromServiceId} → ${
          serviceNameById[d.toServiceId] || d.toServiceId
        } (${d.dependencyType || "dépendance"})`,
        strength: isStrongDependency(d.dependencyType) ? "strong" : "normal",
        edgeWeight: resolveEdgeWeight(sourceCrit, d.dependencyType),
        edgeKind: resolveEdgeKind(sourceCrit, d.dependencyType),
      }));
    });

    const categorySummary = nodes.reduce<Record<string, { count: number; scoreSum: number }>>(
      (acc, node) => {
        const current = acc[node.category] || { count: 0, scoreSum: 0 };
        current.count += 1;
        current.scoreSum += criticalityScore[node.criticality as Criticality] || 1;
        acc[node.category] = current;
        return acc;
      },
      {}
    );

    const nodeById = nodes.reduce<Record<string, (typeof nodes)[number]>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});

    const categoryLinks = edges.reduce<Record<string, number>>((acc, edge) => {
      const sourceCategory = nodeById[edge.from]?.category;
      const targetCategory = nodeById[edge.to]?.category;
      if (!sourceCategory || !targetCategory) return acc;
      const key = `${sourceCategory}::${targetCategory}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const categoryBubbles = Object.entries(categorySummary).map(([category, stats]) => {
      const dependencyTargets = Object.entries(categoryLinks)
        .filter(([key]) => key.startsWith(`${category}::`))
        .map(([key, count]) => ({
          target: key.split("::")[1],
          count,
        }));

      const averageScore = stats.scoreSum / Math.max(1, stats.count);
      const normalizedAverage = averageScore >= 3.5 ? "critical" : averageScore >= 2.5 ? "high" : averageScore >= 1.5 ? "medium" : "low";

      return {
        category,
        serviceCount: stats.count,
        averageCriticality: normalizedAverage,
        dependencies: dependencyTargets,
      };
    });

    return res.json({
      nodes,
      edges,
      views: {
        categories: categoryBubbles,
      },
    });
  } catch (error) {
    console.error("Error building graph:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});


export default router;

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

const LITE_NODE_LIMIT = 30;
const LITE_EDGE_LIMIT = 80;

const router = Router();

router.get("/dependencies-only", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const services = await prisma.service.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        type: true,
        criticality: true,
        businessPriority: true,
        domain: true,
      },
    });

    const dependencies = await prisma.serviceDependency.findMany({
      where: { tenantId },
      select: {
        id: true,
        fromServiceId: true,
        toServiceId: true,
        dependencyType: true,
      },
    });

    const serviceNameById = services.reduce<Record<string, string>>((acc, service) => {
      acc[service.id] = service.name;
      return acc;
    }, {});

    const serviceCritById = services.reduce<Record<string, string>>((acc, service) => {
      acc[service.id] = service.criticality;
      return acc;
    }, {});

    const dependsOnCountById = dependencies.reduce<Record<string, number>>((acc, dep) => {
      acc[dep.fromServiceId] = (acc[dep.fromServiceId] || 0) + 1;
      return acc;
    }, {});

    const usedByCountById = dependencies.reduce<Record<string, number>>((acc, dep) => {
      acc[dep.toServiceId] = (acc[dep.toServiceId] || 0) + 1;
      return acc;
    }, {});

    const nodes = services.map((service) => {
      const category = resolveCategory(service.domain, service.type);
      const crit = normalizeCriticality(service.criticality);
      const summaryLabel = buildSummaryLabel(service.name, service.type);
      const dependsOnCount = dependsOnCountById[service.id] || 0;
      const usedByCount = usedByCountById[service.id] || 0;
      return {
        id: service.id,
        label: service.name,
        summaryLabel,
        detailPayload: {
          name: service.name,
          type: service.type,
          category,
          criticality: crit,
          businessPriority: service.businessPriority,
          domain: service.domain,
          isLandingZone: category === "Foundation" || category === "Network" || category === "Platform",
          rtoHours: null,
          rpoMinutes: null,
          mtpdHours: null,
          dependsOnCount,
          usedByCount,
        },
        type: service.type,
        nodeKind: "service",
        category,
        criticality: crit,
        businessPriority: service.businessPriority,
        domain: service.domain,
        isLandingZone: category === "Foundation" || category === "Network" || category === "Platform",
        rtoHours: null,
        rpoMinutes: null,
        mtpdHours: null,
        dependsOnCount,
        usedByCount,
      };
    });

    const edges = dependencies.map((dep) => {
      const sourceCrit = normalizeCriticality(serviceCritById[dep.fromServiceId]);
      return {
        id: dep.id,
        from: dep.fromServiceId,
        to: dep.toServiceId,
        type: dep.dependencyType,
        edgeLabelShort: dep.dependencyType || "dépendance",
        edgeLabelLong: `${serviceNameById[dep.fromServiceId] || dep.fromServiceId} → ${
          serviceNameById[dep.toServiceId] || dep.toServiceId
        } (${dep.dependencyType || "dépendance"})`,
        strength: isStrongDependency(dep.dependencyType) ? "strong" : "normal",
        edgeWeight: resolveEdgeWeight(sourceCrit, dep.dependencyType),
        edgeKind: resolveEdgeKind(sourceCrit, dep.dependencyType),
      };
    });

    return res.json({ nodes, edges });
  } catch (error) {
    console.error("Error building dependency graph:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

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

    const view = typeof req.query.view === "string" ? req.query.view : "";
    const isLiteView = view === "architecture-lite";

    let viewNodes = nodes;
    let viewEdges = edges;

    if (isLiteView) {
      const nodeRank = nodes
        .map((node) => {
          const linkLoad = (node.dependsOnCount || 0) + (node.usedByCount || 0);
          return {
            node,
            score: (criticalityScore[node.criticality as Criticality] || 1) * 10 + linkLoad,
          };
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.node.label.localeCompare(b.node.label);
        });

      viewNodes = nodeRank.slice(0, LITE_NODE_LIMIT).map((entry) => entry.node);

      const allowed = new Set(viewNodes.map((node) => node.id));
      viewEdges = edges.filter((edge) => allowed.has(edge.from) && allowed.has(edge.to));

      viewEdges = viewEdges
        .sort((a, b) => (b.edgeWeight || 0) - (a.edgeWeight || 0))
        .slice(0, LITE_EDGE_LIMIT);
    }

    const categorySummary = viewNodes.reduce<Record<string, { count: number; scoreSum: number }>>(
      (acc, node) => {
        const current = acc[node.category] || { count: 0, scoreSum: 0 };
        current.count += 1;
        current.scoreSum += criticalityScore[node.criticality as Criticality] || 1;
        acc[node.category] = current;
        return acc;
      },
      {}
    );

    const nodeById = viewNodes.reduce<Record<string, (typeof nodes)[number]>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});

    const categoryLinks = viewEdges.reduce<Record<string, number>>((acc, edge) => {
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
      nodes: viewNodes,
      edges: viewEdges,
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

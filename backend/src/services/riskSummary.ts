import type { PrismaClient } from "@prisma/client";

export function riskScore(probability: number, impact: number) {
  return probability * impact;
}

export function riskLevel(score: number) {
  if (score >= 17) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export async function buildRiskSummary(prisma: PrismaClient, tenantId: string) {
  const risks = await prisma.risk.findMany({
    where: { tenantId },
    include: { service: true, mitigations: true },
  });

  const enriched = risks.map((risk) => {
    const score = riskScore(risk.probability, risk.impact);
    return {
      ...risk,
      score,
      level: riskLevel(score),
    };
  });

  const byLevel = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  enriched.forEach((risk) => {
    if (risk.level === "critical") byLevel.critical += 1;
    else if (risk.level === "high") byLevel.high += 1;
    else if (risk.level === "medium") byLevel.medium += 1;
    else byLevel.low += 1;
  });

  const mitigatedCount = risks.filter((risk) => risk.mitigations.length > 0).length;

  const priorities = enriched
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((risk) => ({
      id: risk.id,
      title: risk.title,
      score: risk.score,
      level: risk.level,
      probability: risk.probability,
      impact: risk.impact,
      status: risk.status ?? null,
      owner: risk.owner ?? null,
      serviceName: risk.service?.name ?? null,
      processName: risk.processName ?? null,
      mitigations: risk.mitigations.length,
    }));

  return {
    meta: { tenantId },
    totals: {
      count: risks.length,
      byLevel,
      mitigationCoverage: risks.length > 0 ? mitigatedCount / risks.length : 0,
    },
    priorities,
  };
}

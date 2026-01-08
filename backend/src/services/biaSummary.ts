import type { PrismaClient } from "@prisma/client";

const IMPACT_LEVEL_MIN = 1;
const IMPACT_LEVEL_MAX = 5;

export const scoreImpact = (financial: number, regulatory: number) => {
  const weighted = financial * 0.6 + regulatory * 0.4;
  return Number(weighted.toFixed(2));
};

export const scoreByThreshold = (value: number, thresholds: number[]) => {
  for (let i = 0; i < thresholds.length; i += 1) {
    if (value <= thresholds[i]) {
      return thresholds.length - i;
    }
  }
  return IMPACT_LEVEL_MIN;
};

export const scoreTimeSensitivity = (rtoHours: number, rpoMinutes: number, mtpdHours: number) => {
  const rtoScore = scoreByThreshold(rtoHours, [4, 8, 24, 72]);
  const rpoScore = scoreByThreshold(rpoMinutes, [30, 120, 480, 1440]);
  const mtpdScore = scoreByThreshold(mtpdHours, [8, 24, 72, 168]);
  const average = (rtoScore + rpoScore + mtpdScore) / 3;
  return Number(average.toFixed(2));
};

export const scoreCriticality = (impactScore: number, timeScore: number) => {
  return Number(((impactScore + timeScore) / 2).toFixed(2));
};

const clampScore = (value: number) => {
  if (Number.isNaN(value)) return IMPACT_LEVEL_MIN;
  return Math.min(IMPACT_LEVEL_MAX, Math.max(IMPACT_LEVEL_MIN, Math.round(value)));
};

export async function buildBiaSummary(prisma: PrismaClient, tenantId: string) {
  const processes = await prisma.businessProcess.findMany({
    where: { tenantId },
    include: {
      services: {
        include: { service: true },
      },
    },
    orderBy: { criticalityScore: "desc" },
  });

  const processesWithScores = processes.map((process) => {
    const timeScore = scoreTimeSensitivity(
      process.rtoHours,
      process.rpoMinutes,
      process.mtpdHours
    );
    return {
      ...process,
      timeScore,
    };
  });

  const serviceIds = new Set<string>();
  processes.forEach((process) => {
    process.services.forEach((link) => {
      if (link.serviceId) {
        serviceIds.add(link.serviceId);
      }
    });
  });

  const totals = {
    processes: processes.length,
    linkedServices: serviceIds.size,
  };

  const averages = {
    impactScore:
      processes.length > 0
        ? Number(
            (
              processes.reduce((sum, process) => sum + process.impactScore, 0) /
              processes.length
            ).toFixed(2)
          )
        : 0,
    timeScore:
      processes.length > 0
        ? Number(
            (
              processesWithScores.reduce((sum, process) => sum + process.timeScore, 0) /
              processesWithScores.length
            ).toFixed(2)
          )
        : 0,
    criticalityScore:
      processes.length > 0
        ? Number(
            (
              processes.reduce((sum, process) => sum + process.criticalityScore, 0) /
              processes.length
            ).toFixed(2)
          )
        : 0,
  };

  const priorities = processesWithScores
    .slice()
    .sort((a, b) => b.criticalityScore - a.criticalityScore)
    .slice(0, 5)
    .map((process) => ({
      id: process.id,
      name: process.name,
      impactScore: process.impactScore,
      timeScore: process.timeScore,
      criticalityScore: process.criticalityScore,
      rtoHours: process.rtoHours,
      rpoMinutes: process.rpoMinutes,
      mtpdHours: process.mtpdHours,
      services: process.services
        .map((link) => link.service?.name)
        .filter((serviceName): serviceName is string => Boolean(serviceName)),
    }));

  const impactScale = [1, 2, 3, 4, 5];
  const timeScale = [1, 2, 3, 4, 5];
  const cellMap = new Map<string, {
    impact: number;
    time: number;
    count: number;
    processes: Array<{ id: string; name: string; criticalityScore: number }>;
  }>();

  for (const impact of impactScale) {
    for (const time of timeScale) {
      cellMap.set(`${impact}:${time}`, {
        impact,
        time,
        count: 0,
        processes: [],
      });
    }
  }

  processesWithScores.forEach((process) => {
    const impactBucket = clampScore(process.impactScore);
    const timeBucket = clampScore(process.timeScore);
    const cell = cellMap.get(`${impactBucket}:${timeBucket}`);
    if (!cell) return;
    cell.count += 1;
    cell.processes.push({
      id: process.id,
      name: process.name,
      criticalityScore: process.criticalityScore,
    });
  });

  return {
    meta: { tenantId },
    totals,
    averages,
    priorities,
    matrix: {
      impactScale,
      timeScale,
      cells: Array.from(cellMap.values()),
    },
  };
}

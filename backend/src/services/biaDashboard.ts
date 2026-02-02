import type { PrismaClient } from "@prisma/client";
import { buildBiaSummary, scoreTimeSensitivity } from "./biaSummary.js";

export type BiaKpi = {
  label: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "stable";
  severity?: "success" | "warning" | "error" | "neutral";
};

export type BiaAlert = {
  id: string;
  type: "rto_rpo_mismatch" | "high_impact_low_coverage" | "mtpd_exceeded" | "missing_dependencies" | "critical_without_backup";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  processId?: string;
  processName?: string;
  recommendation: string;
  priority: number;
};

export type BiaImpactDistribution = {
  category: string;
  count: number;
  avgScore: number;
  processes: Array<{ id: string; name: string; score: number }>;
};

export type BiaHeatmapCell = {
  probability: number;
  severity: number;
  count: number;
  level: "critical" | "high" | "medium" | "low";
  processes: Array<{ id: string; name: string; criticalityScore: number }>;
};

export type BiaDashboardData = {
  meta: {
    tenantId: string;
    generatedAt: string;
  };
  kpis: BiaKpi[];
  impactDistribution: {
    financial: BiaImpactDistribution;
    regulatory: BiaImpactDistribution;
    operational: BiaImpactDistribution;
  };
  heatmap: {
    probabilityScale: number[];
    severityScale: number[];
    cells: BiaHeatmapCell[];
  };
  alerts: BiaAlert[];
  trends: {
    processesLastMonth: number;
    criticalProcessesTrend: "up" | "down" | "stable";
    avgCriticalityTrend: "up" | "down" | "stable";
  };
};

function computeLevel(probability: number, severity: number): "critical" | "high" | "medium" | "low" {
  const score = probability * severity;
  if (score >= 20) return "critical";
  if (score >= 12) return "high";
  if (score >= 6) return "medium";
  return "low";
}

function generateAlerts(
  processes: Array<{
    id: string;
    name: string;
    financialImpactLevel: number;
    regulatoryImpactLevel: number;
    rtoHours: number;
    rpoMinutes: number;
    mtpdHours: number;
    impactScore: number;
    criticalityScore: number;
    services: Array<{ serviceId: string; service: { name: string; criticality: string } }>;
  }>,
  services: Array<{
    id: string;
    name: string;
    criticality: string;
    continuity: { rtoHours: number; rpoMinutes: number; mtpdHours: number } | null;
  }>
): BiaAlert[] {
  const alerts: BiaAlert[] = [];
  let alertId = 0;

  for (const process of processes) {
    // Alert: RTO/RPO mismatch with linked services
    for (const link of process.services) {
      const service = services.find((s) => s.id === link.serviceId);
      if (service?.continuity) {
        if (process.rtoHours < service.continuity.rtoHours) {
          alerts.push({
            id: `alert-${++alertId}`,
            type: "rto_rpo_mismatch",
            severity: "high",
            title: `RTO incohérent: ${process.name}`,
            description: `Le processus "${process.name}" a un RTO de ${process.rtoHours}h mais dépend du service "${service.name}" avec un RTO de ${service.continuity.rtoHours}h.`,
            processId: process.id,
            processName: process.name,
            recommendation: `Aligner le RTO du processus avec celui du service "${service.name}" ou améliorer le RTO du service.`,
            priority: 1,
          });
        }
        if (process.rpoMinutes < service.continuity.rpoMinutes) {
          alerts.push({
            id: `alert-${++alertId}`,
            type: "rto_rpo_mismatch",
            severity: "high",
            title: `RPO incohérent: ${process.name}`,
            description: `Le processus "${process.name}" a un RPO de ${process.rpoMinutes}min mais dépend du service "${service.name}" avec un RPO de ${service.continuity.rpoMinutes}min.`,
            processId: process.id,
            processName: process.name,
            recommendation: `Aligner le RPO du processus avec celui du service "${service.name}" ou améliorer le RPO du service.`,
            priority: 1,
          });
        }
      }
    }

    // Alert: High impact process without dependencies
    if (process.criticalityScore >= 4 && process.services.length === 0) {
      alerts.push({
        id: `alert-${++alertId}`,
        type: "missing_dependencies",
        severity: "medium",
        title: `Dépendances manquantes: ${process.name}`,
        description: `Le processus critique "${process.name}" (score: ${process.criticalityScore.toFixed(1)}) n'a aucun service associé.`,
        processId: process.id,
        processName: process.name,
        recommendation: `Identifier et associer les services/applications dont dépend ce processus pour une meilleure analyse d'impact.`,
        priority: 2,
      });
    }

    // Alert: MTPD exceeded
    if (process.rtoHours > process.mtpdHours) {
      alerts.push({
        id: `alert-${++alertId}`,
        type: "mtpd_exceeded",
        severity: "critical",
        title: `MTPD dépassé: ${process.name}`,
        description: `Le RTO (${process.rtoHours}h) du processus "${process.name}" dépasse le MTPD (${process.mtpdHours}h).`,
        processId: process.id,
        processName: process.name,
        recommendation: `Réduire le RTO en dessous du MTPD ou revoir les objectifs de reprise pour ce processus.`,
        priority: 0,
      });
    }

    // Alert: Critical process without backup strategy
    if (process.criticalityScore >= 4) {
      const hasBackupService = process.services.some((link) => {
        const service = services.find((s) => s.id === link.serviceId);
        return service?.criticality === "high";
      });
      if (!hasBackupService && process.services.length > 0) {
        alerts.push({
          id: `alert-${++alertId}`,
          type: "critical_without_backup",
          severity: "high",
          title: `Processus critique sans service haute criticité: ${process.name}`,
          description: `Le processus critique "${process.name}" ne dépend d'aucun service marqué haute criticité.`,
          processId: process.id,
          processName: process.name,
          recommendation: `Vérifier que les services associés ont la bonne criticité ou ajouter des mesures de continuité.`,
          priority: 1,
        });
      }
    }
  }

  // Sort by priority (lower = higher priority)
  return alerts.sort((a, b) => a.priority - b.priority);
}

export async function buildBiaDashboard(
  prisma: PrismaClient,
  tenantId: string
): Promise<BiaDashboardData> {
  const [processes, services, biaSummary] = await Promise.all([
    prisma.businessProcess.findMany({
      where: { tenantId },
      include: {
        services: {
          include: { service: true },
        },
      },
      orderBy: { criticalityScore: "desc" },
    }),
    prisma.service.findMany({
      where: { tenantId },
      include: { continuity: true },
    }),
    buildBiaSummary(prisma, tenantId),
  ]);

  // Compute KPIs
  const totalProcesses = processes.length;
  const criticalProcesses = processes.filter((p) => p.criticalityScore >= 4).length;
  const avgCriticality = totalProcesses > 0
    ? processes.reduce((sum, p) => sum + p.criticalityScore, 0) / totalProcesses
    : 0;
  const avgRto = totalProcesses > 0
    ? processes.reduce((sum, p) => sum + p.rtoHours, 0) / totalProcesses
    : 0;
  const avgRpo = totalProcesses > 0
    ? processes.reduce((sum, p) => sum + p.rpoMinutes, 0) / totalProcesses
    : 0;
  const avgMtpd = totalProcesses > 0
    ? processes.reduce((sum, p) => sum + p.mtpdHours, 0) / totalProcesses
    : 0;
  const linkedServicesCount = new Set(processes.flatMap((p) => p.services.map((s) => s.serviceId))).size;

  const kpis: BiaKpi[] = [
    {
      label: "Processus analysés",
      value: totalProcesses,
      severity: totalProcesses > 0 ? "success" : "warning",
    },
    {
      label: "Processus critiques",
      value: criticalProcesses,
      severity: criticalProcesses > totalProcesses * 0.3 ? "error" : criticalProcesses > 0 ? "warning" : "success",
    },
    {
      label: "Criticité moyenne",
      value: avgCriticality.toFixed(1),
      severity: avgCriticality >= 4 ? "error" : avgCriticality >= 3 ? "warning" : "success",
    },
    {
      label: "RTO moyen",
      value: avgRto.toFixed(1),
      unit: "h",
      severity: avgRto > 24 ? "error" : avgRto > 8 ? "warning" : "success",
    },
    {
      label: "RPO moyen",
      value: avgRpo.toFixed(0),
      unit: "min",
      severity: avgRpo > 240 ? "error" : avgRpo > 60 ? "warning" : "success",
    },
    {
      label: "MTPD moyen",
      value: avgMtpd.toFixed(1),
      unit: "h",
      severity: avgMtpd > 72 ? "warning" : "success",
    },
    {
      label: "Services liés",
      value: linkedServicesCount,
      severity: linkedServicesCount > 0 ? "success" : "warning",
    },
  ];

  // Impact distribution
  const financialGroups = new Map<number, typeof processes>();
  const regulatoryGroups = new Map<number, typeof processes>();

  for (const process of processes) {
    const fGroup = financialGroups.get(process.financialImpactLevel) ?? [];
    fGroup.push(process);
    financialGroups.set(process.financialImpactLevel, fGroup);

    const rGroup = regulatoryGroups.get(process.regulatoryImpactLevel) ?? [];
    rGroup.push(process);
    regulatoryGroups.set(process.regulatoryImpactLevel, rGroup);
  }

  const buildDistribution = (groups: Map<number, typeof processes>, label: string): BiaImpactDistribution => {
    const all = Array.from(groups.entries())
      .sort((a, b) => b[0] - a[0])
      .flatMap(([_, procs]) => procs);
    const avgScore = all.length > 0 ? all.reduce((sum, p) => sum + p.criticalityScore, 0) / all.length : 0;
    return {
      category: label,
      count: all.length,
      avgScore,
      processes: all.slice(0, 10).map((p) => ({
        id: p.id,
        name: p.name,
        score: p.criticalityScore,
      })),
    };
  };

  const impactDistribution = {
    financial: buildDistribution(financialGroups, "Financier"),
    regulatory: buildDistribution(regulatoryGroups, "Réglementaire"),
    operational: {
      category: "Opérationnel",
      count: totalProcesses,
      avgScore: avgCriticality,
      processes: processes.slice(0, 10).map((p) => ({
        id: p.id,
        name: p.name,
        score: p.criticalityScore,
      })),
    },
  };

  // Heatmap (probability vs severity)
  const probabilityScale = [1, 2, 3, 4, 5];
  const severityScale = [1, 2, 3, 4, 5];
  const cellMap = new Map<string, BiaHeatmapCell>();

  for (const prob of probabilityScale) {
    for (const sev of severityScale) {
      cellMap.set(`${prob}:${sev}`, {
        probability: prob,
        severity: sev,
        count: 0,
        level: computeLevel(prob, sev),
        processes: [],
      });
    }
  }

  // Map processes to heatmap cells using timeScore as proxy for probability
  for (const process of processes) {
    const timeScore = scoreTimeSensitivity(process.rtoHours, process.rpoMinutes, process.mtpdHours);
    const probBucket = Math.min(5, Math.max(1, Math.round(timeScore)));
    const sevBucket = Math.min(5, Math.max(1, Math.round(process.impactScore)));
    const key = `${probBucket}:${sevBucket}`;
    const cell = cellMap.get(key);
    if (cell) {
      cell.count += 1;
      cell.processes.push({
        id: process.id,
        name: process.name,
        criticalityScore: process.criticalityScore,
      });
    }
  }

  const heatmap = {
    probabilityScale,
    severityScale,
    cells: Array.from(cellMap.values()),
  };

  // Generate alerts
  const alerts = generateAlerts(
    processes.map((p) => ({
      ...p,
      services: p.services.map((s) => ({
        serviceId: s.serviceId,
        service: { name: s.service.name, criticality: s.service.criticality },
      })),
    })),
    services.map((s) => ({
      id: s.id,
      name: s.name,
      criticality: s.criticality,
      continuity: s.continuity,
    }))
  );

  // Trends (simplified - could be enhanced with historical data)
  const trends = {
    processesLastMonth: totalProcesses,
    criticalProcessesTrend: criticalProcesses > totalProcesses * 0.2 ? "up" as const : "stable" as const,
    avgCriticalityTrend: avgCriticality > 3.5 ? "up" as const : "stable" as const,
  };

  return {
    meta: {
      tenantId,
      generatedAt: new Date().toISOString(),
    },
    kpis,
    impactDistribution,
    heatmap,
    alerts,
    trends,
  };
}

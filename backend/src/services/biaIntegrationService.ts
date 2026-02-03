import type { PrismaClient } from "@prisma/client";
import { riskScore, riskLevel } from "./riskSummary.js";

export interface BiaLinkedRisk {
  id: string;
  title: string;
  description: string | null;
  threatType: string;
  probability: number;
  impact: number;
  score: number;
  level: string;
  status: string | null;
  owner: string | null;
  processName: string | null;
  serviceName: string | null;
  serviceId: string | null;
  mitigationCount: number;
  createdAt: Date;
}

export interface BiaLinkedRunbook {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  owner: string | null;
  scenarioId: string | null;
  scenarioTitle: string | null;
  generatedAt: Date;
  hasDownloads: boolean;
}

export interface BiaLinkedIncident {
  id: string;
  title: string;
  description: string | null;
  status: string;
  detectedAt: Date;
  responsibleTeam: string | null;
  impactedServices: Array<{ id: string; name: string }>;
  actionCount: number;
  createdAt: Date;
}

export interface ProcessIntegrationData {
  processId: string;
  processName: string;
  risks: BiaLinkedRisk[];
  runbooks: BiaLinkedRunbook[];
  incidents: BiaLinkedIncident[];
  summary: {
    riskCount: number;
    highRiskCount: number;
    runbookCount: number;
    activeIncidentCount: number;
    totalIncidentCount: number;
  };
}

export interface BiaIntegrationSummary {
  tenantId: string;
  processCount: number;
  totalRisks: number;
  highRisks: number;
  criticalRisks: number;
  totalRunbooks: number;
  activeRunbooks: number;
  totalIncidents: number;
  openIncidents: number;
  inProgressIncidents: number;
  processesWithRisks: number;
  processesWithRunbooks: number;
  processesWithIncidents: number;
  crossModuleAlerts: Array<{
    type: "risk" | "incident" | "runbook" | "coverage";
    severity: "critical" | "high" | "medium" | "low";
    message: string;
    processId?: string;
    processName?: string;
    relatedId?: string;
  }>;
}

export async function getBiaIntegrationSummary(
  prisma: PrismaClient,
  tenantId: string
): Promise<BiaIntegrationSummary> {
  // Fetch all BIA processes with their linked services
  const processes = await prisma.businessProcess.findMany({
    where: { tenantId },
    include: {
      services: {
        include: { service: true },
      },
    },
  });

  const processIds = processes.map((p) => p.id);
  const serviceIds = processes.flatMap((p) => p.services.map((s) => s.serviceId));

  // Fetch risks linked to these services or process names
  const risks = await prisma.risk.findMany({
    where: {
      tenantId,
      OR: [
        { serviceId: { in: serviceIds } },
        { processName: { in: processes.map((p) => p.name) } },
      ],
    },
    include: {
      mitigations: true,
      service: true,
    },
  });

  // Fetch runbooks linked to scenarios that might relate to services
  const runbooks = await prisma.runbook.findMany({
    where: { tenantId },
    include: {
      scenario: true,
    },
  });

  // Fetch incidents linked to services
  const incidents = await prisma.incident.findMany({
    where: {
      tenantId,
      services: {
        some: {
          serviceId: { in: serviceIds },
        },
      },
    },
    include: {
      services: {
        include: { service: true },
      },
      actions: true,
    },
  });

  // Calculate stats
  const riskScores = risks.map((r) => riskScore(r.probability, r.impact));
  const highRisks = riskScores.filter((s) => s >= 15).length;
  const criticalRisks = riskScores.filter((s) => s >= 20).length;

  const openIncidents = incidents.filter((i) => i.status === "OPEN").length;
  const inProgressIncidents = incidents.filter((i) => i.status === "IN_PROGRESS").length;
  const activeRunbooks = runbooks.filter((r) => r.status === "ACTIVE" || r.status === "DRAFT").length;

  // Determine processes with linked items
  const processesWithRisks = new Set<string>();
  const processesWithIncidents = new Set<string>();

  for (const process of processes) {
    const processServiceIds = process.services.map((s) => s.serviceId);

    // Check if any risk links to this process
    const hasRisk = risks.some(
      (r) =>
        (r.serviceId && processServiceIds.includes(r.serviceId)) ||
        r.processName === process.name
    );
    if (hasRisk) processesWithRisks.add(process.id);

    // Check if any incident links to this process
    const hasIncident = incidents.some((i) =>
      i.services.some((s) => processServiceIds.includes(s.serviceId))
    );
    if (hasIncident) processesWithIncidents.add(process.id);
  }

  // Generate cross-module alerts
  const crossModuleAlerts: BiaIntegrationSummary["crossModuleAlerts"] = [];

  // Alert: Critical processes without runbooks
  const criticalProcesses = processes.filter((p) => p.criticalityScore >= 4);
  for (const process of criticalProcesses) {
    const hasRunbook = runbooks.some(
      (r) => r.scenario?.name?.toLowerCase().includes(process.name.toLowerCase())
    );
    if (!hasRunbook) {
      crossModuleAlerts.push({
        type: "coverage",
        severity: "high",
        message: `Processus critique "${process.name}" sans runbook associé`,
        processId: process.id,
        processName: process.name,
      });
    }
  }

  // Alert: High risks on critical processes
  for (const risk of risks) {
    const score = riskScore(risk.probability, risk.impact);
    if (score >= 15) {
      const linkedProcess = processes.find(
        (p) =>
          p.services.some((s) => s.serviceId === risk.serviceId) ||
          p.name === risk.processName
      );
      if (linkedProcess && linkedProcess.criticalityScore >= 4) {
        crossModuleAlerts.push({
          type: "risk",
          severity: score >= 20 ? "critical" : "high",
          message: `Risque élevé "${risk.title}" sur processus critique "${linkedProcess.name}"`,
          processId: linkedProcess.id,
          processName: linkedProcess.name,
          relatedId: risk.id,
        });
      }
    }
  }

  // Alert: Open incidents on critical processes
  for (const incident of incidents) {
    if (incident.status === "OPEN" || incident.status === "IN_PROGRESS") {
      const impactedServiceIds = incident.services.map((s) => s.serviceId);
      const linkedProcess = processes.find((p) =>
        p.services.some((s) => impactedServiceIds.includes(s.serviceId))
      );
      if (linkedProcess && linkedProcess.criticalityScore >= 4) {
        crossModuleAlerts.push({
          type: "incident",
          severity: incident.status === "OPEN" ? "critical" : "high",
          message: `Incident "${incident.title}" impacte le processus critique "${linkedProcess.name}"`,
          processId: linkedProcess.id,
          processName: linkedProcess.name,
          relatedId: incident.id,
        });
      }
    }
  }

  // Alert: Processes without any risk assessment
  for (const process of processes) {
    const hasRisk = risks.some(
      (r) =>
        (r.serviceId && process.services.some((s) => s.serviceId === r.serviceId)) ||
        r.processName === process.name
    );
    if (!hasRisk && process.criticalityScore >= 3) {
      crossModuleAlerts.push({
        type: "coverage",
        severity: "medium",
        message: `Processus "${process.name}" sans analyse de risques`,
        processId: process.id,
        processName: process.name,
      });
    }
  }

  // Sort alerts by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  crossModuleAlerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    tenantId,
    processCount: processes.length,
    totalRisks: risks.length,
    highRisks,
    criticalRisks,
    totalRunbooks: runbooks.length,
    activeRunbooks,
    totalIncidents: incidents.length,
    openIncidents,
    inProgressIncidents,
    processesWithRisks: processesWithRisks.size,
    processesWithRunbooks: 0, // Would need more sophisticated linking
    processesWithIncidents: processesWithIncidents.size,
    crossModuleAlerts: crossModuleAlerts.slice(0, 20), // Limit alerts
  };
}

export async function getProcessIntegration(
  prisma: PrismaClient,
  tenantId: string,
  processId: string
): Promise<ProcessIntegrationData | null> {
  const process = await prisma.businessProcess.findFirst({
    where: { id: processId, tenantId },
    include: {
      services: {
        include: { service: true },
      },
    },
  });

  if (!process) return null;

  const serviceIds = process.services.map((s) => s.serviceId);

  // Fetch linked risks
  const risks = await prisma.risk.findMany({
    where: {
      tenantId,
      OR: [
        { serviceId: { in: serviceIds } },
        { processName: process.name },
      ],
    },
    include: {
      mitigations: true,
      service: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const linkedRisks: BiaLinkedRisk[] = risks.map((r) => {
    const score = riskScore(r.probability, r.impact);
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      threatType: r.threatType,
      probability: r.probability,
      impact: r.impact,
      score,
      level: riskLevel(score),
      status: r.status,
      owner: r.owner,
      processName: r.processName,
      serviceName: r.service?.name || null,
      serviceId: r.serviceId,
      mitigationCount: r.mitigations.length,
      createdAt: r.createdAt,
    };
  });

  // Fetch runbooks that might relate to this process
  const runbooks = await prisma.runbook.findMany({
    where: { tenantId },
    include: {
      scenario: true,
    },
    orderBy: { generatedAt: "desc" },
  });

  // Filter runbooks by process name match (could be improved with explicit linking)
  const linkedRunbooks: BiaLinkedRunbook[] = runbooks
    .filter(
      (r) =>
        r.title.toLowerCase().includes(process.name.toLowerCase()) ||
        r.scenario?.name?.toLowerCase().includes(process.name.toLowerCase())
    )
    .map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      status: r.status,
      owner: r.owner,
      scenarioId: r.scenarioId,
      scenarioTitle: r.scenario?.name || null,
      generatedAt: r.generatedAt,
      hasDownloads: !!(r.pdfPath || r.docxPath || r.markdownPath),
    }));

  // Fetch linked incidents
  const incidents = await prisma.incident.findMany({
    where: {
      tenantId,
      services: {
        some: {
          serviceId: { in: serviceIds },
        },
      },
    },
    include: {
      services: {
        include: { service: true },
      },
      actions: true,
    },
    orderBy: { detectedAt: "desc" },
  });

  const linkedIncidents: BiaLinkedIncident[] = incidents.map((i) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    status: i.status,
    detectedAt: i.detectedAt,
    responsibleTeam: i.responsibleTeam,
    impactedServices: i.services.map((s) => ({
      id: s.service.id,
      name: s.service.name,
    })),
    actionCount: i.actions.length,
    createdAt: i.createdAt,
  }));

  const highRiskCount = linkedRisks.filter((r) => r.score >= 15).length;
  const activeIncidentCount = linkedIncidents.filter(
    (i) => i.status === "OPEN" || i.status === "IN_PROGRESS"
  ).length;

  return {
    processId: process.id,
    processName: process.name,
    risks: linkedRisks,
    runbooks: linkedRunbooks,
    incidents: linkedIncidents,
    summary: {
      riskCount: linkedRisks.length,
      highRiskCount,
      runbookCount: linkedRunbooks.length,
      activeIncidentCount,
      totalIncidentCount: linkedIncidents.length,
    },
  };
}

export async function linkRiskToProcess(
  prisma: PrismaClient,
  tenantId: string,
  riskId: string,
  processName: string
): Promise<boolean> {
  const risk = await prisma.risk.findFirst({
    where: { id: riskId, tenantId },
  });

  if (!risk) return false;

  await prisma.risk.update({
    where: { id: riskId },
    data: { processName },
  });

  return true;
}

export async function createRiskForProcess(
  prisma: PrismaClient,
  tenantId: string,
  processId: string,
  riskData: {
    title: string;
    description?: string;
    threatType: string;
    probability: number;
    impact: number;
  }
): Promise<BiaLinkedRisk | null> {
  const process = await prisma.businessProcess.findFirst({
    where: { id: processId, tenantId },
    include: {
      services: {
        include: { service: true },
      },
    },
  });

  if (!process) return null;

  const serviceId = process.services[0]?.serviceId || null;

  const risk = await prisma.risk.create({
    data: {
      tenantId,
      title: riskData.title,
      description: riskData.description || null,
      threatType: riskData.threatType,
      probability: riskData.probability,
      impact: riskData.impact,
      processName: process.name,
      serviceId,
    },
    include: {
      service: true,
    },
  });

  const score = riskScore(risk.probability, risk.impact);

  return {
    id: risk.id,
    title: risk.title,
    description: risk.description,
    threatType: risk.threatType,
    probability: risk.probability,
    impact: risk.impact,
    score,
    level: riskLevel(score),
    status: risk.status,
    owner: risk.owner,
    processName: risk.processName,
    serviceName: risk.service?.name || null,
    serviceId: risk.serviceId,
    mitigationCount: 0,
    createdAt: risk.createdAt,
  };
}

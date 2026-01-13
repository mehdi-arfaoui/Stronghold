import prisma from "../prismaClient.js";
import type { Exercise } from "@prisma/client";
import {
  CYBER_SCENARIOS,
  getCyberScenarioById,
  type CyberScenario,
} from "../scenarios/cyber/index.js";
import { resolveCyberScenarioFromType } from "./cyberScenarioService.js";

export type SimulatorType = "infection_monkey" | "atomic_red_team";

export type CyberSimulationInput = {
  simulator: SimulatorType;
  durationHours?: number | null;
  targets: string[];
  participants: string[];
  objectives: string[];
  scenarioLibraryId?: string | null;
  connectorUrl?: string | null;
  connectorType?: string | null;
};

type SimulationFindingTemplate = {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  indicators: string[];
  recommendedActions: string[];
};

const SCENARIO_FINDINGS: Record<string, SimulationFindingTemplate[]> = {
  ransomware: [
    {
      title: "Chiffrement massif détecté",
      severity: "critical",
      description: "Volumes critiques chiffrés et extension anormale des fichiers.",
      indicators: ["Hausse des I/O", "Extensions .locked", "Processus inconnus"],
      recommendedActions: [
        "Isoler les segments réseau impactés.",
        "Restaurer les données depuis des sauvegardes hors ligne.",
      ],
    },
    {
      title: "Propagation latérale",
      severity: "high",
      description: "Mouvements latéraux observés via comptes privilégiés.",
      indicators: ["RDP/SMB anormaux", "Nouveaux comptes admin"],
      recommendedActions: [
        "Révoquer les comptes suspects.",
        "Analyser les journaux d'authentification.",
      ],
    },
  ],
  ddos: [
    {
      title: "Saturation frontale",
      severity: "high",
      description: "Trafic volumétrique dépassant les seuils WAF/CDN.",
      indicators: ["Pics de bande passante", "Erreurs 502/504"],
      recommendedActions: [
        "Activer les règles anti-DDoS.",
        "Ajuster le rate limiting applicatif.",
      ],
    },
  ],
  "credential-compromise": [
    {
      title: "Connexion suspecte à privilèges",
      severity: "high",
      description: "Accès admin depuis un contexte inhabituel.",
      indicators: ["Connexion hors plage horaire", "Adresse IP inconnue"],
      recommendedActions: [
        "Bloquer le compte compromis.",
        "Analyser les sessions et révoquer les tokens.",
      ],
    },
    {
      title: "Exfiltration de données",
      severity: "medium",
      description: "Téléchargements massifs de données sensibles.",
      indicators: ["Volumes sortants élevés", "Accès à des répertoires sensibles"],
      recommendedActions: [
        "Surveiller les flux sortants.",
        "Renforcer les contrôles DLP.",
      ],
    },
  ],
  "vm-destruction": [
    {
      title: "Suppression de VMs",
      severity: "critical",
      description: "Destruction non autorisée d'environnements critiques.",
      indicators: ["Logs d'orchestration", "Alertes d'arrêt massif"],
      recommendedActions: [
        "Restaurer les images à partir des snapshots.",
        "Limiter les droits d'administration cloud.",
      ],
    },
  ],
};

function buildFindings(scenario: CyberScenario | null) {
  if (scenario && SCENARIO_FINDINGS[scenario.id]) {
    return SCENARIO_FINDINGS[scenario.id];
  }
  return [
    {
      title: "Détection d'anomalies",
      severity: "medium",
      description: "Signaux faibles détectés dans l'environnement de test.",
      indicators: ["Alertes SIEM", "Anomalies réseau"],
      recommendedActions: [
        "Analyser les alertes SOC.",
        "Documenter les enseignements clés.",
      ],
    },
  ];
}

function severityToRiskScore(severity: SimulationFindingTemplate["severity"]) {
  switch (severity) {
    case "critical":
      return { probability: 5, impact: 5 };
    case "high":
      return { probability: 4, impact: 4 };
    case "medium":
      return { probability: 3, impact: 3 };
    case "low":
    default:
      return { probability: 2, impact: 2 };
  }
}

function sanitizeConnectorPayload(input: CyberSimulationInput) {
  return {
    simulator: input.simulator,
    durationHours: input.durationHours,
    targets: input.targets,
    participants: input.participants,
    objectives: input.objectives,
  };
}

async function fetchConnectorResults(connectorUrl: string, payload: any) {
  const response = await fetch(connectorUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Connector responded with status ${response.status}`);
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.findings)) {
    throw new Error("Connector payload missing findings");
  }
  return data;
}

function buildSimulationResult(
  scenario: CyberScenario | null,
  input: CyberSimulationInput,
  connectorPayload?: any
) {
  const duration = input.durationHours ?? scenario?.defaultDurationHours ?? 4;
  const findings = connectorPayload?.findings ?? buildFindings(scenario);
  return {
    simulator: input.simulator,
    scenarioId: scenario?.id ?? null,
    scenarioName: scenario?.name ?? null,
    durationHours: duration,
    targets: input.targets,
    participants: input.participants,
    objectives: input.objectives,
    findings,
    metrics: {
      detectionRate: connectorPayload?.metrics?.detectionRate ?? 0.82,
      containmentTimeHours: connectorPayload?.metrics?.containmentTimeHours ?? Math.max(1, duration / 2),
      recoveryTimeHours: connectorPayload?.metrics?.recoveryTimeHours ?? duration,
    },
  };
}

async function applySimulationToRisks(
  tenantId: string,
  simulator: SimulatorType,
  scenario: CyberScenario | null,
  findings: SimulationFindingTemplate[],
  tx: typeof prisma
) {
  const updatedRiskIds: string[] = [];

  for (const finding of findings) {
    const title = `${scenario?.name ?? "Simulation"} — ${finding.title}`;
    const existing = await tx.risk.findFirst({ where: { tenantId, title } });
    const { probability, impact } = severityToRiskScore(finding.severity);
    if (existing) {
      await tx.risk.updateMany({
        where: { id: existing.id, tenantId },
        data: {
          threatType: "CYBER_SIMULATION",
          probability,
          impact,
          description: `${finding.description} (source: ${simulator})`,
        },
      });
      updatedRiskIds.push(existing.id);
      continue;
    }

    const created = await tx.risk.create({
      data: {
        tenantId,
        title,
        description: `${finding.description} (source: ${simulator})`,
        threatType: "CYBER_SIMULATION",
        probability,
        impact,
        status: "open",
      },
    });
    updatedRiskIds.push(created.id);
  }

  return updatedRiskIds;
}

async function applySimulationToRunbookSteps(
  tenantId: string,
  exercise: Exercise,
  findings: SimulationFindingTemplate[],
  tx: typeof prisma
) {
  const scenarioId = exercise.scenarioId;
  const existingSteps = await tx.runbookStep.findMany({
    where: { tenantId, scenarioId },
    select: { title: true, order: true },
    orderBy: { order: "desc" },
  });

  let nextOrder = existingSteps[0]?.order ?? 0;
  const existingTitles = new Set(existingSteps.map((step) => step.title));
  const newSteps = [] as Array<{
    tenantId: string;
    scenarioId: string;
    order: number;
    title: string;
    description: string;
    blocking: boolean;
  }>;

  for (const finding of findings) {
    for (const action of finding.recommendedActions) {
      const title = `Action simulée: ${action}`;
      if (existingTitles.has(title)) continue;
      nextOrder += 1;
      newSteps.push({
        tenantId,
        scenarioId,
        order: nextOrder,
        title,
        description: `Ajouté suite à la simulation (${finding.title}).`,
        blocking: false,
      });
      existingTitles.add(title);
    }
  }

  if (newSteps.length > 0) {
    await tx.runbookStep.createMany({ data: newSteps });
  }

  return newSteps.length;
}

export async function runCyberSimulation(
  tenantId: string,
  exerciseId: string,
  input: CyberSimulationInput
) {
  const exercise = await prisma.exercise.findFirst({
    where: { id: exerciseId, tenantId },
    include: { scenario: true },
  });

  if (!exercise) {
    throw new Error("Exercise not found");
  }

  const scenario = input.scenarioLibraryId
    ? getCyberScenarioById(input.scenarioLibraryId)
    : resolveCyberScenarioFromType(exercise.scenario?.type) ?? null;

  const connectorPayload = input.connectorUrl
    ? await fetchConnectorResults(input.connectorUrl, {
        ...sanitizeConnectorPayload(input),
        scenarioId: scenario?.id ?? null,
      })
    : null;

  const simulationResult = buildSimulationResult(scenario, input, connectorPayload);

  return prisma.$transaction(async (tx) => {
    const created = await tx.exerciseSimulation.create({
      data: {
        tenantId,
        exerciseId,
        simulator: input.simulator,
        connectorType: input.connectorType ?? null,
        status: "COMPLETED",
        configuration: {
          durationHours: input.durationHours ?? null,
          targets: input.targets,
          participants: input.participants,
          objectives: input.objectives,
          scenarioLibraryId: scenario?.id ?? null,
        },
        results: simulationResult,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    const riskIds = await applySimulationToRisks(
      tenantId,
      input.simulator,
      scenario,
      simulationResult.findings,
      tx
    );

    const runbookStepsAdded = await applySimulationToRunbookSteps(
      tenantId,
      exercise,
      simulationResult.findings,
      tx
    );

    return {
      simulation: created,
      riskIds,
      runbookStepsAdded,
      scenarioLibrary: scenario ?? CYBER_SCENARIOS[0] ?? null,
    };
  });
}

import prisma from "../prismaClient.js";
import { toPrismaJson } from "../utils/prismaJson.js";
import { getCyberScenarioDetails } from "./cyberScenarioService.js";
import type { CyberScenario } from "../scenarios/cyber/index.js";

export type CyberExerciseInput = {
  scenarioId: string;
  date: Date;
  participants: string[];
  simulator?: string | null;
  connectorUrl?: string | null;
  connectorType?: string | null;
};

type SimulationFinding = {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  indicators: string[];
  recommendedActions: string[];
};

type SimulationLogEntry = {
  timestamp: string;
  level: "info" | "warning" | "error";
  message: string;
};

const DEFAULT_FINDINGS: SimulationFinding[] = [
  {
    title: "Anomalies détectées",
    severity: "medium",
    description: "Signaux faibles observés durant la simulation.",
    indicators: ["Alertes SIEM", "Pics d'activité réseau"],
    recommendedActions: [
      "Analyser les alertes et corréler les événements.",
      "Documenter les points d'amélioration.",
    ],
  },
];

function buildScenarioFindings(scenario: CyberScenario): SimulationFinding[] {
  return scenario.responseActions.map((action, index) => ({
    title: `Action prioritaire ${index + 1}`,
    severity: index === 0 ? "high" : "medium",
    description: action,
    indicators: scenario.detection,
    recommendedActions: scenario.recoveryPlan,
  }));
}

function buildSimulationLogs(
  scenario: CyberScenario,
  simulator: string | null
): SimulationLogEntry[] {
  const now = new Date();
  return [
    {
      timestamp: now.toISOString(),
      level: "info",
      message: `Simulation ${scenario.name} démarrée (${simulator ?? "mock"}).`,
    },
    {
      timestamp: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      level: "warning",
      message: "Événement simulé déclenché sur l'environnement isolé.",
    },
    {
      timestamp: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      level: "info",
      message: "Collecte des observations et des métriques en cours.",
    },
  ];
}

function buildRunbook(scenario: CyberScenario, participants: string[]) {
  const steps = [
    ...scenario.incidentSteps.map((step, index) => ({
      order: index + 1,
      phase: "incident",
      title: step,
    })),
    ...scenario.responseActions.map((step, index) => ({
      order: scenario.incidentSteps.length + index + 1,
      phase: "response",
      title: step,
    })),
    ...scenario.recoveryPlan.map((step, index) => ({
      order: scenario.incidentSteps.length + scenario.responseActions.length + index + 1,
      phase: "recovery",
      title: step,
    })),
  ];

  return {
    title: `Runbook — ${scenario.name}`,
    scenarioId: scenario.id,
    participants,
    generatedAt: new Date().toISOString(),
    steps,
  };
}

function buildReport(
  scenario: CyberScenario,
  participants: string[],
  results: any
) {
  const metrics = results?.metrics ?? {};
  const findings = results?.findings ?? [];
  const gaps = findings.length
    ? findings.map((finding: SimulationFinding) => ({
        title: finding.title,
        gap: `Améliorer la capacité de réponse liée à: ${finding.description}`,
      }))
    : [
        {
          title: "Observation générale",
          gap: "Renforcer la coordination entre équipes IT et sécurité.",
        },
      ];

  const recommendations = scenario.recoveryPlan.length
    ? scenario.recoveryPlan
    : ["Renforcer les plans de reprise et les tests réguliers."];

  return {
    title: `Rapport d'exercice — ${scenario.name}`,
    scenarioId: scenario.id,
    bilan: {
      participants,
      findingsCount: findings.length,
      detectionRate: metrics.detectionRate ?? null,
      containmentTimeHours: metrics.containmentTimeHours ?? null,
      recoveryTimeHours: metrics.recoveryTimeHours ?? null,
    },
    gaps,
    recommendations,
    generatedAt: new Date().toISOString(),
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

function buildSimulationResults(
  scenario: CyberScenario,
  input: CyberExerciseInput,
  connectorPayload?: any
) {
  const findings = connectorPayload?.findings ??
    (scenario.responseActions.length > 0 ? buildScenarioFindings(scenario) : DEFAULT_FINDINGS);

  return {
    simulator: input.simulator ?? "mock",
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    participants: input.participants,
    findings,
    metrics: {
      detectionRate: connectorPayload?.metrics?.detectionRate ?? 0.8,
      containmentTimeHours: connectorPayload?.metrics?.containmentTimeHours ?? scenario.defaultDurationHours / 2,
      recoveryTimeHours: connectorPayload?.metrics?.recoveryTimeHours ?? scenario.defaultDurationHours,
    },
  };
}

export async function createCyberExercise(
  tenantId: string,
  input: CyberExerciseInput
) {
  const scenario = getCyberScenarioDetails(input.scenarioId);
  if (!scenario) {
    throw new Error("Scenario not found");
  }

  const connectorPayload = input.connectorUrl
    ? await fetchConnectorResults(input.connectorUrl, {
        scenarioId: scenario.id,
        participants: input.participants,
        simulator: input.simulator ?? "mock",
        connectorType: input.connectorType ?? null,
      })
    : null;

  const results = buildSimulationResults(scenario, input, connectorPayload);
  const logs = connectorPayload?.logs ?? buildSimulationLogs(scenario, input.simulator ?? null);
  const runbook = buildRunbook(scenario, input.participants);
  const report = buildReport(scenario, input.participants, results);

  const exercise = await prisma.cyberExercise.create({
    data: {
      tenantId,
      scenarioId: scenario.id,
      date: input.date,
      participants: input.participants,
      results: toPrismaJson(results),
      runbook: toPrismaJson(runbook),
      report: toPrismaJson(report),
      logs: toPrismaJson(logs),
      simulator: input.simulator ?? null,
    },
  });

  return exercise;
}

export async function updateCyberExercise(
  tenantId: string,
  exerciseId: string,
  data: {
    scenarioId?: string;
    date?: Date;
    participants?: string[];
    results?: any;
    runbook?: any;
    report?: any;
    logs?: any;
    simulator?: string | null;
  }
) {
  const existing = await prisma.cyberExercise.findFirst({
    where: { id: exerciseId, tenantId },
  });
  if (!existing) {
    throw new Error("Exercise not found");
  }

  let scenario = getCyberScenarioDetails(existing.scenarioId);
  if (data.scenarioId) {
    scenario = getCyberScenarioDetails(data.scenarioId);
    if (!scenario) {
      throw new Error("Scenario not found");
    }
  }

  const participants = data.participants ?? (existing.participants as string[]);
  const updatedRunbook = data.runbook ??
    (scenario ? buildRunbook(scenario, participants) : existing.runbook);
  const updatedReport = data.report ??
    (scenario ? buildReport(scenario, participants, data.results ?? existing.results) : existing.report);

  return prisma.cyberExercise.update({
    where: { id: exerciseId },
    data: {
      scenarioId: data.scenarioId ?? existing.scenarioId,
      date: data.date ?? existing.date,
      participants: participants,
      results: toPrismaJson(data.results ?? existing.results),
      runbook: toPrismaJson(updatedRunbook),
      report: toPrismaJson(updatedReport),
      logs: toPrismaJson(data.logs ?? existing.logs),
      simulator: data.simulator ?? existing.simulator,
    },
  });
}

export async function deleteCyberExercise(tenantId: string, exerciseId: string) {
  const existing = await prisma.cyberExercise.findFirst({
    where: { id: exerciseId, tenantId },
  });
  if (!existing) {
    throw new Error("Exercise not found");
  }
  await prisma.cyberExercise.delete({ where: { id: exerciseId } });
}

import type { InfraNode, Simulation } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

export type GeneratedRunbookStepType =
  | "manual"
  | "automated"
  | "decision"
  | "notification";

export interface GeneratedRunbookStep {
  order: number;
  title: string;
  description: string;
  type: GeneratedRunbookStepType;
  estimatedDurationMinutes: number;
  assignedRole: string;
  commands?: string[];
  verificationCheck?: string;
  rollbackInstructions?: string;
}

export interface GenerateRunbookFromSimulationInput {
  simulation: Pick<Simulation, "id" | "name" | "scenarioType" | "result" | "createdAt">;
  impactedNodes: Array<Pick<InfraNode, "id" | "name" | "type" | "provider" | "region">>;
  title?: string | null;
  description?: string | null;
  responsible?: string | null;
  accountable?: string | null;
  consulted?: string | null;
  informed?: string | null;
}

export interface GeneratedOperationalRunbook {
  title: string;
  description: string;
  steps: GeneratedRunbookStep[];
  responsible: string;
  accountable: string;
  consulted: string;
  informed: string;
  predictedRTO: number;
  predictedRPO: number;
}

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return fallback;
}

function buildCloudCommand(
  node: Pick<InfraNode, "name" | "type" | "provider" | "region">,
): string[] {
  const provider = node.provider.toLowerCase();
  const region = node.region || "<region>";

  if (provider === "aws") {
    if (node.type === "DATABASE") {
      return [
        `aws rds failover-db-cluster --db-cluster-identifier ${node.name}`,
        `aws rds describe-db-clusters --db-cluster-identifier ${node.name}`,
      ];
    }
    return [
      `aws cloudwatch describe-alarms --region ${region}`,
      `aws autoscaling start-instance-refresh --auto-scaling-group-name ${node.name}`,
    ];
  }

  if (provider === "azure") {
    return [
      `az monitor metrics list --resource ${node.name}`,
      `az vm restart --name ${node.name} --resource-group <resource-group>`,
    ];
  }

  if (provider === "gcp") {
    return [
      `gcloud monitoring time-series list --filter='metric.type=\"compute.googleapis.com/instance/cpu/utilization\"'`,
      `gcloud compute instances reset ${node.name} --zone <zone>`,
    ];
  }

  return [
    `kubectl get pods -A | findstr ${node.name}`,
    `kubectl rollout restart deployment/${node.name} -n <namespace>`,
  ];
}

function buildRecoverySubSteps(
  nodes: Array<Pick<InfraNode, "name" | "type" | "provider" | "region">>,
): string[] {
  if (nodes.length === 0) {
    return [
      "Identifier les composants indisponibles via la war room et appliquer le runbook de bascule standard.",
    ];
  }

  return nodes.slice(0, 5).map((node, index) => {
    return `${index + 1}. Restaurer ${node.name} (${node.type}) sur ${node.provider}.`;
  });
}

export const RunbookGeneratorService = {
  extractImpactedNodeIds(result: unknown): string[] {
    const payload = asRecord(result);
    const directlyAffected = asArray(payload.directlyAffected);
    const cascadeImpacted = asArray(payload.cascadeImpacted);

    const ids = [
      ...directlyAffected.map((item) => asString(asRecord(item).id)),
      ...cascadeImpacted.map((item) => asString(asRecord(item).id)),
    ].filter((id) => id.length > 0);

    return Array.from(new Set(ids));
  },

  extractPredictedRTO(result: unknown): number {
    const payload = asRecord(result);
    const metrics = asRecord(payload.metrics);
    return Math.max(1, asNumber(metrics.estimatedDowntimeMinutes, 240));
  },

  extractPredictedRPO(result: unknown): number {
    const payload = asRecord(result);
    const businessImpact = asArray(payload.businessImpact);
    if (businessImpact.length === 0) return 60;

    const rpos = businessImpact
      .map((entry) => asNumber(asRecord(entry).estimatedRPO, NaN))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (rpos.length === 0) return 60;
    const avg = rpos.reduce((sum, value) => sum + value, 0) / rpos.length;
    return Math.max(1, Math.round(avg));
  },

  generateFromSimulation(input: GenerateRunbookFromSimulationInput): GeneratedOperationalRunbook {
    const simulationName = input.simulation.name || input.simulation.scenarioType;
    const predictedRTO = this.extractPredictedRTO(input.simulation.result);
    const predictedRPO = this.extractPredictedRPO(input.simulation.result);
    const impactedNames = input.impactedNodes.map((node) => node.name).slice(0, 6);

    const recoveryCommands = input.impactedNodes.slice(0, 3).flatMap((node) => buildCloudCommand(node));

    const steps: GeneratedRunbookStep[] = [
      {
        order: 1,
        title: "Detection",
        description:
          "Confirmer l'incident via les alertes monitoring, logs applicatifs et dashboards d'observabilite.",
        type: "automated",
        estimatedDurationMinutes: 5,
        assignedRole: "SRE On-Call",
        commands: [
          "kubectl get events -A --sort-by=.lastTimestamp",
          "curl -s https://status.<votre-domaine>/health",
        ],
        verificationCheck:
          "L'incident est visible sur au moins 2 sources independantes (monitoring + logs).",
      },
      {
        order: 2,
        title: "Evaluation",
        description:
          `Evaluer l'impact technique et metier du scenario ${simulationName}. Composants prioritaires: ${impactedNames.join(", ") || "N/A"}.`,
        type: "manual",
        estimatedDurationMinutes: 10,
        assignedRole: "Incident Manager",
        verificationCheck:
          "La liste des services impactes et la fenetre RTO/RPO sont validees dans la war room.",
      },
      {
        order: 3,
        title: "Communication",
        description:
          "Declencher la communication RACI: information des stakeholders metier, support client et direction.",
        type: "notification",
        estimatedDurationMinutes: 5,
        assignedRole: "Crisis Communications Lead",
        commands: [
          "echo \"Incident majeur en cours - MEP cellule de crise\"",
        ],
      },
      {
        order: 4,
        title: "Recovery",
        description: [
          "Executer les actions de reprise technique selon la priorite.",
          ...buildRecoverySubSteps(input.impactedNodes),
        ].join("\n"),
        type: "automated",
        estimatedDurationMinutes: Math.max(15, predictedRTO),
        assignedRole: "Cloud Operations",
        commands: recoveryCommands,
        rollbackInstructions:
          "En cas d'echec de bascule, revenir au dernier snapshot valide puis escalader au responsable architecture.",
      },
      {
        order: 5,
        title: "Verification",
        description:
          "Verifier la restauration end-to-end: latence, erreurs, transactions, integrite des donnees, SLO/SLA.",
        type: "decision",
        estimatedDurationMinutes: 15,
        assignedRole: "Service Owner",
        verificationCheck:
          "Les indicateurs de disponibilite et d'integrite reviennent dans les seuils acceptables.",
      },
      {
        order: 6,
        title: "Post-mortem",
        description:
          "Documenter les causes racines, ecarts RTO/RPO, actions correctives et owners avec deadlines.",
        type: "manual",
        estimatedDurationMinutes: 20,
        assignedRole: "Reliability Lead",
      },
    ];

    return {
      title: input.title?.trim() || `Runbook - ${simulationName}`,
      description:
        input.description?.trim() ||
        `Runbook operationnel genere depuis la simulation ${simulationName} du ${input.simulation.createdAt.toISOString()}.`,
      steps,
      responsible: input.responsible?.trim() || "Cloud Operations",
      accountable: input.accountable?.trim() || "Head of Infrastructure",
      consulted: input.consulted?.trim() || "Security & Architecture",
      informed: input.informed?.trim() || "Executive Stakeholders",
      predictedRTO,
      predictedRPO,
    };
  },
};


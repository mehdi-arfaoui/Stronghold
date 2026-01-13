import type { CyberScenario } from "../scenarios/cyber/index.js";

export type ExerciseAssistantInput = {
  durationHours?: number | null;
  targets: string[];
  participants: string[];
  objectives: string[];
};

export type ExerciseAssistantReport = {
  title: string;
  scenarioName: string | null;
  durationHours: number;
  targets: string[];
  participants: string[];
  objectives: string[];
  timeline: string[];
  detectionFocus: string[];
  responseFocus: string[];
  recoveryFocus: string[];
  expectedImpacts: string[];
};

export function buildExerciseAssistantReport(
  scenario: CyberScenario | null,
  input: ExerciseAssistantInput,
  exerciseTitle: string
) {
  const duration = input.durationHours ?? scenario?.defaultDurationHours ?? 4;
  const scenarioName = scenario?.name ?? "Scénario cyber personnalisé";
  const timeline = [
    `Briefing initial et règles de l'exercice (15 min).`,
    `Phase d'exécution simulée (~${duration}h).`,
    "Débriefing et collecte des observations (30 min).",
    "Rétrospective et plan d'amélioration (30 min).",
  ];

  const objectives = input.objectives.length > 0
    ? input.objectives
    : [
        "Valider la détection et l'escalade SOC.",
        "Tester la coordination IT/Sécurité/Direction.",
        "Évaluer la capacité de reprise opérationnelle.",
      ];

  return {
    configuration: {
      durationHours: duration,
      targets: input.targets,
      participants: input.participants,
      objectives,
    },
    report: {
      title: `Rapport d'exercice — ${exerciseTitle}`,
      scenarioName,
      durationHours: duration,
      targets: input.targets,
      participants: input.participants,
      objectives,
      timeline,
      detectionFocus: scenario?.detection ?? ["Surveiller les signaux faibles et alertes clés."],
      responseFocus: scenario?.responseActions ?? ["Coordonner les cellules d'incident."],
      recoveryFocus: scenario?.recoveryPlan ?? ["Prioriser la restauration des services critiques."],
      expectedImpacts: scenario?.impacts ?? ["Impact opérationnel à qualifier pendant l'exercice."],
    } as ExerciseAssistantReport,
  };
}

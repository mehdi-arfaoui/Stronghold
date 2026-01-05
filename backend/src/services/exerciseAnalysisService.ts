export type ExerciseGap = {
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
  details?: Record<string, any>;
};

export type CorrectiveAction = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
};

export type ExerciseAnalysisInput = {
  resultStatus: string;
  rtoObservedHours: number | null;
  targetRtoHours: number | null;
  checklistTotal: number;
  checklistCompleted: number;
  incompleteChecklistTitles: string[];
};

export function buildExerciseAnalysis(input: ExerciseAnalysisInput) {
  const gaps: ExerciseGap[] = [];
  const correctiveActions: CorrectiveAction[] = [];

  if (input.resultStatus !== "success") {
    gaps.push({
      type: "RESULT_NOT_SUCCESS",
      severity: input.resultStatus === "failure" ? "high" : "medium",
      message: `L'exercice n'a pas abouti à un succès complet (statut: ${input.resultStatus}).`,
      details: { status: input.resultStatus },
    });
    correctiveActions.push({
      title: "Replanifier un test ciblé",
      description:
        "Programmer un nouvel exercice focalisé sur les étapes en échec et mobiliser les équipes concernées.",
      priority: "high",
    });
  }

  if (input.targetRtoHours !== null && input.rtoObservedHours !== null) {
    const delta = input.rtoObservedHours - input.targetRtoHours;
    if (delta > 0) {
      gaps.push({
        type: "RTO_EXCEEDED",
        severity: delta > 4 ? "high" : "medium",
        message: `Le RTO observé (${input.rtoObservedHours}h) dépasse la cible (${input.targetRtoHours}h).`,
        details: { targetRtoHours: input.targetRtoHours, rtoObservedHours: input.rtoObservedHours },
      });
      correctiveActions.push({
        title: "Optimiser la séquence de reprise",
        description:
          "Analyser les goulets d'étranglement et ajuster le runbook pour réduire la durée de reprise.",
        priority: delta > 4 ? "high" : "medium",
      });
    }
  }

  if (input.checklistTotal > 0 && input.checklistCompleted < input.checklistTotal) {
    const missingCount = input.checklistTotal - input.checklistCompleted;
    gaps.push({
      type: "CHECKLIST_INCOMPLETE",
      severity: missingCount > 3 ? "medium" : "low",
      message: `${missingCount} étape(s) de checklist n'ont pas été terminées pendant l'exercice.`,
      details: {
        total: input.checklistTotal,
        completed: input.checklistCompleted,
        missingTitles: input.incompleteChecklistTitles,
      },
    });
    correctiveActions.push({
      title: "Aligner les runbooks et la formation",
      description:
        "Mettre à jour les runbooks et organiser un briefing pour clarifier les étapes non réalisées.",
      priority: missingCount > 3 ? "medium" : "low",
    });
  }

  const summary =
    gaps.length === 0
      ? "Aucun écart majeur identifié, l'exercice est conforme aux objectifs."
      : `Écarts identifiés: ${gaps.length}. Actions correctives proposées: ${correctiveActions.length}.`;

  return { summary, gaps, correctiveActions };
}

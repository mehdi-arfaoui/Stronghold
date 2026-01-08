import type { HomeStep, HomeStepId } from "../home/HomePage";

interface AssistantPanelProps {
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  onStepAction?: (stepId: HomeStepId) => void;
}

export function AssistantPanel({
  steps,
  activeStepId,
  completedSteps,
  onStepAction,
}: AssistantPanelProps) {
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);
  const completedCount = completedSteps.length;
  const progressPercent = Math.min(100, Math.round((completedCount / steps.length) * 100));
  const nextStep =
    steps.find((step) => !completedSteps.includes(step.id)) || steps[steps.length - 1];
  const hasNextAction = nextStep && nextStep.id !== activeStepId;

  return (
    <aside className="assistant-panel" aria-live="polite">
      <div className="assistant-panel-header">
        <p className="assistant-eyebrow">Assistant</p>
        <h3>Votre parcours PRA</h3>
        <p className="muted">
          {completedCount}/{steps.length} étapes complétées · {progressPercent}% terminé
        </p>
      </div>

      <div className="assistant-progress">
        <div className="assistant-progress-bar" role="presentation">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {activeIndex !== -1 && (
        <div className="assistant-section">
          <p className="assistant-label">Étape en cours</p>
          <p className="assistant-title">{steps[activeIndex].title}</p>
          <p className="muted small">{steps[activeIndex].description}</p>
        </div>
      )}

      {nextStep && (
        <div className="assistant-section">
          <p className="assistant-label">Prochaine étape</p>
          <p className="assistant-title">{nextStep.title}</p>
          <p className="muted small">{nextStep.description}</p>
          {onStepAction && hasNextAction && (
            <button
              type="button"
              className="btn primary"
              onClick={() => onStepAction(nextStep.id)}
            >
              Passer à {nextStep.actionLabel.toLowerCase()}
            </button>
          )}
        </div>
      )}

      <div className="assistant-section">
        <p className="assistant-label">Conseil</p>
        <p className="muted small">
          Révisez les livrables à chaque étape pour assurer la cohérence des runbooks.
        </p>
      </div>
    </aside>
  );
}

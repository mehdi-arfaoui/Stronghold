import type { HomeStep, HomeStepId } from "../home/HomePage";
import type { TranslationCopy } from "../../i18n/translations";

interface AssistantPanelProps {
  copy: TranslationCopy;
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  onStepAction?: (stepId: HomeStepId) => void;
}

export function AssistantPanel({
  copy,
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
        <p className="assistant-eyebrow">{copy.assistantEyebrow}</p>
        <h3>{copy.assistantTitle}</h3>
        <p className="muted">
          {copy.assistantProgress(completedCount, steps.length, progressPercent)}
        </p>
      </div>

      <div className="assistant-progress">
        <div className="assistant-progress-bar" role="presentation">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {activeIndex !== -1 && (
        <div className="assistant-section">
          <p className="assistant-label">{copy.assistantCurrentStep}</p>
          <p className="assistant-title">{steps[activeIndex].title}</p>
          <p className="muted small">{steps[activeIndex].description}</p>
        </div>
      )}

      {nextStep && (
        <div className="assistant-section">
          <p className="assistant-label">{copy.assistantNextStep}</p>
          <p className="assistant-title">{nextStep.title}</p>
          <p className="muted small">{nextStep.description}</p>
          {onStepAction && hasNextAction && (
            <button
              type="button"
              className="btn primary"
              onClick={() => onStepAction(nextStep.id)}
            >
              {copy.assistantJumpTo(nextStep.actionLabel)}
            </button>
          )}
        </div>
      )}

      <div className="assistant-section">
        <p className="assistant-label">{copy.assistantAdviceTitle}</p>
        <p className="muted small">{copy.assistantAdviceBody}</p>
      </div>
    </aside>
  );
}

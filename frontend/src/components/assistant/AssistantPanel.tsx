import type { HomeStep, HomeStepId } from "../home/HomePage";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);
  const completedCount = completedSteps.length;
  const progressPercent = Math.min(100, Math.round((completedCount / steps.length) * 100));
  const nextStep =
    steps.find((step) => !completedSteps.includes(step.id)) || steps[steps.length - 1];
  const hasNextAction = nextStep && nextStep.id !== activeStepId;

  return (
    <aside className="assistant-panel" aria-live="polite">
      <div className="assistant-panel-header">
        <p className="assistant-eyebrow">{t("assistantEyebrow")}</p>
        <h3>{t("assistantTitle")}</h3>
        <p className="muted">
          {t("assistantProgress", {
            completed: completedCount,
            total: steps.length,
            percent: progressPercent,
          })}
        </p>
      </div>

      <div className="assistant-progress">
        <div className="assistant-progress-bar" role="presentation">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {activeIndex !== -1 && (
        <div className="assistant-section">
          <p className="assistant-label">{t("assistantCurrentStep")}</p>
          <p className="assistant-title">{steps[activeIndex].title}</p>
          <p className="muted small">{steps[activeIndex].description}</p>
        </div>
      )}

      {nextStep && (
        <div className="assistant-section">
          <p className="assistant-label">{t("assistantNextStep")}</p>
          <p className="assistant-title">{nextStep.title}</p>
          <p className="muted small">{nextStep.description}</p>
          {onStepAction && hasNextAction && (
            <button
              type="button"
              className="btn primary"
              onClick={() => onStepAction(nextStep.id)}
            >
              {t("assistantJumpTo", { actionLabel: nextStep.actionLabel })}
            </button>
          )}
        </div>
      )}

      <div className="assistant-section">
        <p className="assistant-label">{t("assistantAdviceTitle")}</p>
        <p className="muted small">{t("assistantAdviceBody")}</p>
      </div>
    </aside>
  );
}

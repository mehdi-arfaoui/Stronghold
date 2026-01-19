import type { HomeStep, HomeStepId } from "../home/HomePage";
import { useTranslation } from "react-i18next";

interface WizardProgressProps {
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  maxAllowedIndex: number;
  onStepAction: (stepId: HomeStepId) => void;
}

export function WizardProgress({
  steps,
  activeStepId,
  completedSteps,
  maxAllowedIndex,
  onStepAction,
}: WizardProgressProps) {
  const { t } = useTranslation();
  const completedCount = completedSteps.length;
  const progressPercent = Math.min(100, Math.round((completedCount / steps.length) * 100));

  return (
    <section className="wizard-progress" aria-labelledby="wizard-progress-title">
      <div className="wizard-progress-header">
        <p className="eyebrow">{t("guidedJourney")}</p>
        <h3 id="wizard-progress-title">{t("progressTitle")}</h3>
        <p className="muted small">
          {t("progressSummary", { completed: completedCount, total: steps.length })}
        </p>
      </div>
      <div
        className="wizard-progress-bar"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("progressTitle")}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <ol className="wizard-progress-steps">
        {steps.map((step, index) => {
          const isCompleted = completedSteps.includes(step.id);
          const isActive = step.id === activeStepId;
          const isLocked = index > maxAllowedIndex;
          const statusLabel = isCompleted ? "✓" : `${index + 1}`;
          const statusText = isCompleted
            ? t("wizardStatusComplete")
            : isActive
            ? t("wizardStatusActive")
            : t("wizardStatusPending");
          return (
            <li key={step.id} className={isCompleted ? "completed" : isLocked ? "locked" : undefined}>
              <button
                type="button"
                className={`wizard-step ${isActive ? "active" : ""}`}
                onClick={() => onStepAction(step.id)}
                aria-current={isActive ? "step" : undefined}
                disabled={isLocked}
                aria-disabled={isLocked}
              >
                <span className="wizard-step-index" aria-hidden="true">
                  {statusLabel}
                </span>
                <span className="wizard-step-label">
                  <span>{step.title}</span>
                  <span className="muted small">{statusText}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

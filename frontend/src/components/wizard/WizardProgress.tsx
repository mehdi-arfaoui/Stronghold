import type { HomeStep, HomeStepId } from "../home/HomePage";
import type { TranslationCopy } from "../../i18n/translations";

interface WizardProgressProps {
  copy: TranslationCopy;
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  onStepAction: (stepId: HomeStepId) => void;
}

export function WizardProgress({
  copy,
  steps,
  activeStepId,
  completedSteps,
  onStepAction,
}: WizardProgressProps) {
  const completedCount = completedSteps.length;
  const progressPercent = Math.min(100, Math.round((completedCount / steps.length) * 100));

  return (
    <section className="wizard-progress" aria-labelledby="wizard-progress-title">
      <div className="wizard-progress-header">
        <p className="eyebrow">{copy.guidedJourney}</p>
        <h3 id="wizard-progress-title">{copy.progressTitle}</h3>
        <p className="muted small">{copy.progressSummary(completedCount, steps.length)}</p>
      </div>
      <div
        className="wizard-progress-bar"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={copy.progressTitle}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <ol className="wizard-progress-steps">
        {steps.map((step, index) => {
          const isCompleted = completedSteps.includes(step.id);
          const isActive = step.id === activeStepId;
          const statusLabel = isCompleted ? "✓" : `${index + 1}`;
          const statusText = isCompleted
            ? copy.wizardStatusComplete
            : isActive
            ? copy.wizardStatusActive
            : copy.wizardStatusPending;
          return (
            <li key={step.id} className={isCompleted ? "completed" : undefined}>
              <button
                type="button"
                className={`wizard-step ${isActive ? "active" : ""}`}
                onClick={() => onStepAction(step.id)}
                aria-current={isActive ? "step" : undefined}
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

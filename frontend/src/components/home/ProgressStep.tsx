interface ProgressStepProps {
  stepId: string;
  title: string;
  description: string;
  actionLabel: string;
  tagCompleteLabel: string;
  tagPendingLabel: string;
  completedLabel: string;
  isActive: boolean;
  isComplete: boolean;
  onAction: (stepId: string) => void;
}

export function ProgressStep({
  stepId,
  title,
  description,
  actionLabel,
  tagCompleteLabel,
  tagPendingLabel,
  completedLabel,
  isActive,
  isComplete,
  onAction,
}: ProgressStepProps) {
  return (
    <article
      className={`progress-step ${isActive ? "active" : ""} ${
        isComplete ? "complete" : ""
      }`}
      aria-current={isActive ? "step" : undefined}
    >
      <div className="progress-step-header">
        <span className="progress-step-tag">
          {isComplete ? tagCompleteLabel : tagPendingLabel}
        </span>
        <span className="progress-step-title">{title}</span>
      </div>
      <p className="progress-step-description">{description}</p>
      <div className="progress-step-actions">
        <button type="button" className="btn primary" onClick={() => onAction(stepId)}>
          {actionLabel}
        </button>
        {isComplete ? <span className="progress-step-status">{completedLabel}</span> : null}
      </div>
    </article>
  );
}

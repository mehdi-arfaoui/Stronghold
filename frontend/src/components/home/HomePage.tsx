import { ProgressStep } from "./ProgressStep";
import type { TranslationCopy } from "../../i18n/translations";

export type HomeStepId =
  | "discovery"
  | "documents"
  | "rag"
  | "bia"
  | "risks"
  | "scenarios"
  | "runbooks"
  | "analysis";

export type HomeStep = {
  id: HomeStepId;
  title: string;
  description: string;
  actionLabel: string;
};

interface HomePageProps {
  copy: TranslationCopy;
  eyebrow: string;
  title: string;
  subtitle: string;
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  maxAllowedIndex: number;
  onStepAction: (stepId: HomeStepId) => void;
}

export function HomePage({
  copy,
  eyebrow,
  title,
  subtitle,
  steps,
  activeStepId,
  completedSteps,
  maxAllowedIndex,
  onStepAction,
}: HomePageProps) {
  return (
    <div className="home-content">
      <header className="home-header">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="home-title" className="home-title">
          {title}
        </h1>
        <p className="home-subtitle">{subtitle}</p>
      </header>

      <div className="home-grid">
        {steps.map((step, index) => (
          <ProgressStep
            key={step.id}
            stepId={step.id}
            title={`${index + 1}. ${step.title}`}
            description={step.description}
            actionLabel={step.actionLabel}
            tagCompleteLabel={copy.progressStepTagComplete}
            tagPendingLabel={copy.progressStepTagPending}
            completedLabel={copy.progressStepCompleted}
            isActive={activeStepId === step.id}
            isComplete={completedSteps.includes(step.id)}
            isLocked={index > maxAllowedIndex}
            onAction={onStepAction}
          />
        ))}
      </div>
    </div>
  );
}

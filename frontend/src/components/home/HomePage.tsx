import { ProgressStep } from "./ProgressStep";
import { useTranslation } from "react-i18next";

export type HomeStepId =
  | "discovery"
  | "services"
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
  eyebrow,
  title,
  subtitle,
  steps,
  activeStepId,
  completedSteps,
  maxAllowedIndex,
  onStepAction,
}: HomePageProps) {
  const { t } = useTranslation();
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
            tagCompleteLabel={t("progressStepTagComplete")}
            tagPendingLabel={t("progressStepTagPending")}
            completedLabel={t("progressStepCompleted")}
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

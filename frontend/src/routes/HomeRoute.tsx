import { AssistantPanel } from "../components/assistant/AssistantPanel";
import type { HomeStepId } from "../components/home/HomePage";
import { HomePage } from "../components/home/HomePage";
import type { HomeStep } from "../components/home/HomePage";
import { useTranslation } from "react-i18next";

interface HomeRouteProps {
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  maxAllowedIndex: number;
  onStepAction: (stepId: HomeStepId) => void;
}

export function HomeRoute({
  steps,
  activeStepId,
  completedSteps,
  maxAllowedIndex,
  onStepAction,
}: HomeRouteProps) {
  const { t } = useTranslation();
  return (
    <section id="home" className="home-section" aria-labelledby="home-title">
      <div className="home-layout">
        <HomePage
          eyebrow={t("homeEyebrow")}
          title={t("homeTitle")}
          subtitle={t("homeSubtitle")}
          steps={steps}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          maxAllowedIndex={maxAllowedIndex}
          onStepAction={onStepAction}
        />
        <AssistantPanel
          steps={steps}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          onStepAction={onStepAction}
        />
      </div>
    </section>
  );
}

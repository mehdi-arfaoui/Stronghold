import { AssistantPanel } from "../components/assistant/AssistantPanel";
import type { HomeStepId } from "../components/home/HomePage";
import { HomePage } from "../components/home/HomePage";
import type { TranslationCopy } from "../i18n/translations";
import type { HomeStep } from "../components/home/HomePage";

interface HomeRouteProps {
  copy: TranslationCopy;
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  maxAllowedIndex: number;
  onStepAction: (stepId: HomeStepId) => void;
}

export function HomeRoute({
  copy,
  steps,
  activeStepId,
  completedSteps,
  maxAllowedIndex,
  onStepAction,
}: HomeRouteProps) {
  return (
    <section id="home" className="home-section" aria-labelledby="home-title">
      <div className="home-layout">
        <HomePage
          copy={copy}
          eyebrow={copy.homeEyebrow}
          title={copy.homeTitle}
          subtitle={copy.homeSubtitle}
          steps={steps}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          maxAllowedIndex={maxAllowedIndex}
          onStepAction={onStepAction}
        />
        <AssistantPanel
          copy={copy}
          steps={steps}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          onStepAction={onStepAction}
        />
      </div>
    </section>
  );
}

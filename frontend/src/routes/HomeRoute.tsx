import { AssistantPanel } from "../components/assistant/AssistantPanel";
import type { HomeStepId } from "../components/home/HomePage";
import { HomePage, HOME_STEPS } from "../components/home/HomePage";

interface HomeRouteProps {
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  onStepAction: (stepId: HomeStepId) => void;
}

export function HomeRoute({ activeStepId, completedSteps, onStepAction }: HomeRouteProps) {
  return (
    <section id="home" className="home-section" aria-labelledby="home-title">
      <div className="home-layout">
        <HomePage
          title="Premiers pas vers la résilience"
          subtitle="Suivez ces étapes guidées pour cartographier vos services, réaliser le BIA, évaluer les risques et produire vos runbooks."
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          onStepAction={onStepAction}
        />
        <AssistantPanel
          steps={HOME_STEPS}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          onStepAction={onStepAction}
        />
      </div>
    </section>
  );
}

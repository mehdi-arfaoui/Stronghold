import type { HomeStepId } from "../components/home/HomePage";
import { HomePage } from "../components/home/HomePage";

interface HomeRouteProps {
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  onStepAction: (stepId: HomeStepId) => void;
}

export function HomeRoute({ activeStepId, completedSteps, onStepAction }: HomeRouteProps) {
  return (
    <section id="home" className="home-section" aria-labelledby="home-title">
      <HomePage
        title="Premiers pas vers la résilience"
        subtitle="Suivez ces étapes guidées pour structurer vos services, alimenter le moteur RAG/PRA et générer des recommandations actionnables."
        activeStepId={activeStepId}
        completedSteps={completedSteps}
        onStepAction={onStepAction}
      />
    </section>
  );
}

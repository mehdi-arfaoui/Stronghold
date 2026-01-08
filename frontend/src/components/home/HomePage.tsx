import { ProgressStep } from "./ProgressStep";

export type HomeStepId =
  | "services"
  | "documents"
  | "bia"
  | "risks"
  | "scenarios"
  | "analysis"
  | "runbooks";

export type HomeStep = {
  id: HomeStepId;
  title: string;
  description: string;
  actionLabel: string;
};

export const HOME_STEPS: HomeStep[] = [
  {
    id: "services" as const,
    title: "Cartographier les services",
    description:
      "Structurez le catalogue applicatif, les dépendances et la criticité métier.",
    actionLabel: "Créer un service",
  },
  {
    id: "documents" as const,
    title: "Centraliser les documents",
    description:
      "Importez procédures et schémas pour alimenter les analyses BIA et risques.",
    actionLabel: "Importer un document",
  },
  {
    id: "bia" as const,
    title: "Conduire le BIA",
    description:
      "Définissez les processus critiques et mesurez les impacts métier.",
    actionLabel: "Accéder au BIA",
  },
  {
    id: "risks" as const,
    title: "Qualifier les risques",
    description:
      "Analysez les menaces, probabilités et impacts pour chaque processus.",
    actionLabel: "Ouvrir les risques",
  },
  {
    id: "scenarios" as const,
    title: "Construire les scénarios",
    description:
      "Planifiez les stratégies de reprise et les étapes de crise.",
    actionLabel: "Créer un scénario",
  },
  {
    id: "analysis" as const,
    title: "Produire le rapport PRA",
    description:
      "Générez les analyses consolidées et les synthèses décisionnelles.",
    actionLabel: "Voir le rapport",
  },
  {
    id: "runbooks" as const,
    title: "Finaliser les runbooks",
    description:
      "Publiez les procédures opérationnelles et partagez-les aux équipes.",
    actionLabel: "Accéder aux runbooks",
  },
];

interface HomePageProps {
  title: string;
  subtitle: string;
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  onStepAction: (stepId: HomeStepId) => void;
}

export function HomePage({
  title,
  subtitle,
  activeStepId,
  completedSteps,
  onStepAction,
}: HomePageProps) {
  return (
    <div className="home-content">
      <header className="home-header">
        <p className="eyebrow">Accueil</p>
        <h1 id="home-title" className="home-title">
          {title}
        </h1>
        <p className="home-subtitle">{subtitle}</p>
      </header>

      <div className="home-grid">
        {HOME_STEPS.map((step, index) => (
          <ProgressStep
            key={step.id}
            stepId={step.id}
            title={`${index + 1}. ${step.title}`}
            description={step.description}
            actionLabel={step.actionLabel}
            isActive={activeStepId === step.id}
            isComplete={completedSteps.includes(step.id)}
            onAction={onStepAction}
          />
        ))}
      </div>
    </div>
  );
}

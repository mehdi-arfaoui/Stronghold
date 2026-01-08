import { ProgressStep } from "./ProgressStep";

type StepId = "services" | "documents" | "rag" | "runbooks";

const steps = [
  {
    id: "services" as const,
    title: "Créer les services",
    description:
      "Construisez votre catalogue applicatif avec criticité, dépendances et propriétaires.",
    actionLabel: "Ajouter un service",
  },
  {
    id: "documents" as const,
    title: "Importer des documents",
    description:
      "Centralisez les procédures, contrats et schémas afin d'alimenter l'intelligence RAG.",
    actionLabel: "Importer un document",
  },
  {
    id: "rag" as const,
    title: "Lancer l'analyse RAG/PRA",
    description:
      "Activez les analyses IA pour extraire les faits clés et préparer les scénarios PRA.",
    actionLabel: "Lancer l'analyse",
  },
  {
    id: "runbooks" as const,
    title: "Consulter les recommandations",
    description:
      "Accédez aux runbooks générés et ajustez les stratégies de reprise.",
    actionLabel: "Voir les runbooks",
  },
];

interface HomePageProps {
  title: string;
  subtitle: string;
  activeStepId: StepId;
  completedSteps: StepId[];
  onStepAction: (stepId: StepId) => void;
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
        {steps.map((step, index) => (
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

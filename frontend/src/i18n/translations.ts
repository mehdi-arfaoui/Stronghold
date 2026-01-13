export type Language = "fr" | "en";

export type TranslationCopy = {
  appName: string;
  skipToContent: string;
  quickAction: string;
  navigation: string;
  guidedJourney: string;
  themeLabel: string;
  languageLabel: string;
  lightMode: string;
  darkMode: string;
  sidebarTitle: string;
  progressTitle: string;
  progressSummary: (completed: number, total: number) => string;
  homeEyebrow: string;
  homeTitle: string;
  homeSubtitle: string;
  assistantTitle: string;
  assistantProgress: (completed: number, total: number, percent: number) => string;
  assistantCurrentStep: string;
  assistantNextStep: string;
  assistantAdviceTitle: string;
  assistantAdviceBody: string;
  assistantJumpTo: (actionLabel: string) => string;
  assistantEyebrow: string;
  navigationTitle: string;
  navigationSubtitle: string;
  navigationEyebrow: string;
  navigationWizardTitle: string;
  navigationWizardDescription: string;
  navigationCatalogTitle: string;
  navigationCatalogDescription: string;
  navigationDomainLabel: string;
  navigationSearchLabel: string;
  navigationSearchPlaceholder: string;
  navigationEmptyState: string;
  navigationGroupEmptyState: string;
  configurationTitle: string;
  configurationSubtitle: string;
  configurationBody: string;
  configurationCardTitle: string;
  configurationCardDescription: string;
  wizardStatusComplete: string;
  wizardStatusActive: string;
  wizardStatusPending: string;
  closeLabel: string;
  footerTitle: string;
  footerDescription: string;
  footerNavLabel: string;
  progressStepTagComplete: string;
  progressStepTagPending: string;
  progressStepCompleted: string;
};

export type ModuleLabel = {
  label: string;
  description: string;
};

export type GroupLabel = {
  label: string;
  description: string;
};

export const TRANSLATIONS: Record<Language, TranslationCopy> = {
  fr: {
    appName: "Stronghold",
    skipToContent: "Aller au contenu principal",
    quickAction: "Démarrer un PRA",
    navigation: "Navigation",
    guidedJourney: "Parcours guidé",
    themeLabel: "Thème",
    languageLabel: "Langue",
    lightMode: "Clair",
    darkMode: "Sombre",
    sidebarTitle: "Navigation principale",
    progressTitle: "Progression du parcours",
    progressSummary: (completed, total) => `${completed}/${total} étapes complétées`,
    homeEyebrow: "Accueil",
    homeTitle: "Premiers pas vers la résilience",
    homeSubtitle:
      "Suivez ce parcours guidé pour aller de la découverte à la classification documentaire, puis jusqu'au rapport PRA.",
    assistantTitle: "Votre parcours PRA",
    assistantProgress: (completed, total, percent) =>
      `${completed}/${total} étapes complétées · ${percent}% terminé`,
    assistantCurrentStep: "Étape en cours",
    assistantNextStep: "Prochaine étape",
    assistantAdviceTitle: "Conseil",
    assistantAdviceBody:
      "Révisez les livrables à chaque étape pour assurer la cohérence des runbooks.",
    assistantJumpTo: (actionLabel) => `Passer à ${actionLabel.toLowerCase()}`,
    assistantEyebrow: "Assistant",
    navigationTitle: "Vue d'ensemble",
    navigationSubtitle:
      "Suivez le parcours guidé et avancez étape par étape sans navigation libre.",
    navigationEyebrow: "Navigation",
    navigationWizardTitle: "Avancez étape par étape",
    navigationWizardDescription: "Suivez le flux recommandé pour générer votre PRA complet.",
    navigationCatalogTitle: "Catalogue regroupé",
    navigationCatalogDescription: "Explorez les modules par grands ensembles fonctionnels.",
    navigationDomainLabel: "étapes",
    navigationSearchLabel: "Rechercher un module",
    navigationSearchPlaceholder: "Rechercher un module",
    navigationEmptyState: "Aucun module ne correspond à cette recherche.",
    navigationGroupEmptyState: "Aucun groupe ne correspond à cette recherche.",
    configurationTitle: "Configuration",
    configurationSubtitle: "Connexion API",
    configurationBody:
      "Renseignez l'URL et la clé API pour activer les workflows Stronghold.",
    configurationCardTitle: "Connexion API",
    configurationCardDescription:
      "Paramétrez l'URL et la clé API pour débloquer les analyses et exports.",
    wizardStatusComplete: "Terminé",
    wizardStatusActive: "En cours",
    wizardStatusPending: "À venir",
    closeLabel: "Fermer",
    footerTitle: "Stronghold PRA/PCA",
    footerDescription:
      "Plateforme de résilience et d'analyse continue pour les organisations critiques.",
    footerNavLabel: "Navigation secondaire",
    progressStepTagComplete: "Terminé",
    progressStepTagPending: "Étape",
    progressStepCompleted: "Complété",
  },
  en: {
    appName: "Stronghold",
    skipToContent: "Skip to main content",
    quickAction: "Start a DRP",
    navigation: "Navigation",
    guidedJourney: "Guided journey",
    themeLabel: "Theme",
    languageLabel: "Language",
    lightMode: "Light",
    darkMode: "Dark",
    sidebarTitle: "Primary navigation",
    progressTitle: "Journey progress",
    progressSummary: (completed, total) => `${completed}/${total} steps completed`,
    homeEyebrow: "Home",
    homeTitle: "First steps to resilience",
    homeSubtitle:
      "Follow this guided path from discovery to document classification, then to your DRP report.",
    assistantTitle: "Your DRP journey",
    assistantProgress: (completed, total, percent) =>
      `${completed}/${total} steps completed · ${percent}% done`,
    assistantCurrentStep: "Current step",
    assistantNextStep: "Next step",
    assistantAdviceTitle: "Tip",
    assistantAdviceBody:
      "Review deliverables at each step to keep runbooks consistent and actionable.",
    assistantJumpTo: (actionLabel) => `Jump to ${actionLabel.toLowerCase()}`,
    assistantEyebrow: "Assistant",
    navigationTitle: "Overview",
    navigationSubtitle: "Follow the guided steps and move forward without free tab hopping.",
    navigationEyebrow: "Navigation",
    navigationWizardTitle: "Move forward step by step",
    navigationWizardDescription: "Follow the recommended flow to build a complete DRP.",
    navigationCatalogTitle: "Grouped catalog",
    navigationCatalogDescription: "Explore modules grouped by functional domains.",
    navigationDomainLabel: "steps",
    navigationSearchLabel: "Search for a module",
    navigationSearchPlaceholder: "Search for a module",
    navigationEmptyState: "No modules match this search.",
    navigationGroupEmptyState: "No groups match this search.",
    configurationTitle: "Configuration",
    configurationSubtitle: "API connection",
    configurationBody: "Provide the API URL and key to activate Stronghold workflows.",
    configurationCardTitle: "API connection",
    configurationCardDescription:
      "Set the API URL and key to unlock analysis and exports.",
    wizardStatusComplete: "Completed",
    wizardStatusActive: "In progress",
    wizardStatusPending: "Upcoming",
    closeLabel: "Close",
    footerTitle: "Stronghold DRP/BCP",
    footerDescription: "Resilience platform for continuous analysis in critical organizations.",
    footerNavLabel: "Secondary navigation",
    progressStepTagComplete: "Done",
    progressStepTagPending: "Step",
    progressStepCompleted: "Completed",
  },
};

export const MODULE_LABELS: Record<Language, Record<string, ModuleLabel>> = {
  fr: {
    services: { label: "Services", description: "Catalogue et criticité" },
    discovery: { label: "Découverte", description: "Scan réseau & imports" },
    architecture: { label: "Architecture", description: "Vue d'ensemble" },
    landing: { label: "Landing Zone", description: "Infrastructure" },
    graph: { label: "Graphes", description: "Dépendances" },
    continuity: { label: "Continuité", description: "Sauvegardes & politiques" },
    documents: { label: "Documents", description: "Upload & extraction" },
    rag: { label: "Classification", description: "Qualification documentaire" },
    bia: { label: "BIA", description: "Processus & impacts" },
    risks: { label: "Risques", description: "Menaces & matrices" },
    analysis: { label: "Analyse PRA", description: "Contrôles et risques" },
    scenarios: { label: "Scénarios", description: "Runbooks" },
    runbooks: { label: "Runbooks", description: "Génération & exports" },
    incidents: { label: "Incidents", description: "Crises & notifications" },
    auth: { label: "Auth (ADMIN)", description: "Gestion des clés API (ADMIN only)" },
    audit: { label: "Audit (ADMIN)", description: "Historique des appels API" },
  },
  en: {
    services: { label: "Services", description: "Catalog and criticality" },
    discovery: { label: "Discovery", description: "Network scan & imports" },
    architecture: { label: "Architecture", description: "Overview" },
    landing: { label: "Landing Zone", description: "Infrastructure" },
    graph: { label: "Graphs", description: "Dependencies" },
    continuity: { label: "Continuity", description: "Backups & policies" },
    documents: { label: "Documents", description: "Uploads & extraction" },
    rag: { label: "Classification", description: "Document qualification" },
    bia: { label: "BIA", description: "Processes & impacts" },
    risks: { label: "Risks", description: "Threats & matrices" },
    analysis: { label: "DRP analysis", description: "Controls and risks" },
    scenarios: { label: "Scenarios", description: "Runbooks" },
    runbooks: { label: "Runbooks", description: "Generation & exports" },
    incidents: { label: "Incidents", description: "Crises & notifications" },
    auth: { label: "Auth (ADMIN)", description: "API key management (ADMIN only)" },
    audit: { label: "Audit (ADMIN)", description: "API call history" },
  },
};

export const MODULE_GROUP_LABELS: Record<Language, Record<string, GroupLabel>> = {
  fr: {
    "services-infra": {
      label: "Services + Infrastructure",
      description: "Cartographie des services et fondations techniques.",
    },
    "documents-ai": {
      label: "Documents + IA",
      description: "Collecte documentaire et moteur RAG.",
    },
    "analyses-risks": {
      label: "Analyses BIA + Risques",
      description: "Impacts métiers, menaces et rapports PRA.",
    },
    "scenarios-runbooks": {
      label: "Scénarios + Runbooks",
      description: "Plans d'action et orchestration de crise.",
    },
    incidents: {
      label: "Incidents",
      description: "Gestion de crise et communications.",
    },
    administration: {
      label: "Administration",
      description: "Accès, audit et conformité.",
    },
    wizard: {
      label: "Parcours guidé",
      description: "Suivez l'ordre recommandé pour construire votre PRA.",
    },
    general: {
      label: "Général",
      description: "Navigation de base.",
    },
  },
  en: {
    "services-infra": {
      label: "Services + Infrastructure",
      description: "Service mapping and technical foundations.",
    },
    "documents-ai": {
      label: "Documents + AI",
      description: "Document collection and RAG engine.",
    },
    "analyses-risks": {
      label: "BIA + Risks analysis",
      description: "Business impacts, threats, and DRP reports.",
    },
    "scenarios-runbooks": {
      label: "Scenarios + Runbooks",
      description: "Action plans and crisis orchestration.",
    },
    incidents: {
      label: "Incidents",
      description: "Crisis management and communications.",
    },
    administration: {
      label: "Administration",
      description: "Access, audit, and compliance.",
    },
    wizard: {
      label: "Guided journey",
      description: "Follow the recommended order to build your DRP.",
    },
    general: {
      label: "General",
      description: "Base navigation.",
    },
  },
};

export const GENERAL_NAV_LABELS: Record<Language, Record<string, string>> = {
  fr: {
    home: "Accueil",
    configuration: "Configuration",
    navigation: "Navigation",
  },
  en: {
    home: "Home",
    configuration: "Configuration",
    navigation: "Navigation",
  },
};

export const HOME_STEP_CONTENT: Record<Language, Record<string, { title: string; description: string; actionLabel: string }>> = {
  fr: {
    documents: {
      title: "Centraliser les documents",
      description:
        "Importez procédures et schémas pour alimenter les analyses BIA et risques.",
      actionLabel: "Importer un document",
    },
    discovery: {
      title: "Découvrir l'architecture",
      description:
        "Scannez le réseau ou importez la CMDB pour enrichir les dépendances et services.",
      actionLabel: "Lancer une découverte",
    },
    rag: {
      title: "Classifier les documents",
      description:
        "Posez les bonnes questions et organisez les preuves pour alimenter les analyses.",
      actionLabel: "Lancer la classification",
    },
    bia: {
      title: "Conduire le BIA",
      description: "Définissez les processus critiques et mesurez les impacts métier.",
      actionLabel: "Accéder au BIA",
    },
    risks: {
      title: "Qualifier les risques",
      description:
        "Analysez les menaces, probabilités et impacts pour chaque processus.",
      actionLabel: "Ouvrir les risques",
    },
    scenarios: {
      title: "Construire les scénarios",
      description: "Planifiez les stratégies de reprise et les étapes de crise.",
      actionLabel: "Créer un scénario",
    },
    runbooks: {
      title: "Finaliser les runbooks",
      description:
        "Publiez les procédures opérationnelles et partagez-les aux équipes.",
      actionLabel: "Accéder aux runbooks",
    },
    analysis: {
      title: "Produire le rapport PRA",
      description: "Générez les analyses consolidées et les synthèses décisionnelles.",
      actionLabel: "Voir le rapport",
    },
  },
  en: {
    documents: {
      title: "Centralize documents",
      description: "Import procedures and diagrams to fuel BIA and risk analysis.",
      actionLabel: "Import a document",
    },
    discovery: {
      title: "Discover the architecture",
      description:
        "Scan the network or import CMDB exports to enrich dependencies and services.",
      actionLabel: "Run discovery",
    },
    rag: {
      title: "Classify documents",
      description: "Ask the right questions and organize evidence for downstream analysis.",
      actionLabel: "Start classification",
    },
    bia: {
      title: "Conduct the BIA",
      description: "Define critical processes and quantify business impacts.",
      actionLabel: "Go to BIA",
    },
    risks: {
      title: "Qualify risks",
      description: "Analyze threats, probabilities, and impacts for each process.",
      actionLabel: "Open risks",
    },
    scenarios: {
      title: "Build scenarios",
      description: "Plan recovery strategies and crisis steps.",
      actionLabel: "Create a scenario",
    },
    runbooks: {
      title: "Finalize runbooks",
      description: "Publish operational procedures and share them with teams.",
      actionLabel: "Access runbooks",
    },
    analysis: {
      title: "Produce the DRP report",
      description: "Generate consolidated analyses and decision-ready summaries.",
      actionLabel: "View the report",
    },
  },
};

import { useEffect, useMemo, useState } from "react";
import { ConfigBanner } from "./components/config/ConfigBanner";
import { Footer } from "./components/layout/Footer";
import { Header } from "./components/navigation/Header";
import type { NavLink } from "./components/navigation/NavMenu";
import { SectionCard } from "./components/ui/SectionCard";
import { HomePage } from "./components/home/HomePage";
import { InfoBadge } from "./components/ui/InfoBadge";
import { TabNavigation } from "./components/navigation/TabNavigation";
import { SERVICE_DOMAINS } from "./constants/domains";
import { AnalysisSection } from "./sections/AnalysisSection";
import { AuthSection } from "./sections/AuthSection";
import { AuditLogsSection } from "./sections/AuditLogsSection";
import { ArchitectureSection } from "./sections/ArchitectureSection";
import { DocumentsSection } from "./sections/DocumentsSection";
import { DiscoverySection } from "./sections/DiscoverySection";
import { GraphSection } from "./sections/GraphSection";
import { LandingZoneSection } from "./sections/LandingZoneSection";
import { RagSection } from "./sections/RagSection";
import { RunbooksSection } from "./sections/RunbooksSection";
import { ScenariosSection } from "./sections/ScenariosSection";
import { ServicesSection } from "./sections/ServicesSection";
import { ContinuitySection } from "./sections/ContinuitySection";
import { RisksSection } from "./sections/RisksSection";
import { BiaSection } from "./sections/BiaSection";
import { IncidentsSection } from "./sections/IncidentsSection";
import type { ApiConfig, TabDefinition, TabId } from "./types";
import { loadApiConfig } from "./utils/api";

const tabs: TabDefinition[] = [
  { id: "services", label: "Services", description: "Catalogue et criticité" },
  { id: "continuity", label: "Continuité", description: "Sauvegardes & politiques" },
  { id: "bia", label: "BIA", description: "Processus & impacts" },
  { id: "incidents", label: "Incidents", description: "Crises & notifications" },
  { id: "documents", label: "Documents", description: "Upload & extraction" },
  { id: "discovery", label: "Découverte", description: "Scan réseau & imports" },
  { id: "rag", label: "RAG/PRA", description: "Questions & contexte" },
  { id: "runbooks", label: "Runbooks", description: "Génération & exports" },
  { id: "analysis", label: "Analyse PRA", description: "Contrôles et risques" },
  { id: "risks", label: "Risques", description: "Menaces & matrices" },
  { id: "graph", label: "Graphes", description: "Dépendances" },
  { id: "architecture", label: "Architecture", description: "Vue d'ensemble" },
  { id: "landing", label: "Landing Zone", description: "Infrastructure" },
  { id: "scenarios", label: "Scénarios", description: "Runbooks" },
  { id: "auth", label: "Auth (ADMIN)", description: "Gestion des clés API (ADMIN only)" },
  { id: "audit", label: "Audit (ADMIN)", description: "Historique des appels API" },
];

const navLinks: NavLink[] = [
  { id: "home", label: "Accueil", href: "#home" },
  { id: "services", label: "Services", href: "#services" },
  { id: "documents", label: "Documents", href: "#documents" },
  { id: "rag", label: "RAG/PRA", href: "#rag" },
  { id: "runbooks", label: "Runbooks", href: "#runbooks" },
  { id: "analysis", label: "Analyse", href: "#analysis" },
  { id: "graph", label: "Graphes", href: "#graph" },
  { id: "architecture", label: "Architecture", href: "#architecture" },
  { id: "scenarios", label: "Scénarios", href: "#scenarios" },
];

const tabNavigationMap: Record<string, TabId> = {
  services: "services",
  documents: "documents",
  rag: "rag",
  runbooks: "runbooks",
  analysis: "analysis",
  graph: "graph",
  architecture: "architecture",
  scenarios: "scenarios",
};

type StepId = "services" | "documents" | "rag" | "runbooks";

const stepIds: StepId[] = ["services", "documents", "rag", "runbooks"];

function App() {
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => loadApiConfig());
  const [configVersion, setConfigVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>("services");
  const [tabQuery, setTabQuery] = useState("");
  const [activeNav, setActiveNav] = useState<string>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<StepId>("services");
  const [completedSteps, setCompletedSteps] = useState<StepId[]>([]);

  const handleConfigSave = (config: ApiConfig) => {
    setApiConfig(config);
    setConfigVersion((version) => version + 1);
  };

  const handleNavigate = (id: string) => {
    setActiveNav(id);
    const mappedTab = tabNavigationMap[id];
    if (mappedTab) {
      setActiveTab(mappedTab);
      if (stepIds.includes(mappedTab as StepId)) {
        setActiveStep(mappedTab as StepId);
      }
    }
    setMenuOpen(false);
  };

  const handleStepAction = (stepId: StepId) => {
    setActiveStep(stepId);
    setActiveTab(stepId);
    setActiveNav(stepId);
    setCompletedSteps((prev) => (prev.includes(stepId) ? prev : [...prev, stepId]));
  };

  const handleQuickAction = () => {
    setActiveNav("analysis");
    setActiveTab("analysis");
  };

  const currentPanel = useMemo(() => {
    switch (activeTab) {
      case "services":
        return <ServicesSection configVersion={configVersion} />;
      case "continuity":
        return <ContinuitySection configVersion={configVersion} />;
      case "bia":
        return <BiaSection configVersion={configVersion} />;
      case "incidents":
        return <IncidentsSection configVersion={configVersion} />;
      case "documents":
        return <DocumentsSection configVersion={configVersion} />;
      case "discovery":
        return <DiscoverySection configVersion={configVersion} />;
      case "rag":
        return <RagSection configVersion={configVersion} />;
      case "runbooks":
        return <RunbooksSection configVersion={configVersion} />;
      case "analysis":
        return <AnalysisSection configVersion={configVersion} />;
      case "risks":
        return <RisksSection configVersion={configVersion} />;
      case "auth":
        return <AuthSection configVersion={configVersion} />;
      case "audit":
        return <AuditLogsSection configVersion={configVersion} />;
      case "graph":
        return <GraphSection configVersion={configVersion} />;
      case "architecture":
        return <ArchitectureSection configVersion={configVersion} />;
      case "landing":
        return <LandingZoneSection configVersion={configVersion} />;
      case "scenarios":
        return <ScenariosSection configVersion={configVersion} />;
      default:
        return null;
    }
  }, [activeTab, configVersion]);

  const filteredTabs = useMemo(() => {
    const query = tabQuery.trim().toLowerCase();
    if (!query) return tabs;
    return tabs.filter(
      (tab) =>
        tab.label.toLowerCase().includes(query) ||
        tab.description.toLowerCase().includes(query)
    );
  }, [tabQuery]);

  useEffect(() => {
    if (filteredTabs.length === 0) return;
    if (!filteredTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(filteredTabs[0].id);
    }
  }, [filteredTabs, activeTab]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Aller au contenu principal
      </a>
      <Header
        links={navLinks}
        activeId={activeNav}
        isMenuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((open) => !open)}
        onNavigate={handleNavigate}
        onQuickAction={handleQuickAction}
      />

      <main id="main-content" className="main-content">
        <section id="home" className="home-section" aria-labelledby="home-title">
          <HomePage
            title="Premiers pas vers la résilience"
            subtitle="Suivez ces étapes guidées pour structurer vos services, alimenter le moteur RAG/PRA et générer des recommandations actionnables."
            activeStepId={activeStep}
            completedSteps={completedSteps}
            onStepAction={handleStepAction}
          />
        </section>

        <section className="workspace-section" aria-labelledby="workspace-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Espace opérationnel</p>
              <h2 id="workspace-title">Modules et analyses stratégiques</h2>
              <p className="muted">
                Pilotez vos services, analyses, runbooks et dépendances via des modules
                intelligents.
              </p>
            </div>
            <button type="button" className="btn primary" onClick={handleQuickAction}>
              Démarrer un PRA
            </button>
          </div>

          <div className="workspace-grid">
            <SectionCard
              eyebrow="Configuration"
              title="Connexion API"
              description="Renseignez l'URL et la clé API pour activer les workflows Stronghold."
            >
              <ConfigBanner config={apiConfig} onSave={handleConfigSave} />
            </SectionCard>

            <SectionCard
              eyebrow="Navigation"
              title="Vue d'ensemble"
              description="Accédez rapidement à chaque module pour orchestrer la continuité."
              actions={
                <div className="tab-controls">
                  <InfoBadge variant="subtle">
                    {SERVICE_DOMAINS.length} domaines suivis
                  </InfoBadge>
                  <div className="tab-search">
                    <label className="sr-only" htmlFor="tab-search">
                      Rechercher un module
                    </label>
                    <input
                      id="tab-search"
                      type="search"
                      value={tabQuery}
                      onChange={(event) => setTabQuery(event.target.value)}
                      placeholder="Rechercher un module"
                    />
                    <span className="muted small">
                      {filteredTabs.length}/{tabs.length}
                    </span>
                  </div>
                </div>
              }
            >
              {filteredTabs.length ? (
                <TabNavigation tabs={filteredTabs} activeTab={activeTab} onChange={setActiveTab} />
              ) : (
                <p className="empty-state">Aucun module ne correspond à cette recherche.</p>
              )}
            </SectionCard>
          </div>

          <div className="anchor-targets" aria-hidden="true">
            {navLinks
              .filter((link) => link.id !== "home")
              .map((link) => (
                <span key={link.id} id={link.id} className="anchor-target" />
              ))}
          </div>

          <div
            id={`${activeTab}-panel`}
            className="panel-stack"
            role="tabpanel"
            aria-labelledby={`${activeTab}-tab`}
          >
            {currentPanel}
          </div>
        </section>
      </main>

      <Footer links={navLinks} onNavigate={handleNavigate} />
    </div>
  );
}

export default App;

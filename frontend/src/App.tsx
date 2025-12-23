import { useMemo, useState } from "react";
import { ConfigBanner } from "./components/config/ConfigBanner";
import { MainLayout } from "./components/layout/MainLayout";
import { TabNavigation } from "./components/navigation/TabNavigation";
import { SERVICE_DOMAINS } from "./constants/domains";
import { AnalysisSection } from "./sections/AnalysisSection";
import { ArchitectureSection } from "./sections/ArchitectureSection";
import { DocumentsSection } from "./sections/DocumentsSection";
import { GraphSection } from "./sections/GraphSection";
import { LandingZoneSection } from "./sections/LandingZoneSection";
import { RagSection } from "./sections/RagSection";
import { RunbooksSection } from "./sections/RunbooksSection";
import { ScenariosSection } from "./sections/ScenariosSection";
import { ServicesSection } from "./sections/ServicesSection";
import type { ApiConfig, TabDefinition, TabId } from "./types";
import { loadApiConfig } from "./utils/api";

const tabs: TabDefinition[] = [
  { id: "services", label: "Services", description: "Catalogue et criticité" },
  { id: "documents", label: "Documents", description: "Upload & extraction" },
  { id: "rag", label: "Faits IA / RAG", description: "Questions & contexte" },
  { id: "runbooks", label: "Runbooks & rapports", description: "Génération & exports" },
  { id: "analysis", label: "Analyse PRA", description: "Contrôles et risques" },
  { id: "graph", label: "Graphe", description: "Dépendances" },
  { id: "architecture", label: "Architecture", description: "Vue d'ensemble" },
  { id: "landing", label: "Landing Zone", description: "Infrastructure" },
  { id: "scenarios", label: "Scénarios", description: "Runbooks" },
];

function App() {
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => loadApiConfig());
  const [configVersion, setConfigVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>("services");

  const handleConfigSave = (config: ApiConfig) => {
    setApiConfig(config);
    setConfigVersion((version) => version + 1);
  };

  const currentPanel = useMemo(() => {
    switch (activeTab) {
      case "services":
        return <ServicesSection configVersion={configVersion} />;
      case "documents":
        return <DocumentsSection configVersion={configVersion} />;
      case "rag":
        return <RagSection configVersion={configVersion} />;
      case "runbooks":
        return <RunbooksSection configVersion={configVersion} />;
      case "analysis":
        return <AnalysisSection configVersion={configVersion} />;
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

  return (
    <MainLayout
      title="Stronghold PRA/PCA"
      description="Noyau multi-tenant : services, Landing Zone, scénarios & runbooks, analyses et graphe."
    >
      <ConfigBanner config={apiConfig} onSave={handleConfigSave} />

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Navigation</p>
            <h2>Vue d'ensemble</h2>
            <p className="muted">
              Pilotez vos services, analyses, runbooks et dépendances via des onglets rapides.
            </p>
          </div>
          <div className="badge subtle">{SERVICE_DOMAINS.length} domaines suivis</div>
        </div>
        <TabNavigation tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      </section>

      <div
        id={`${activeTab}-panel`}
        className="panel-stack"
        role="tabpanel"
        aria-labelledby={`${activeTab}-tab`}
      >
        {currentPanel}
      </div>
    </MainLayout>
  );
}

export default App;

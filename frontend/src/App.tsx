import { useEffect, useMemo, useState } from "react";
import { ConfigBanner } from "./components/config/ConfigBanner";
import { MainLayout } from "./components/layout/MainLayout";
import { TabNavigation } from "./components/navigation/TabNavigation";
import { InfoBadge } from "./components/ui/InfoBadge";
import { SectionCard } from "./components/ui/SectionCard";
import { SERVICE_DOMAINS } from "./constants/domains";
import { AnalysisSection } from "./sections/AnalysisSection";
import { AuthSection } from "./sections/AuthSection";
import { AuditLogsSection } from "./sections/AuditLogsSection";
import { ArchitectureSection } from "./sections/ArchitectureSection";
import { DocumentsSection } from "./sections/DocumentsSection";
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
  { id: "rag", label: "Faits IA / RAG", description: "Questions & contexte" },
  { id: "runbooks", label: "Runbooks & rapports", description: "Génération & exports" },
  { id: "analysis", label: "Analyse PRA", description: "Contrôles et risques" },
  { id: "risks", label: "Risques", description: "Menaces & matrices" },
  { id: "graph", label: "Graphe", description: "Dépendances" },
  { id: "architecture", label: "Architecture", description: "Vue d'ensemble" },
  { id: "landing", label: "Landing Zone", description: "Infrastructure" },
  { id: "scenarios", label: "Scénarios", description: "Runbooks" },
  { id: "auth", label: "Auth (ADMIN)", description: "Gestion des clés API (ADMIN only)" },
  { id: "audit", label: "Audit (ADMIN)", description: "Historique des appels API" },
];

function App() {
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => loadApiConfig());
  const [configVersion, setConfigVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>("services");
  const [tabQuery, setTabQuery] = useState("");

  const handleConfigSave = (config: ApiConfig) => {
    setApiConfig(config);
    setConfigVersion((version) => version + 1);
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
    <MainLayout
      title="Stronghold PRA/PCA"
      description="Noyau multi-tenant : services, Landing Zone, scénarios & runbooks, analyses et graphe."
    >
      <ConfigBanner config={apiConfig} onSave={handleConfigSave} />

      <SectionCard
        eyebrow="Navigation"
        title="Vue d'ensemble"
        description="Pilotez vos services, analyses, runbooks et dépendances via des onglets rapides."
        actions={
          <div className="tab-controls">
            <InfoBadge variant="subtle">{SERVICE_DOMAINS.length} domaines suivis</InfoBadge>
            <div className="tab-search">
              <input
                type="search"
                value={tabQuery}
                onChange={(event) => setTabQuery(event.target.value)}
                placeholder="Rechercher un module"
                aria-label="Rechercher un module"
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

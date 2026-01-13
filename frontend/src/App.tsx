import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Footer } from "./components/layout/Footer";
import { AppLayout } from "./components/layout/AppLayout";
import type { HomeStepId } from "./components/home/HomePage";
import { ConfigurationPage } from "./routes/ConfigurationPage";
import { HomeRoute } from "./routes/HomeRoute";
import { NavigationPage } from "./routes/NavigationPage";
import {
  MODULE_PATH_TO_ID,
  MODULE_ROUTES,
  MODULE_PATHS,
  WIZARD_STEP_ORDER,
  getMainNavGroups,
  getModuleGroups,
  getModuleRoutes,
  getWizardStepGroup,
} from "./constants/navigation";
import type { ApiConfig, TabId } from "./types";
import { loadApiConfig } from "./utils/api";
import { getHomeSteps } from "./constants/homeSteps";
import { getCopy } from "./i18n/utils";
import type { Language } from "./i18n/translations";
import {
  getDefaultLanguage,
  getDefaultTheme,
  getStoredLanguage,
  getStoredTheme,
  setStoredLanguage,
  setStoredTheme,
  type ThemeMode,
} from "./utils/preferences";

// Lazy-load module panels to reduce the initial bundle footprint.
const ServicesSection = lazy(() =>
  import("./sections/ServicesSection").then((module) => ({ default: module.ServicesSection }))
);
const ContinuitySection = lazy(() =>
  import("./sections/ContinuitySection").then((module) => ({ default: module.ContinuitySection }))
);
const BiaSection = lazy(() =>
  import("./sections/BiaSection").then((module) => ({ default: module.BiaSection }))
);
const IncidentsSection = lazy(() =>
  import("./sections/IncidentsSection").then((module) => ({ default: module.IncidentsSection }))
);
const DocumentsSection = lazy(() =>
  import("./sections/DocumentsSection").then((module) => ({ default: module.DocumentsSection }))
);
const DiscoverySection = lazy(() =>
  import("./sections/DiscoverySection").then((module) => ({ default: module.DiscoverySection }))
);
const RagSection = lazy(() =>
  import("./sections/RagSection").then((module) => ({ default: module.RagSection }))
);
const RunbooksSection = lazy(() =>
  import("./sections/RunbooksSection").then((module) => ({ default: module.RunbooksSection }))
);
const AnalysisSection = lazy(() =>
  import("./sections/AnalysisSection").then((module) => ({ default: module.AnalysisSection }))
);
const RisksSection = lazy(() =>
  import("./sections/RisksSection").then((module) => ({ default: module.RisksSection }))
);
const GraphSection = lazy(() =>
  import("./sections/GraphSection").then((module) => ({ default: module.GraphSection }))
);
const ArchitectureSection = lazy(() =>
  import("./sections/ArchitectureSection").then((module) => ({
    default: module.ArchitectureSection,
  }))
);
const LandingZoneSection = lazy(() =>
  import("./sections/LandingZoneSection").then((module) => ({
    default: module.LandingZoneSection,
  }))
);
const ScenariosSection = lazy(() =>
  import("./sections/ScenariosSection").then((module) => ({ default: module.ScenariosSection }))
);
const AuthSection = lazy(() =>
  import("./sections/AuthSection").then((module) => ({ default: module.AuthSection }))
);
const AuditLogsSection = lazy(() =>
  import("./sections/AuditLogsSection").then((module) => ({ default: module.AuditLogsSection }))
);

const moduleComponents: Record<TabId, ComponentType<{ configVersion: number }>> = {
  services: ServicesSection,
  continuity: ContinuitySection,
  bia: BiaSection,
  incidents: IncidentsSection,
  documents: DocumentsSection,
  discovery: DiscoverySection,
  rag: RagSection,
  runbooks: RunbooksSection,
  analysis: AnalysisSection,
  risks: RisksSection,
  graph: GraphSection,
  architecture: ArchitectureSection,
  landing: LandingZoneSection,
  scenarios: ScenariosSection,
  auth: AuthSection,
  audit: AuditLogsSection,
};

function ModuleRoute({ tabId, configVersion }: { tabId: TabId; configVersion: number }) {
  const Panel = moduleComponents[tabId];

  return (
    <Suspense fallback={<div className="skeleton">Chargement du module...</div>}>
      <Panel configVersion={configVersion} />
    </Suspense>
  );
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => loadApiConfig());
  const [configVersion, setConfigVersion] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<HomeStepId>("services");
  const [completedSteps, setCompletedSteps] = useState<HomeStepId[]>([]);
  const [language, setLanguage] = useState<Language>(
    () => getStoredLanguage() ?? getDefaultLanguage()
  );
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme() ?? getDefaultTheme());
  const wizardSteps = useMemo(() => WIZARD_STEP_ORDER as HomeStepId[], []);
  const copy = useMemo(() => getCopy(language), [language]);
  const homeSteps = useMemo(() => getHomeSteps(language), [language]);
  const navGroups = useMemo(() => getMainNavGroups(language), [language]);
  const moduleGroups = useMemo(() => getModuleGroups(language), [language]);
  const moduleRoutes = useMemo(() => getModuleRoutes(language), [language]);
  const wizardGroup = useMemo(() => getWizardStepGroup(language), [language]);

  const activeTab = useMemo<TabId>(() => {
    const tabFromPath = MODULE_PATH_TO_ID[location.pathname];
    return tabFromPath ?? "services";
  }, [location.pathname]);

  const handleConfigSave = (config: ApiConfig) => {
    setApiConfig(config);
    setConfigVersion((version) => version + 1);
  };

  const handleTabNavigation = useCallback(
    (tabId: TabId) => {
      navigate(MODULE_PATHS[tabId]);
      setIsSidebarOpen(false);
      const stepIndex = wizardSteps.indexOf(tabId as HomeStepId);
      if (stepIndex >= 0) {
        setActiveStep(tabId as HomeStepId);
        const nextCompleted = wizardSteps.slice(0, stepIndex + 1);
        setCompletedSteps((prev) =>
          wizardSteps.filter((step) => prev.includes(step) || nextCompleted.includes(step))
        );
      }
    },
    [navigate, wizardSteps]
  );

  const handleStepAction = useCallback(
    (stepId: HomeStepId) => {
      const stepIndex = wizardSteps.indexOf(stepId);
      setActiveStep(stepId);
      if (stepIndex >= 0) {
        const nextCompleted = wizardSteps.slice(0, stepIndex + 1);
        setCompletedSteps((prev) =>
          wizardSteps.filter((step) => prev.includes(step) || nextCompleted.includes(step))
        );
      } else {
        setCompletedSteps((prev) => (prev.includes(stepId) ? prev : [...prev, stepId]));
      }
      navigate(MODULE_PATHS[stepId]);
      setIsSidebarOpen(false);
    },
    [navigate, wizardSteps]
  );

  const handleQuickAction = useCallback(() => {
    navigate(MODULE_PATHS.analysis);
  }, [navigate]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    const tabFromPath = MODULE_PATH_TO_ID[location.pathname];
    if (!tabFromPath) return;
    const stepIndex = wizardSteps.indexOf(tabFromPath as HomeStepId);
    if (stepIndex === -1) return;
    setActiveStep(tabFromPath as HomeStepId);
    setCompletedSteps((prev) => {
      const nextCompleted = wizardSteps.slice(0, stepIndex + 1);
      return wizardSteps.filter((step) => prev.includes(step) || nextCompleted.includes(step));
    });
  }, [location.pathname, wizardSteps]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setStoredTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    setStoredLanguage(language);
  }, [language]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {copy.skipToContent}
      </a>
      <AppLayout
        groups={navGroups}
        copy={copy}
        steps={homeSteps}
        activeStepId={activeStep}
        completedSteps={completedSteps}
        onStepAction={handleStepAction}
        onQuickAction={handleQuickAction}
        theme={theme}
        onToggleTheme={toggleTheme}
        language={language}
        onLanguageChange={setLanguage}
        isSidebarOpen={isSidebarOpen}
        onSidebarToggle={() => setIsSidebarOpen((open) => !open)}
        onSidebarClose={() => setIsSidebarOpen(false)}
      >
        <Routes>
          <Route
            path="/"
            element={
              <HomeRoute
                copy={copy}
                steps={homeSteps}
                activeStepId={activeStep}
                completedSteps={completedSteps}
                onStepAction={handleStepAction}
              />
            }
          />
          <Route
            path="/configuration"
            element={
              <ConfigurationPage apiConfig={apiConfig} onSave={handleConfigSave} copy={copy} />
            }
          />
          <Route
            path="/navigation"
            element={
              <NavigationPage
                activeTab={activeTab}
                onNavigateTab={handleTabNavigation}
                copy={copy}
                wizardGroup={wizardGroup}
                moduleGroups={moduleGroups}
                moduleRoutes={moduleRoutes}
              />
            }
          />
          {MODULE_ROUTES.map((module) => (
            <Route
              key={module.id}
              path={module.path}
              element={<ModuleRoute tabId={module.id} configVersion={configVersion} />}
            />
          ))}
          <Route
            path="*"
            element={
              <NavigationPage
                activeTab={activeTab}
                onNavigateTab={handleTabNavigation}
                copy={copy}
                wizardGroup={wizardGroup}
                moduleGroups={moduleGroups}
                moduleRoutes={moduleRoutes}
              />
            }
          />
        </Routes>
      </AppLayout>

      <Footer groups={navGroups} copy={copy} />
    </div>
  );
}

export default App;

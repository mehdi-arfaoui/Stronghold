import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Footer } from "./components/layout/Footer";
import { AppLayout } from "./components/layout/AppLayout";
import type { HomeStepId } from "./components/home/HomePage";
import {
  MODULE_PATH_TO_ID,
  MODULE_ROUTES,
  MODULE_PATHS,
  WIZARD_STEP_ORDER,
  getMainNavGroups,
  getWizardStepGroup,
} from "./constants/navigation";
import type { ApiConfig, BrandingSettings, TabId } from "./types";
import { SUPPORTED_LANGUAGES, type Language } from "./i18n/languages";
import { apiFetch, loadApiConfig } from "./utils/api";
import { getHomeSteps } from "./constants/homeSteps";
import {
  getDefaultTheme,
  getStoredTheme,
  setStoredDiscoveryCompleted,
  setStoredTheme,
  type ThemeMode,
} from "./utils/preferences";
import { useDiscovery } from "./context/DiscoveryContext";
import { applyBranding } from "./utils/branding";
import { BrandingProvider } from "./context/BrandingContext";

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
const FinancialSection = lazy(() =>
  import("./sections/FinancialSection").then((module) => ({ default: module.FinancialSection }))
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
const ComplianceSection = lazy(() =>
  import("./sections/ComplianceSection").then((module) => ({ default: module.ComplianceSection }))
);
const BrandingSection = lazy(() =>
  import("./sections/BrandingSection").then((module) => ({ default: module.BrandingSection }))
);
const HomeRoute = lazy(() =>
  import("./routes/HomeRoute").then((module) => ({ default: module.HomeRoute }))
);
const ConfigurationPage = lazy(() =>
  import("./routes/ConfigurationPage").then((module) => ({ default: module.ConfigurationPage }))
);
const NavigationPage = lazy(() =>
  import("./routes/NavigationPage").then((module) => ({ default: module.NavigationPage }))
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
  financier: FinancialSection,
  risks: RisksSection,
  graph: GraphSection,
  architecture: ArchitectureSection,
  landing: LandingZoneSection,
  scenarios: ScenariosSection,
  auth: AuthSection,
  audit: AuditLogsSection,
  compliance: ComplianceSection,
  branding: BrandingSection,
};

function ModuleRoute({ tabId, configVersion }: { tabId: TabId; configVersion: number }) {
  const { t } = useTranslation();
  const Panel = moduleComponents[tabId];

  return (
    <Suspense fallback={<div className="skeleton">{t("loadingModule")}</div>}>
      <Panel configVersion={configVersion} />
    </Suspense>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => loadApiConfig());
  const [configVersion, setConfigVersion] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<HomeStepId>("discovery");
  const [completedSteps, setCompletedSteps] = useState<HomeStepId[]>([]);
  const { discoveryCompleted } = useDiscovery();
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme() ?? getDefaultTheme());
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const activeLanguage = useMemo(() => {
    const resolvedLanguage = i18n.resolvedLanguage ?? i18n.language;
    if (SUPPORTED_LANGUAGES.includes(resolvedLanguage as Language)) {
      return resolvedLanguage as Language;
    }
    return "fr";
  }, [i18n.language, i18n.resolvedLanguage]);
  const wizardSteps = useMemo<HomeStepId[]>(
    () => (discoveryCompleted ? (WIZARD_STEP_ORDER as HomeStepId[]) : ["discovery"]),
    [discoveryCompleted]
  );
  const homeSteps = useMemo(
    () =>
      getHomeSteps(t).filter((step) => discoveryCompleted || step.id === "discovery"),
    [discoveryCompleted, t]
  );
  const navGroups = useMemo(() => getMainNavGroups(t), [t]);
  const wizardGroup = useMemo(() => getWizardStepGroup(t), [t]);

  const activeTab = useMemo<TabId>(() => {
    const tabFromPath = MODULE_PATH_TO_ID[location.pathname];
    return tabFromPath ?? "discovery";
  }, [location.pathname]);

  const handleConfigSave = (config: ApiConfig) => {
    setApiConfig(config);
    setConfigVersion((version) => version + 1);
  };

  const maxAllowedIndex = useMemo(() => {
    const completedIndex = completedSteps.reduce(
      (max, stepId) => Math.max(max, wizardSteps.indexOf(stepId)),
      -1
    );
    const activeIndex = wizardSteps.indexOf(activeStep);
    const furthestIndex = Math.max(completedIndex, activeIndex);
    return Math.min(wizardSteps.length - 1, furthestIndex + 1);
  }, [activeStep, completedSteps, wizardSteps]);

  const isNavigationLocked = !discoveryCompleted;

  const isStepAllowed = useCallback(
    (stepId: HomeStepId) => wizardSteps.indexOf(stepId) <= maxAllowedIndex,
    [maxAllowedIndex, wizardSteps]
  );

  const handleTabNavigation = useCallback(
    (tabId: TabId) => {
      if (!discoveryCompleted) return;
      const stepId = tabId as HomeStepId;
      const stepIndex = wizardSteps.indexOf(stepId);
      if (stepIndex === -1 || !isStepAllowed(stepId)) return;
      navigate(MODULE_PATHS[tabId]);
      setIsMenuOpen(false);
      setActiveStep(stepId);
      const nextCompleted = wizardSteps.slice(0, stepIndex + 1);
      setCompletedSteps((prev) =>
        wizardSteps.filter((step) => prev.includes(step) || nextCompleted.includes(step))
      );
    },
    [isStepAllowed, navigate, discoveryCompleted, wizardSteps]
  );

  const handleStepAction = useCallback(
    (stepId: HomeStepId) => {
      if (!discoveryCompleted) return;
      if (!isStepAllowed(stepId)) return;
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
      setIsMenuOpen(false);
    },
    [isStepAllowed, navigate, discoveryCompleted, wizardSteps]
  );

  const handleQuickAction = useCallback(() => {
    if (!discoveryCompleted) return;
    navigate(MODULE_PATHS.analysis);
  }, [navigate, discoveryCompleted]);

  const routeFallback = <div className="skeleton">{t("loadingModule")}</div>;
  const navigationElement = (
    <Suspense fallback={routeFallback}>
      <NavigationPage
        activeTab={activeTab}
        onNavigateTab={handleTabNavigation}
        wizardGroup={
          discoveryCompleted
            ? wizardGroup
            : {
                ...wizardGroup,
                tabs: wizardGroup.tabs.filter((tab) => tab.id === "discovery"),
              }
        }
      />
    </Suspense>
  );

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    if (!discoveryCompleted) return;
    const tabFromPath = MODULE_PATH_TO_ID[location.pathname];
    if (!tabFromPath) return;
    const stepIndex = wizardSteps.indexOf(tabFromPath as HomeStepId);
    if (stepIndex === -1) return;
    if (!isStepAllowed(tabFromPath as HomeStepId)) {
      navigate(MODULE_PATHS[wizardSteps[maxAllowedIndex]], { replace: true });
      return;
    }
    setActiveStep(tabFromPath as HomeStepId);
    setCompletedSteps((prev) => {
      const nextCompleted = wizardSteps.slice(0, stepIndex + 1);
      return wizardSteps.filter((step) => prev.includes(step) || nextCompleted.includes(step));
    });
  }, [isStepAllowed, location.pathname, maxAllowedIndex, navigate, discoveryCompleted, wizardSteps]);

  useEffect(() => {
    if (discoveryCompleted) return;
    const isConfigPath = location.pathname === "/configuration";
    if (isConfigPath) return;
    if (location.pathname !== "/discovery") {
      navigate(MODULE_PATHS.discovery, { replace: true });
    }
  }, [discoveryCompleted, location.pathname, navigate]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setStoredTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = activeLanguage;
  }, [activeLanguage]);

  useEffect(() => {
    setStoredDiscoveryCompleted(discoveryCompleted);
  }, [discoveryCompleted]);

  useEffect(() => {
    if (!discoveryCompleted && activeStep !== "discovery") {
      setActiveStep("discovery");
      setCompletedSteps([]);
    }
  }, [activeStep, discoveryCompleted]);

  useEffect(() => {
    let isMounted = true;
    const loadBranding = async () => {
      try {
        const data = (await apiFetch("/branding")) as BrandingSettings;
        if (isMounted) setBranding(data);
      } catch (error) {
        if (isMounted) setBranding(null);
      }
    };
    if (apiConfig.apiKey) {
      void loadBranding();
    } else {
      setBranding(null);
    }
    return () => {
      isMounted = false;
    };
  }, [apiConfig.apiKey]);

  useEffect(() => {
    applyBranding(branding);
  }, [branding]);

  return (
    <BrandingProvider value={{ branding, setBranding }}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">
          {t("skipToContent")}
        </a>
        <AppLayout
          groups={navGroups}
          steps={homeSteps}
          activeStepId={activeStep}
          completedSteps={completedSteps}
          maxAllowedIndex={isNavigationLocked ? -1 : maxAllowedIndex}
          onStepAction={handleStepAction}
          onQuickAction={handleQuickAction}
          theme={theme}
          onToggleTheme={toggleTheme}
          language={activeLanguage}
          onLanguageChange={(nextLanguage) => i18n.changeLanguage(nextLanguage)}
          isMenuOpen={isMenuOpen}
          onMenuToggle={() => setIsMenuOpen((open) => !open)}
          onMenuClose={() => setIsMenuOpen(false)}
          isNavigationLocked={isNavigationLocked}
          branding={branding}
        >
          <Routes>
            <Route
              path="/"
              element={
                <Suspense fallback={routeFallback}>
                  <HomeRoute
                    steps={homeSteps}
                    activeStepId={activeStep}
                    completedSteps={completedSteps}
                    maxAllowedIndex={maxAllowedIndex}
                    onStepAction={handleStepAction}
                  />
                </Suspense>
              }
            />
            <Route
              path="/configuration"
              element={
                <Suspense fallback={routeFallback}>
                  <ConfigurationPage apiConfig={apiConfig} onSave={handleConfigSave} />
                </Suspense>
              }
            />
            <Route path="/navigation" element={navigationElement} />
            <Route path="/discovery/scan" element={<Navigate to="/discovery" replace />} />
            <Route path="/discovery/import" element={<Navigate to="/discovery" replace />} />
            <Route path="/discovery/github-import" element={<Navigate to="/discovery" replace />} />
            <Route path="/discovery/suggestions" element={<Navigate to="/discovery" replace />} />
            {MODULE_ROUTES.map((module) => (
              <Route
                key={module.id}
                path={module.path}
                element={<ModuleRoute tabId={module.id} configVersion={configVersion} />}
              />
            ))}
            <Route path="*" element={navigationElement} />
          </Routes>
        </AppLayout>

        <Footer groups={navGroups} />
      </div>
    </BrandingProvider>
  );
}

export default App;

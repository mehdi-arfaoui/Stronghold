import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GlobalErrorBoundary } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { DiscoveryPage } from '@/pages/DiscoveryPage';
import { AnalysisPage } from '@/pages/AnalysisPage';
import { SimulationPage } from '@/pages/SimulationPage';
import { RecommendationsPage } from '@/pages/RecommendationsPage';
import { IncidentsPage } from '@/pages/IncidentsPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { ReportPage } from '@/pages/ReportPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { LoginPage } from '@/pages/LoginPage';
import { KnowledgeBasePage } from '@/pages/KnowledgeBasePage';
import { DriftDetectionPage } from '@/pages/DriftDetectionPage';
import { FinancialDashboardPage } from '@/pages/FinancialDashboardPage';
import { BusinessFlowsPage } from '@/pages/BusinessFlowsPage';
import { RunbooksPage } from '@/pages/RunbooksPage';
import { RunbookDetailPage } from '@/pages/RunbookDetailPage';
import { RemediationPage } from '@/pages/RemediationPage';
import { PRAExercisesPage } from '@/pages/PRAExercisesPage';
import { useUIStore } from '@/stores/ui.store';
import { useEffect } from 'react';
import { getCredentialScopeKey, isCredentialStorageKey } from '@/lib/credentialStorage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <OnboardingPage /> },
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/discovery', element: <DiscoveryPage /> },
      { path: '/analysis', element: <AnalysisPage /> },
      { path: '/business-flows', element: <BusinessFlowsPage /> },
      { path: '/simulations', element: <SimulationPage /> },
      { path: '/simulations/runbooks', element: <RunbooksPage /> },
      { path: '/simulations/runbooks/:id', element: <RunbookDetailPage /> },
      { path: '/simulations/pra-exercises', element: <PRAExercisesPage /> },
      { path: '/recommendations', element: <RecommendationsPage /> },
      { path: '/recommendations/remediation', element: <RemediationPage /> },
      { path: '/exercises', element: <Navigate to="/simulations/runbooks" replace /> },
      { path: '/incidents', element: <IncidentsPage /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/report', element: <ReportPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/knowledge-base', element: <KnowledgeBasePage /> },
      { path: '/drift', element: <DriftDetectionPage /> },
      { path: '/finance', element: <FinancialDashboardPage /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
]);

function ThemeInitializer() {
  const theme = useUIStore((state) => state.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return null;
}

function TenantCacheIsolationGuard() {
  useEffect(() => {
    let currentScope = getCredentialScopeKey();

    const syncScope = () => {
      const nextScope = getCredentialScopeKey();
      if (nextScope === currentScope) return;
      currentScope = nextScope;
      queryClient.clear();
    };

    const onStorage = (event: StorageEvent) => {
      if (!isCredentialStorageKey(event.key)) return;
      syncScope();
    };

    window.addEventListener('storage', onStorage);
    const interval = window.setInterval(syncScope, 1500);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}

export default function App() {
  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeInitializer />
          <TenantCacheIsolationGuard />
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
}

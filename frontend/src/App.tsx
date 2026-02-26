import { lazy, Suspense, type ReactNode, useEffect } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GlobalErrorBoundary } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingState } from '@/components/common/LoadingState';
import { useUIStore } from '@/stores/ui.store';
import { getCredentialScopeKey, isCredentialStorageKey } from '@/lib/credentialStorage';

const OnboardingPage = lazy(async () => ({ default: (await import('@/pages/OnboardingPage')).OnboardingPage }));
const LoginPage = lazy(async () => ({ default: (await import('@/pages/LoginPage')).LoginPage }));
const DashboardPage = lazy(async () => ({ default: (await import('@/pages/DashboardPage')).DashboardPage }));
const DiscoveryPage = lazy(async () => ({ default: (await import('@/pages/DiscoveryPage')).DiscoveryPage }));
const AnalysisPage = lazy(async () => ({ default: (await import('@/pages/AnalysisPage')).AnalysisPage }));
const SimulationPage = lazy(async () => ({ default: (await import('@/pages/SimulationPage')).SimulationPage }));
const RecommendationsPage = lazy(async () => ({ default: (await import('@/pages/RecommendationsPage')).RecommendationsPage }));
const IncidentsPage = lazy(async () => ({ default: (await import('@/pages/IncidentsPage')).IncidentsPage }));
const DocumentsPage = lazy(async () => ({ default: (await import('@/pages/DocumentsPage')).DocumentsPage }));
const ReportPage = lazy(async () => ({ default: (await import('@/pages/ReportPage')).ReportPage }));
const SettingsPage = lazy(async () => ({ default: (await import('@/pages/SettingsPage')).SettingsPage }));
const KnowledgeBasePage = lazy(async () => ({ default: (await import('@/pages/KnowledgeBasePage')).KnowledgeBasePage }));
const DriftDetectionPage = lazy(async () => ({ default: (await import('@/pages/DriftDetectionPage')).DriftDetectionPage }));
const FinancialDashboardPage = lazy(async () => ({ default: (await import('@/pages/FinancialDashboardPage')).FinancialDashboardPage }));
const BusinessFlowsPage = lazy(async () => ({ default: (await import('@/pages/BusinessFlowsPage')).BusinessFlowsPage }));
const RunbooksPage = lazy(async () => ({ default: (await import('@/pages/RunbooksPage')).RunbooksPage }));
const RunbookDetailPage = lazy(async () => ({ default: (await import('@/pages/RunbookDetailPage')).RunbookDetailPage }));
const RemediationPage = lazy(async () => ({ default: (await import('@/pages/RemediationPage')).RemediationPage }));
const PRAExercisesPage = lazy(async () => ({ default: (await import('@/pages/PRAExercisesPage')).PRAExercisesPage }));

function routeElement(element: ReactNode) {
  return (
    <Suspense fallback={<LoadingState message="Chargement du module..." />}>
      {element}
    </Suspense>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: routeElement(<OnboardingPage />) },
      { path: '/settings', element: routeElement(<SettingsPage />) },
      { path: '/dashboard', element: routeElement(<DashboardPage />) },
      { path: '/discovery', element: routeElement(<DiscoveryPage />) },
      { path: '/analysis', element: routeElement(<AnalysisPage />) },
      { path: '/business-flows', element: routeElement(<BusinessFlowsPage />) },
      { path: '/recommendations', element: routeElement(<RecommendationsPage />) },
      { path: '/finance', element: routeElement(<FinancialDashboardPage />) },
      { path: '/simulations', element: routeElement(<SimulationPage />) },
      { path: '/drift', element: routeElement(<DriftDetectionPage />) },
      { path: '/simulations/runbooks', element: routeElement(<RunbooksPage />) },
      { path: '/simulations/runbooks/:id', element: routeElement(<RunbookDetailPage />) },
      { path: '/simulations/pra-exercises', element: routeElement(<PRAExercisesPage />) },
      { path: '/recommendations/remediation', element: routeElement(<RemediationPage />) },
      { path: '/exercises', element: <Navigate to="/simulations/runbooks" replace /> },
      { path: '/incidents', element: routeElement(<IncidentsPage />) },
      { path: '/documents', element: routeElement(<DocumentsPage />) },
      { path: '/report', element: routeElement(<ReportPage />) },
      { path: '/knowledge-base', element: routeElement(<KnowledgeBasePage />) },
    ],
  },
  { path: '/login', element: routeElement(<LoginPage />) },
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

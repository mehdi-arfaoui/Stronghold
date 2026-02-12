import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GlobalErrorBoundary } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { DiscoveryPage } from '@/pages/DiscoveryPage';
import { AnalysisPage } from '@/pages/AnalysisPage';
import { SimulationPage } from '@/pages/SimulationPage';
import { RecommendationsPage } from '@/pages/RecommendationsPage';
import { ExercisesPage } from '@/pages/ExercisesPage';
import { IncidentsPage } from '@/pages/IncidentsPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { ReportPage } from '@/pages/ReportPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { LoginPage } from '@/pages/LoginPage';
import { KnowledgeBasePage } from '@/pages/KnowledgeBasePage';
import { DriftDetectionPage } from '@/pages/DriftDetectionPage';
import { useUIStore } from '@/stores/ui.store';
import { useEffect } from 'react';

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
      { path: '/simulations', element: <SimulationPage /> },
      { path: '/recommendations', element: <RecommendationsPage /> },
      { path: '/exercises', element: <ExercisesPage /> },
      { path: '/incidents', element: <IncidentsPage /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/report', element: <ReportPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/knowledge-base', element: <KnowledgeBasePage /> },
      { path: '/drift', element: <DriftDetectionPage /> },
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

export default function App() {
  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeInitializer />
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
}

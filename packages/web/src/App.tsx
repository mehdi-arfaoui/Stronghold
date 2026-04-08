import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import { Skeleton } from './components/common/Skeleton';
import { AppLayout } from './components/layout/AppLayout';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ScanPage = lazy(() => import('./pages/ScanPage'));
const ReportPage = lazy(() => import('./pages/ReportPage'));
const ScenariosPage = lazy(() => import('./pages/ScenariosPage'));
const ServicesPage = lazy(() => import('./pages/ServicesPage'));
const GraphPage = lazy(() => import('./pages/GraphPage'));
const DRPPage = lazy(() => import('./pages/DRPPage'));
const DriftPage = lazy(() => import('./pages/DriftPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function PageLoader(): JSX.Element {
  return (
    <div className="space-y-4 p-8">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/report/:scanId?" element={<ReportPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/graph/:scanId?" element={<GraphPage />} />
          <Route path="/drp/:scanId?" element={<DRPPage />} />
          <Route path="/drift" element={<DriftPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

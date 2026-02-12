import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Toaster } from 'sonner';
import { HelpDrawer } from '@/components/knowledge-base/HelpDrawer';
import { useUIStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';

export function AppShell() {
  const location = useLocation();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay when sidebar is open */}
      <div
        className={cn(
          'fixed inset-0 z-20 bg-background/80 backdrop-blur-sm lg:hidden transition-opacity duration-200',
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={useUIStore.getState().toggleSidebar}
      />
      <div className={cn('z-30 lg:relative', sidebarOpen ? 'fixed inset-y-0 left-0 lg:static' : 'relative')}>
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <ModuleErrorBoundary moduleName="Page">
            <div key={location.pathname} className="animate-in fade-in duration-200">
              <Outlet />
            </div>
          </ModuleErrorBoundary>
        </main>
      </div>
      <HelpDrawer />
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}

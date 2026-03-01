import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleHelp, Menu, Moon, Sun, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUIStore } from '@/stores/ui.store';
import { useAuthStore } from '@/stores/auth.store';
import { useGuidedTourStore } from '@/stores/guidedTour.store';
import { resolveGuidedTab } from './guidedTabTour.config';

const ROUTE_TITLES: Record<string, string> = {
  '/': 'routes.onboarding',
  '/dashboard': 'routes.dashboard',
  '/discovery': 'routes.discovery',
  '/analysis': 'routes.analysis',
  '/business-flows': 'routes.businessFlows',
  '/finance': 'routes.finance',
  '/simulations': 'routes.simulations',
  '/drift': 'routes.drift',
  '/simulations/runbooks': 'routes.runbooks',
  '/simulations/pra-exercises': 'routes.praExercises',
  '/recommendations': 'routes.recommendations',
  '/recommendations/remediation': 'routes.remediation',
  '/exercises': 'routes.runbooks',
  '/incidents': 'routes.incidents',
  '/documents': 'routes.documents',
  '/report': 'routes.report',
  '/settings': 'routes.settings',
  '/knowledge-base': 'routes.knowledgeBase',
};

function resolveRouteTitle(pathname: string): string {
  const exact = ROUTE_TITLES[pathname];
  if (exact) return exact;

  const match = Object.entries(ROUTE_TITLES)
    .filter(([route]) => pathname.startsWith(`${route}/`))
    .sort((left, right) => right[0].length - left[0].length)[0];

  return match?.[1] ?? 'routes.stronghold';
}

export function Header() {
  const { t } = useTranslation();
  const location = useLocation();
  const { theme, toggleTheme, toggleSidebar } = useUIStore();
  const { logout, user } = useAuthStore();
  const requestOpenForPath = useGuidedTourStore((state) => state.requestOpenForPath);

  const title = t(resolveRouteTitle(location.pathname));
  const activeGuide = resolveGuidedTab(location.pathname);

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={toggleSidebar}>
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        {activeGuide && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => requestOpenForPath(location.pathname)}
            aria-label={`${t('common.guide')} ${activeGuide.title}`}
          >
            <CircleHelp className="h-4 w-4" />
            <span className="hidden md:inline">{t('common.guide')}</span>
          </Button>
        )}

        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <User className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {user && (
              <>
                <div className="px-2 py-1.5 text-sm">
                  <p className="font-medium">{user.name}</p>
                  <p className="text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={logout}>{t('common.logout')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

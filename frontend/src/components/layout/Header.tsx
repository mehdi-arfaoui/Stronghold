import { useLocation } from 'react-router-dom';
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
  '/': 'Onboarding',
  '/dashboard': 'Tableau de bord',
  '/discovery': 'Decouverte',
  '/analysis': 'Analyse & BIA',
  '/business-flows': 'Flux Metier',
  '/finance': 'ROI & Finance',
  '/simulations': 'Simulations',
  '/drift': 'Drift Detection',
  '/simulations/runbooks': 'Runbooks',
  '/simulations/pra-exercises': 'Exercices PRA',
  '/recommendations': 'Recommandations',
  '/recommendations/remediation': 'Suivi Remediation',
  '/exercises': 'Runbooks',
  '/incidents': 'Incidents',
  '/documents': 'Documents',
  '/report': 'Rapport PRA/PCA',
  '/settings': 'Parametres',
  '/knowledge-base': 'Base de connaissances',
};

function resolveRouteTitle(pathname: string): string {
  const exact = ROUTE_TITLES[pathname];
  if (exact) return exact;

  const match = Object.entries(ROUTE_TITLES)
    .filter(([route]) => pathname.startsWith(`${route}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];

  return match?.[1] ?? 'Stronghold';
}

export function Header() {
  const location = useLocation();
  const { theme, toggleTheme, toggleSidebar } = useUIStore();
  const { logout, user } = useAuthStore();
  const requestOpenForPath = useGuidedTourStore((state) => state.requestOpenForPath);

  const title = resolveRouteTitle(location.pathname);
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
            aria-label={`Afficher le guide ${activeGuide.title}`}
          >
            <CircleHelp className="h-4 w-4" />
            <span className="hidden md:inline">Guide</span>
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
            <DropdownMenuItem onClick={logout}>Se deconnecter</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

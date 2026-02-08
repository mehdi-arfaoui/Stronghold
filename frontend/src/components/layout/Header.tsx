import { useLocation } from 'react-router-dom';
import { Moon, Sun, User, Menu } from 'lucide-react';
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

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Configuration',
  '/dashboard': 'Tableau de bord',
  '/discovery': 'Decouverte',
  '/analysis': 'Analyse & BIA',
  '/simulations': 'Simulations',
  '/recommendations': 'Recommandations',
  '/exercises': 'Exercices',
  '/incidents': 'Incidents',
  '/documents': 'Documents',
  '/report': 'Rapport PRA/PCA',
  '/settings': 'Parametres',
};

export function Header() {
  const location = useLocation();
  const { theme, toggleTheme, toggleSidebar } = useUIStore();
  const { logout, user } = useAuthStore();

  const title = ROUTE_TITLES[location.pathname] || 'Stronghold';

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={toggleSidebar}>
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
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
            <DropdownMenuItem onClick={logout}>
              Se deconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

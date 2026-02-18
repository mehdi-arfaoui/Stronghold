import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Radar,
  BarChart3,
  FlaskConical,
  Lightbulb,
  ClipboardList,
  AlertTriangle,
  FileText,
  FileDown,
  BookOpen,
  Settings,
  Shield,
  ChevronLeft,
  Activity,
  CircleDollarSign,
  GitBranch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  exact?: boolean;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Configuration',
    items: [
      { label: 'Parametres', icon: Settings, path: '/settings' },
      { label: 'Tableau de bord', icon: LayoutDashboard, path: '/dashboard', exact: true },
    ],
  },
  {
    label: 'Decouverte',
    items: [
      { label: 'Decouverte', icon: Radar, path: '/discovery' },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { label: 'Analyse & BIA', icon: BarChart3, path: '/analysis' },
      { label: 'Flux Metier', icon: GitBranch, path: '/business-flows' },
      { label: 'Recommandations', icon: Lightbulb, path: '/recommendations', exact: true },
      { label: 'ROI & Finance', icon: CircleDollarSign, path: '/finance' },
    ],
  },
  {
    label: 'Resilience',
    items: [
      { label: 'Simulations', icon: FlaskConical, path: '/simulations', exact: true },
      { label: 'Drift Detection', icon: Activity, path: '/drift' },
      { label: 'Runbooks', icon: ClipboardList, path: '/simulations/runbooks' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Exercices PRA', icon: ClipboardList, path: '/simulations/pra-exercises' },
      { label: 'Incidents', icon: AlertTriangle, path: '/incidents' },
    ],
  },
  {
    label: 'Documentation',
    items: [
      { label: 'Documents', icon: FileText, path: '/documents' },
      { label: 'Rapport PRA/PCA', icon: FileDown, path: '/report' },
      { label: 'Knowledge Base', icon: BookOpen, path: '/knowledge-base' },
    ],
  },
];

export function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const location = useLocation();

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r bg-card transition-all duration-300',
        sidebarOpen ? 'w-64' : 'w-16'
      )}
    >
      <div className="flex h-16 items-center justify-between border-b px-4">
        {sidebarOpen && (
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">Stronghold</span>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8">
          <ChevronLeft className={cn('h-4 w-4 transition-transform', !sidebarOpen && 'rotate-180')} />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <nav className="space-y-1 p-2">
          {NAV_SECTIONS.map((section, si) => (
            <div key={si}>
              {si > 0 && <Separator className="my-2" />}
              {section.label && sidebarOpen && (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
                const isActive = item.exact
                  ? location.pathname === item.path
                  : location.pathname.startsWith(item.path);

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-primary/40 bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      !sidebarOpen && 'justify-center px-2'
                    )}
                    title={!sidebarOpen ? item.label : undefined}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {sidebarOpen && <span>{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {sidebarOpen && (
        <div className="border-t p-4">
          <p className="text-xs text-muted-foreground">Stronghold v2.0</p>
        </div>
      )}
    </aside>
  );
}

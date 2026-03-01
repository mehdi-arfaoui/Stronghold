import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  labelKey: string;
  icon: LucideIcon;
  path: string;
  exact?: boolean;
}

interface NavSection {
  labelKey?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'sidebar.configuration',
    items: [
      { labelKey: 'nav.settings', icon: Settings, path: '/settings' },
      { labelKey: 'nav.dashboard', icon: LayoutDashboard, path: '/dashboard', exact: true },
    ],
  },
  {
    labelKey: 'sidebar.discovery',
    items: [{ labelKey: 'nav.discovery', icon: Radar, path: '/discovery' }],
  },
  {
    labelKey: 'sidebar.analysis',
    items: [
      { labelKey: 'nav.analysis', icon: BarChart3, path: '/analysis' },
      { labelKey: 'nav.businessFlows', icon: GitBranch, path: '/business-flows' },
      { labelKey: 'nav.recommendations', icon: Lightbulb, path: '/recommendations', exact: true },
      { labelKey: 'nav.roiFinance', icon: CircleDollarSign, path: '/finance' },
    ],
  },
  {
    labelKey: 'sidebar.resilience',
    items: [
      { labelKey: 'nav.simulations', icon: FlaskConical, path: '/simulations', exact: true },
      { labelKey: 'nav.driftDetection', icon: Activity, path: '/drift' },
      { labelKey: 'nav.runbooks', icon: ClipboardList, path: '/simulations/runbooks' },
    ],
  },
  {
    labelKey: 'sidebar.operations',
    items: [
      { labelKey: 'nav.exercises', icon: ClipboardList, path: '/simulations/pra-exercises' },
      { labelKey: 'nav.incidents', icon: AlertTriangle, path: '/incidents' },
    ],
  },
  {
    labelKey: 'sidebar.documentation',
    items: [
      { labelKey: 'nav.documents', icon: FileText, path: '/documents' },
      { labelKey: 'nav.reports', icon: FileDown, path: '/report' },
      { labelKey: 'nav.knowledgeBase', icon: BookOpen, path: '/knowledge-base' },
    ],
  },
];

export function Sidebar() {
  const { t } = useTranslation();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const location = useLocation();

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r bg-card transition-all duration-300',
        sidebarOpen ? 'w-64' : 'w-16',
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
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div key={section.labelKey ?? sectionIndex}>
              {sectionIndex > 0 && <Separator className="my-2" />}
              {section.labelKey && sidebarOpen && (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(section.labelKey)}
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
                      !sidebarOpen && 'justify-center px-2',
                    )}
                    title={!sidebarOpen ? t(item.labelKey) : undefined}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {sidebarOpen && <span>{t(item.labelKey)}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {sidebarOpen && (
        <div className="border-t p-4">
          <p className="text-xs text-muted-foreground">
            Stronghold v2.0
          </p>
        </div>
      )}
    </aside>
  );
}

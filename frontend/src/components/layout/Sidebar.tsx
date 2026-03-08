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
  ShieldCheck,
  ChevronLeft,
  Activity,
  CircleDollarSign,
  GitBranch,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLicense } from '@/hooks/useLicense';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  labelKey: string;
  label?: string;
  icon: LucideIcon;
  path: string;
  exact?: boolean;
  feature?: string;
}

interface NavSection {
  labelKey?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'sidebar.configuration',
    items: [
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
      { labelKey: 'nav.compliance', label: 'Conformite', icon: ShieldCheck, path: '/compliance' },
      { labelKey: 'nav.settings', icon: Settings, path: '/settings' },
      { labelKey: 'nav.roiFinance', icon: CircleDollarSign, path: '/finance', feature: 'executive-dashboard' },
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
  const { hasFeature } = useLicense();
  const { user } = useAuth();

  const navSections = user?.role === 'ADMIN'
    ? [
        ...NAV_SECTIONS,
        {
          labelKey: 'sidebar.configuration',
          items: [{ labelKey: 'nav.users', label: 'Utilisateurs', icon: Users, path: '/users' }],
        },
      ]
    : NAV_SECTIONS;

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
          {navSections.map((section, sectionIndex) => (
            <div key={section.labelKey ?? sectionIndex}>
              {sectionIndex > 0 && <Separator className="my-2" />}
              {section.labelKey && sidebarOpen && (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(section.labelKey)}
                </p>
              )}
              {section.items.map((item) => {
                if (item.feature && !hasFeature(item.feature)) {
                  return null;
                }
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
                    title={!sidebarOpen ? item.label ?? t(item.labelKey) : undefined}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {sidebarOpen && <span>{item.label ?? t(item.labelKey)}</span>}
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

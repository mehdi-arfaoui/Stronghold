import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleHelp, Loader2, Menu, Moon, Sun, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUIStore } from '@/stores/ui.store';
import { useAuth } from '@/hooks/useAuth';
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
  '/users': 'Utilisateurs',
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
  const { logout, user, changePassword } = useAuth();
  const requestOpenForPath = useGuidedTourStore((state) => state.requestOpenForPath);
  const [profileOpen, setProfileOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const rawTitle = resolveRouteTitle(location.pathname);
  const title = rawTitle.startsWith('routes.') ? t(rawTitle) : rawTitle;
  const activeGuide = resolveGuidedTab(location.pathname);

  const handlePasswordChange = async () => {
    if (newPassword.length < 8) {
      toast.error('Le mot de passe doit contenir au moins 8 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas.');
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success('Mot de passe mis a jour. Reconnectez-vous.');
      setProfileOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise a jour impossible.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <>
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
                    <p className="font-medium">{user.displayName}</p>
                    <p className="text-muted-foreground">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => setProfileOpen(true)}>Mon profil</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void logout()}>{t('common.logout')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mon profil</DialogTitle>
            <DialogDescription>
              Modifiez votre mot de passe. Cette action revoquera toutes vos sessions actives.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input value={user?.displayName ?? ''} disabled />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email ?? ''} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current-password">Mot de passe actuel</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nouveau mot de passe</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-new-password">Confirmer</Label>
              <Input
                id="confirm-new-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>
              Annuler
            </Button>
            <Button className="gap-2" disabled={savingPassword} onClick={() => void handlePasswordChange()}>
              {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
              Mettre a jour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

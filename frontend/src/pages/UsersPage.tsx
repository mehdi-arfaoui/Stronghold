import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RotateCcw, Trash2, UserCog } from 'lucide-react';
import {
  authApi,
  type CreateUserPayload,
  type UpdateUserPayload,
  type UserRole,
} from '@/api/auth.api';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';

const usersQueryKey = ['admin-users'] as const;

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrateur',
  ANALYST: 'Analyste',
  VIEWER: 'Lecteur',
};

function formatLastLogin(value: string | null): string {
  if (!value) return 'Jamais';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState<CreateUserPayload>({
    email: '',
    password: '',
    displayName: '',
    role: 'ANALYST',
  });
  const [resetPassword, setResetPassword] = useState('');

  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: async () => (await authApi.getUsers()).data,
  });

  const refreshUsers = async () => {
    await queryClient.invalidateQueries({ queryKey: usersQueryKey });
  };

  const createUserMutation = useMutation({
    mutationFn: async (payload: CreateUserPayload) => (await authApi.createUser(payload)).data,
    onSuccess: async () => {
      toast.success('Utilisateur cree.');
      setInviteOpen(false);
      setInviteForm({
        email: '',
        password: '',
        displayName: '',
        role: 'ANALYST',
      });
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Creation impossible.');
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateUserPayload }) =>
      (await authApi.updateUser(id, payload)).data,
    onSuccess: async () => {
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Mise a jour impossible.');
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await authApi.deleteUser(id);
    },
    onSuccess: async () => {
      toast.success('Utilisateur supprime.');
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible.');
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      await authApi.resetUserPassword(id, password);
    },
    onSuccess: async () => {
      toast.success('Mot de passe reinitialise.');
      setResetUserId(null);
      setResetPassword('');
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Reinitialisation impossible.');
    },
  });

  const users = usersQuery.data?.users ?? [];
  const count = usersQuery.data?.count ?? 0;
  const maxUsers = usersQuery.data?.maxUsers ?? -1;

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-2xl">Utilisateurs</CardTitle>
            <CardDescription>
              Invitez des utilisateurs, ajustez les roles et gerez les acces de votre instance.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary" className="bg-slate-100 text-slate-900">
              {maxUsers === -1 ? `${count} / illimite` : `${count} / ${maxUsers}`} utilisateurs
            </Badge>
            <Button className="gap-2" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" />
              Inviter un utilisateur
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Derniere connexion</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Chargement des utilisateurs...
                    </span>
                  </TableCell>
                </TableRow>
              )}

              {!usersQuery.isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Aucun utilisateur cree.
                  </TableCell>
                </TableRow>
              )}

              {users.map((rowUser) => {
                const isSelf = rowUser.id === user?.id;
                const rowBusy =
                  updateUserMutation.isPending ||
                  deleteUserMutation.isPending ||
                  resetPasswordMutation.isPending;

                return (
                  <TableRow key={rowUser.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium text-slate-900">{rowUser.displayName}</div>
                        <div className="text-sm text-muted-foreground">{rowUser.email}</div>
                      </div>
                    </TableCell>
                    <TableCell className="w-48">
                      <Select
                        value={rowUser.role}
                        onValueChange={(value) => {
                          void updateUserMutation.mutateAsync({
                            id: rowUser.id,
                            payload: { role: value as UserRole },
                          });
                        }}
                        disabled={isSelf || rowBusy}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ROLE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={rowUser.isActive ? 'secondary' : 'outline'}
                        className={rowUser.isActive ? 'bg-emerald-100 text-emerald-900' : ''}
                      >
                        {rowUser.isActive ? 'Actif' : 'Inactif'}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatLastLogin(rowUser.lastLoginAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSelf || rowBusy}
                          onClick={() => {
                            void updateUserMutation.mutateAsync({
                              id: rowUser.id,
                              payload: { isActive: !rowUser.isActive },
                            });
                          }}
                        >
                          {rowUser.isActive ? 'Desactiver' : 'Activer'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => setResetUserId(rowUser.id)}
                          disabled={rowBusy}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Reset
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          disabled={isSelf || rowBusy}
                          onClick={() => {
                            void deleteUserMutation.mutateAsync(rowUser.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                          Supprimer
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter un utilisateur</DialogTitle>
            <DialogDescription>
              Creez un compte avec un mot de passe temporaire, puis ajustez le role selon le besoin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-display-name">Nom complet</Label>
              <Input
                id="invite-display-name"
                value={inviteForm.displayName}
                onChange={(event) => setInviteForm((current) => ({ ...current, displayName: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteForm.email}
                onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-password">Mot de passe temporaire</Label>
              <Input
                id="invite-password"
                type="password"
                value={inviteForm.password}
                onChange={(event) => setInviteForm((current) => ({ ...current, password: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(value) => setInviteForm((current) => ({ ...current, role: value as UserRole }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Annuler
            </Button>
            <Button
              className="gap-2"
              disabled={createUserMutation.isPending}
              onClick={() => {
                void createUserMutation.mutateAsync(inviteForm);
              }}
            >
              {createUserMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Creer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetUserId)} onOpenChange={(open) => !open && setResetUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reinitialiser le mot de passe</DialogTitle>
            <DialogDescription>
              Definissez un nouveau mot de passe temporaire pour forcer une reconnexion de cet utilisateur.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reset-password">Nouveau mot de passe</Label>
            <Input
              id="reset-password"
              type="password"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUserId(null)}>
              Annuler
            </Button>
            <Button
              className="gap-2"
              disabled={!resetUserId || resetPassword.length < 8 || resetPasswordMutation.isPending}
              onClick={() => {
                if (!resetUserId) return;
                void resetPasswordMutation.mutateAsync({ id: resetUserId, password: resetPassword });
              }}
            >
              {resetPasswordMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Reinitialiser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-dashed border-slate-300 bg-slate-50/80">
        <CardContent className="flex items-start gap-3 pt-6 text-sm text-slate-600">
          <UserCog className="mt-0.5 h-4 w-4 text-slate-500" />
          <p>
            Les protections critiques restent enforcees cote backend: impossible de se supprimer soi-meme, de desactiver son propre compte ou de retirer le dernier administrateur actif.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

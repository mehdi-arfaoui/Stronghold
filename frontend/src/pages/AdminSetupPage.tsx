import { useState, type FormEvent } from 'react';
import { AxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck, UserRoundCog } from 'lucide-react';
import { authApi } from '@/api/auth.api';
import { setupStatusQueryKey } from '@/hooks/useSetupStatus';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function resolveErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const apiMessage = error.response?.data?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim()) {
      return apiMessage;
    }
  }

  return 'Impossible de creer le compte administrateur.';
}

export function AdminSetupPage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const setupMutation = useMutation({
    mutationFn: async () => (await authApi.setupAdmin(email, password, displayName)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: setupStatusQueryKey });
    },
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (displayName.trim().length === 0) {
      setError('Le nom complet est requis.');
      return;
    }

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    try {
      await setupMutation.mutateAsync();
    } catch (nextError) {
      setError(resolveErrorMessage(nextError));
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.14),_transparent_38%),linear-gradient(180deg,_#f4f7f5_0%,_#eef2ef_100%)] px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <Card className="w-full max-w-4xl overflow-hidden border-slate-200 shadow-2xl shadow-slate-900/10">
          <CardContent className="grid gap-0 p-0 md:grid-cols-[1.05fr_0.95fr]">
            <section className="bg-slate-950 px-8 py-10 text-white">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-teal-400/20 p-3 ring-1 ring-teal-300/30">
                  <UserRoundCog className="h-7 w-7 text-teal-200" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-teal-200/80">Stronghold</p>
                  <h1 className="text-3xl font-semibold">Premier lancement</h1>
                </div>
              </div>
              <p className="mt-6 max-w-md text-sm leading-6 text-slate-300">
                Creez le premier compte administrateur pour finaliser l activation de l instance.
              </p>

              <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-start gap-3 text-sm text-slate-300">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-teal-200" />
                  <p>
                    Ce compte pourra inviter les autres utilisateurs, gerer les roles et reinitialiser les mots de passe.
                  </p>
                </div>
              </div>
            </section>

            <section className="bg-white px-8 py-10">
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <p className="text-sm font-medium text-slate-900">Creer votre compte administrateur</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Une fois le compte cree, vous serez redirige vers l ecran de connexion.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="display-name">Nom complet</Label>
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Mehdi El H..."
                    autoComplete="name"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setup-email">Email</Label>
                  <Input
                    id="setup-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="admin@stronghold.local"
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setup-password">Mot de passe</Label>
                  <Input
                    id="setup-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setup-password-confirm">Confirmer le mot de passe</Label>
                  <Input
                    id="setup-password-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>

                {error && (
                  <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-slate-950 text-white hover:bg-slate-800"
                  disabled={setupMutation.isPending}
                >
                  {setupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Creer le compte administrateur
                </Button>
              </form>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

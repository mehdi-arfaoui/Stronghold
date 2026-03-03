import { useState, type FormEvent } from 'react';
import { AxiosError } from 'axios';
import { Loader2, LockKeyhole, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPendingSetupEmail } from '@/lib/authSession';

function resolveErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const apiMessage = error.response?.data?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim()) {
      return apiMessage;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Email ou mot de passe incorrect.';
}

export function LoginPage() {
  const { login } = useAuth();
  const [setupEmailHint] = useState(() => getPendingSetupEmail());
  const [email, setEmail] = useState(() => getPendingSetupEmail() ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
    } catch (nextError) {
      setError(resolveErrorMessage(nextError));
    } finally {
      setIsSubmitting(false);
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
                  <Shield className="h-7 w-7 text-teal-200" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-teal-200/80">Stronghold</p>
                  <h1 className="text-3xl font-semibold">Connexion</h1>
                </div>
              </div>
              <p className="mt-6 max-w-md text-sm leading-6 text-slate-300">
                Authentifiez-vous pour acceder a la plateforme de resilience et a l administration de votre instance.
              </p>

              <div className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/10 px-4 py-3">
                  <LockKeyhole className="mt-0.5 h-4 w-4 text-teal-200" />
                  <div className="text-sm text-slate-300">
                    Session courte duree via access token HS256 et refresh token rotatif.
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-slate-300">
                  Les actions d administration restent bornees a votre tenant local.
                </div>
              </div>
            </section>

            <section className="bg-white px-8 py-10">
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div>
                  <p className="text-sm font-medium text-slate-900">Identifiants</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Utilisez votre compte administrateur ou un compte invite par un administrateur.
                  </p>
                </div>

                {setupEmailHint && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    Compte administrateur cree. Connectez-vous avec <span className="font-medium">{setupEmailHint}</span>.
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="admin@stronghold.local"
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="********"
                    autoComplete="current-password"
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
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Se connecter
                </Button>
              </form>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

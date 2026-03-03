import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldCheck, ShieldX } from 'lucide-react';
import { licenseApi } from '@/api/license.api';
import { licenseQueryKey, useLicense } from '@/hooks/useLicense';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function LicenseActivationPage() {
  const queryClient = useQueryClient();
  const { license } = useLicense();
  const [token, setToken] = useState('');

  const activationMutation = useMutation({
    mutationFn: async (value: string) => (await licenseApi.activateLicense(value)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: licenseQueryKey });
    },
  });

  const activationResult = activationMutation.data;
  const activationFailed = Boolean(activationMutation.isError || activationResult?.success === false);
  const currentMessage = activationResult?.message
    ?? (activationMutation.error instanceof Error ? activationMutation.error.message : null);

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
                  <h1 className="text-3xl font-semibold">Activer Stronghold</h1>
                </div>
              </div>
              <p className="mt-6 max-w-md text-sm leading-6 text-slate-300">
                Collez le token JWT fourni apres achat pour activer votre instance on-premise.
              </p>

              <div className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Statut actuel</p>
                  <p className="mt-2 text-lg font-medium">
                    {license?.company ? `${license.company} · ${license.plan}` : 'Aucune licence active'}
                  </p>
                </div>
                <div className="grid gap-3 text-sm text-slate-300">
                  <div className="rounded-xl border border-white/10 bg-black/10 px-4 py-3">
                    Signature Ed25519 verifiee localement
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/10 px-4 py-3">
                    Binding machine applique au premier demarrage
                  </div>
                </div>
              </div>
            </section>

            <section className="bg-white px-8 py-10">
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium text-slate-900">Token de licence</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Collez le contenu complet du fichier `.lic`.
                  </p>
                </div>

                <textarea
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."
                  className="min-h-52 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs leading-6 text-slate-900 shadow-inner outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100"
                />

                <Button
                  className="w-full bg-slate-950 text-white hover:bg-slate-800"
                  size="lg"
                  disabled={activationMutation.isPending || token.trim().length === 0}
                  onClick={() => activationMutation.mutate(token)}
                >
                  {activationMutation.isPending ? 'Activation...' : 'Activer'}
                </Button>

                {activationResult?.success && (
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-4 text-sm text-emerald-950">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 h-4 w-4" />
                      <div>
                        <p className="font-semibold">Licence activee</p>
                        <p className="mt-1">
                          {activationResult.company} · plan {activationResult.plan}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {activationFailed && (
                  <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-4 text-sm text-rose-900">
                    <div className="flex items-start gap-3">
                      <ShieldX className="mt-0.5 h-4 w-4" />
                      <div>
                        <p className="font-semibold">Activation impossible</p>
                        <p className="mt-1">{currentMessage ?? 'Le token de licence est invalide.'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

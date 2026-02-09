import { useState } from 'react';
import { toast } from 'sonner';
import {
  Mail,
  Webhook,
  ExternalLink,
  Check,
  X,
  AlertCircle,
  Settings,
  Loader2,
  TestTube,
  Globe,
  MessageSquare,
  Bell,
  Shield,
  Ticket,
  Plus,
  Trash2,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type IntegrationStatus = 'connected' | 'disconnected' | 'error';
type IntegrationType = 'email' | 'servicenow' | 'webhook' | 'pagerduty' | 'opsgenie' | 'jira' | 'teams' | 'slack';

interface Integration {
  type: IntegrationType;
  name: string;
  description: string;
  icon: typeof Mail;
  status: IntegrationStatus;
  comingSoon?: boolean;
}

interface WebhookEntry {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
}

const AVAILABLE_EVENTS = [
  'incident.created',
  'incident.updated',
  'incident.resolved',
  'exercise.started',
  'exercise.completed',
  'simulation.completed',
  'report.generated',
];

const INTEGRATIONS: Integration[] = [
  { type: 'email', name: 'Email', description: 'Reception et parsing automatique des incidents par email', icon: Mail, status: 'disconnected' },
  { type: 'servicenow', name: 'ServiceNow', description: 'Synchronisation bidirectionnelle des incidents', icon: Ticket, status: 'disconnected' },
  { type: 'webhook', name: 'Webhooks', description: 'Notifications sortantes via webhooks personnalises', icon: Webhook, status: 'disconnected' },
  { type: 'pagerduty', name: 'PagerDuty', description: 'Gestion des astreintes et escalades', icon: Bell, status: 'disconnected', comingSoon: true },
  { type: 'opsgenie', name: 'Opsgenie', description: 'Alerting et gestion des incidents', icon: AlertCircle, status: 'disconnected', comingSoon: true },
  { type: 'jira', name: 'Jira Service Management', description: 'Gestion des tickets IT', icon: Globe, status: 'disconnected', comingSoon: true },
  { type: 'teams', name: 'Microsoft Teams', description: 'Notifications dans les canaux Teams', icon: MessageSquare, status: 'disconnected', comingSoon: true },
  { type: 'slack', name: 'Slack', description: 'Notifications dans les canaux Slack', icon: MessageSquare, status: 'disconnected', comingSoon: true },
];

interface IntegrationsHubProps {
  className?: string;
}

export function IntegrationsHub({ className }: IntegrationsHubProps) {
  const [configuring, setConfiguring] = useState<IntegrationType | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>(INTEGRATIONS);

  // Email config state
  const [emailAddress, setEmailAddress] = useState('');
  const [emailTesting, setEmailTesting] = useState(false);

  // ServiceNow config state
  const [snUrl, setSnUrl] = useState('');
  const [snUser, setSnUser] = useState('');
  const [snPassword, setSnPassword] = useState('');
  const [snTesting, setSnTesting] = useState(false);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');

  const getStatusBadge = (status: IntegrationStatus) => {
    switch (status) {
      case 'connected':
        return <Badge className="bg-resilience-high/10 text-resilience-high gap-1"><Check className="h-3 w-3" />Connecte</Badge>;
      case 'error':
        return <Badge className="bg-severity-critical/10 text-severity-critical gap-1"><AlertCircle className="h-3 w-3" />Erreur</Badge>;
      default:
        return <Badge variant="outline" className="gap-1 text-muted-foreground">Non configure</Badge>;
    }
  };

  const handleTestEmail = async () => {
    setEmailTesting(true);
    await new Promise((r) => setTimeout(r, 1500));
    setEmailTesting(false);
    setIntegrations((prev) =>
      prev.map((i) => i.type === 'email' ? { ...i, status: 'connected' as IntegrationStatus } : i)
    );
    toast.success('Connexion email verifiee');
  };

  const handleTestServiceNow = async () => {
    setSnTesting(true);
    await new Promise((r) => setTimeout(r, 2000));
    setSnTesting(false);
    if (snUrl && snUser) {
      setIntegrations((prev) =>
        prev.map((i) => i.type === 'servicenow' ? { ...i, status: 'connected' as IntegrationStatus } : i)
      );
      toast.success('Connexion ServiceNow verifiee');
    } else {
      toast.error('Veuillez remplir tous les champs');
    }
  };

  const addWebhook = () => {
    if (!newWebhookUrl) return;
    setWebhooks((prev) => [
      ...prev,
      {
        id: `wh-${Date.now()}`,
        url: newWebhookUrl,
        secret: `whsec_${Math.random().toString(36).substring(2, 15)}`,
        events: ['incident.created'],
        enabled: true,
      },
    ]);
    setNewWebhookUrl('');
    setIntegrations((prev) =>
      prev.map((i) => i.type === 'webhook' ? { ...i, status: 'connected' as IntegrationStatus } : i)
    );
    toast.success('Webhook ajoute');
  };

  const removeWebhook = (id: string) => {
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
  };

  const toggleWebhookEvent = (webhookId: string, event: string) => {
    setWebhooks((prev) =>
      prev.map((w) => {
        if (w.id !== webhookId) return w;
        const events = w.events.includes(event)
          ? w.events.filter((e) => e !== event)
          : [...w.events, event];
        return { ...w, events };
      })
    );
  };

  const testWebhook = async (id: string) => {
    toast.promise(new Promise((r) => setTimeout(r, 1000)), {
      loading: 'Envoi du test...',
      success: 'Webhook test envoye (200 OK)',
      error: 'Erreur lors du test',
    });
  };

  return (
    <div className={cn('space-y-6', className)}>
      <div>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">Connectez Stronghold a vos outils existants</p>
      </div>

      {/* Integration Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => (
          <Card
            key={integration.type}
            className={cn(
              'transition-all duration-200',
              integration.comingSoon && 'opacity-60'
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg',
                    integration.status === 'connected' ? 'bg-resilience-high/10' : 'bg-muted'
                  )}>
                    <integration.icon className={cn(
                      'h-5 w-5',
                      integration.status === 'connected' ? 'text-resilience-high' : 'text-muted-foreground'
                    )} />
                  </div>
                  <div>
                    <h3 className="font-medium text-sm">{integration.name}</h3>
                    {getStatusBadge(integration.status)}
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">{integration.description}</p>

              <div className="mt-4">
                {integration.comingSoon ? (
                  <Badge variant="secondary">Bientot disponible</Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setConfiguring(integration.type)}
                  >
                    <Settings className="mr-2 h-3.5 w-3.5" />
                    Configurer
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Configuration Dialogs */}
      {/* Email Config */}
      <Dialog open={configuring === 'email'} onOpenChange={(open) => !open && setConfiguring(null)}>
        <DialogContent aria-label="Configuration Email">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Configuration Email
            </DialogTitle>
            <DialogDescription>Configurez une adresse email dediee pour la reception automatique d'incidents</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="mb-1.5 block">Adresse email dediee</Label>
              <Input
                type="email"
                placeholder="incidents@stronghold.domaine.com"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Les emails recus a cette adresse seront automatiquement parses et transformes en brouillons d'incidents.
              </p>
            </div>
            <Button onClick={handleTestEmail} disabled={!emailAddress || emailTesting} className="w-full">
              {emailTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
              Tester la connexion
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ServiceNow Config */}
      <Dialog open={configuring === 'servicenow'} onOpenChange={(open) => !open && setConfiguring(null)}>
        <DialogContent aria-label="Configuration ServiceNow">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5" />
              Configuration ServiceNow
            </DialogTitle>
            <DialogDescription>Synchronisation bidirectionnelle des incidents</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="mb-1.5 block">URL de l'instance</Label>
              <Input placeholder="https://company.service-now.com" value={snUrl} onChange={(e) => setSnUrl(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block">Nom d'utilisateur</Label>
              <Input placeholder="admin" value={snUser} onChange={(e) => setSnUser(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block">Mot de passe</Label>
              <Input type="password" value={snPassword} onChange={(e) => setSnPassword(e.target.value)} />
            </div>
            <Button onClick={handleTestServiceNow} disabled={snTesting} className="w-full">
              {snTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
              Tester la connexion
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Webhooks Config */}
      <Dialog open={configuring === 'webhook'} onOpenChange={(open) => !open && setConfiguring(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" aria-label="Configuration Webhooks">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              Webhooks sortants
            </DialogTitle>
            <DialogDescription>Configurez des webhooks pour recevoir des notifications en temps reel</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Add webhook */}
            <div className="flex gap-2">
              <Input
                placeholder="https://votre-service.com/webhook"
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                className="flex-1"
              />
              <Button onClick={addWebhook} disabled={!newWebhookUrl}>
                <Plus className="mr-1 h-4 w-4" /> Ajouter
              </Button>
            </div>

            {/* Webhook list */}
            <div className="space-y-3">
              {webhooks.map((wh) => (
                <div key={wh.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{wh.url}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{wh.secret}</code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => { navigator.clipboard.writeText(wh.secret); toast.success('Secret copie'); }}
                          aria-label="Copier le secret"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={wh.enabled} onCheckedChange={(checked) => {
                        setWebhooks((prev) => prev.map((w) => w.id === wh.id ? { ...w, enabled: checked } : w));
                      }} aria-label="Activer" />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => testWebhook(wh.id)} aria-label="Tester">
                        <TestTube className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-severity-critical" onClick={() => removeWebhook(wh.id)} aria-label="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Events */}
                  <div>
                    <p className="text-xs font-medium mb-1.5">Evenements</p>
                    <div className="flex flex-wrap gap-1.5">
                      {AVAILABLE_EVENTS.map((event) => (
                        <button
                          key={event}
                          type="button"
                          onClick={() => toggleWebhookEvent(wh.id, event)}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-xs transition-colors',
                            wh.events.includes(event)
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-accent'
                          )}
                        >
                          {event}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              {webhooks.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Aucun webhook configure. Ajoutez une URL ci-dessus.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import type {
  DocumentRecord,
  Incident,
  IncidentDashboard,
  NotificationChannel,
  Service,
} from "../types";
import { apiFetch } from "../utils/api";

interface IncidentsSectionProps {
  configVersion: number;
}

const INCIDENT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const CHANNEL_TYPES = ["EMAIL", "SLACK", "TEAMS", "SIEM", "TICKETING", "CHATOPS"] as const;

const buildLocalDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

const defaultIncidentPayload = {
  title: "",
  description: "",
  status: "OPEN",
  detectedAt: buildLocalDateTime(),
  responsibleTeam: "",
  selectedServiceIds: [] as string[],
  selectedDocumentIds: [] as string[],
};

const defaultChannelPayload = {
  type: "EMAIL",
  label: "",
  n8nWebhookUrl: "",
  recipients: "",
  isEnabled: true,
};

export function IncidentsSection({ configVersion }: IncidentsSectionProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [dashboard, setDashboard] = useState<IncidentDashboard | null>(null);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newIncident, setNewIncident] = useState({ ...defaultIncidentPayload });
  const [newChannel, setNewChannel] = useState({ ...defaultChannelPayload });
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [incidentData, serviceData, documentData, dashboardData, channelData] =
        await Promise.all([
          apiFetch("/incidents"),
          apiFetch("/services"),
          apiFetch("/documents"),
          apiFetch("/incidents/dashboard"),
          apiFetch("/incidents/notification-channels"),
        ]);
      setIncidents(incidentData);
      setServices(serviceData);
      setDocuments(documentData);
      setDashboard(dashboardData);
      setChannels(channelData);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [configVersion]);

  const handleToggleService = (id: string) => {
    setNewIncident((prev) => {
      const exists = prev.selectedServiceIds.includes(id);
      return {
        ...prev,
        selectedServiceIds: exists
          ? prev.selectedServiceIds.filter((s) => s !== id)
          : [...prev.selectedServiceIds, id],
      };
    });
  };

  const handleToggleDocument = (id: string) => {
    setNewIncident((prev) => {
      const exists = prev.selectedDocumentIds.includes(id);
      return {
        ...prev,
        selectedDocumentIds: exists
          ? prev.selectedDocumentIds.filter((d) => d !== id)
          : [...prev.selectedDocumentIds, id],
      };
    });
  };

  const handleCreateIncident = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/incidents", {
        method: "POST",
        body: JSON.stringify({
          title: newIncident.title,
          description: newIncident.description,
          status: newIncident.status,
          detectedAt: newIncident.detectedAt,
          responsibleTeam: newIncident.responsibleTeam,
          serviceIds: newIncident.selectedServiceIds,
          documentIds: newIncident.selectedDocumentIds,
        }),
      });
      await loadData();
      setNewIncident({ ...defaultIncidentPayload, detectedAt: buildLocalDateTime() });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  const handleCreateChannel = async (e: FormEvent) => {
    e.preventDefault();
    setChannelLoading(true);
    setChannelError(null);
    try {
      await apiFetch("/incidents/notification-channels", {
        method: "POST",
        body: JSON.stringify({
          type: newChannel.type,
          label: newChannel.label,
          n8nWebhookUrl: newChannel.n8nWebhookUrl,
          isEnabled: newChannel.isEnabled,
          configuration: {
            recipients: newChannel.recipients,
          },
        }),
      });
      await loadData();
      setNewChannel({ ...defaultChannelPayload });
    } catch (err: any) {
      setChannelError(err.message || "Erreur lors de la création");
    } finally {
      setChannelLoading(false);
    }
  };

  const handleToggleChannel = async (channel: NotificationChannel) => {
    setChannelLoading(true);
    setChannelError(null);
    try {
      await apiFetch(`/incidents/notification-channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          isEnabled: !channel.isEnabled,
        }),
      });
      await loadData();
    } catch (err: any) {
      setChannelError(err.message || "Erreur lors de la mise à jour");
    } finally {
      setChannelLoading(false);
    }
  };

  const progressSteps = useMemo(() => {
    return [
      incidents.length > 0,
      incidents.some((incident) => incident.status === "IN_PROGRESS" || incident.status === "RESOLVED"),
      channels.length > 0,
    ];
  }, [incidents, channels]);

  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  if (loading) return <div className="skeleton">Chargement des incidents...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  return (
    <section id="incidents-panel" className="panel" aria-labelledby="incidents-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Crises & incidents</p>
          <h2 id="incidents-title">Gestion des incidents &amp; crises</h2>
          <p className="muted">
            Centralisez les incidents, les équipes responsables, les services impactés et les notifications en temps réel.
          </p>
        </div>
        <div className="badge subtle">{incidents.length} incidents</div>
      </div>

      <PageIntro
        title="Piloter la réponse aux incidents"
        objective="Suivre les incidents, notifier les équipes et conserver l'historique des actions menées."
        steps={[
          "Créer un incident avec les services impactés",
          "Configurer les canaux de notification n8n",
          "Mettre à jour le statut et consigner les actions",
        ]}
        tips={[
          "Préparez un webhook vers votre SIEM ou outil de ticketing.",
          "Activez les canaux critiques pour les crises prioritaires.",
          "Consignez les actions pour faciliter le post-mortem.",
        ]}
        links={[
          { label: "Créer un incident", href: "#incidents-create", description: "Formulaire" },
          { label: "Suivi temps réel", href: "#incidents-dashboard", description: "Tableau de bord" },
          { label: "Notifications", href: "#incident-notifications", description: "Canaux" },
        ]}
        expectedData={[
          "Titre, statut, équipe responsable",
          "Services et documents impactés",
          "Canaux e-mail, Slack, Teams",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <div id="incidents-dashboard" className="panel-grid" style={{ marginBottom: "24px" }}>
        <div className="card">
          <h3 className="section-title">Vue d'ensemble</h3>
          <div className="stack" style={{ gap: "8px" }}>
            <div className="detail-list">
              <div>
                <span className="detail-label">Total</span>
                <span>{dashboard?.summary.total ?? 0}</span>
              </div>
              <div>
                <span className="detail-label">Ouverts</span>
                <span>{dashboard?.summary.open ?? 0}</span>
              </div>
              <div>
                <span className="detail-label">En cours</span>
                <span>{dashboard?.summary.inProgress ?? 0}</span>
              </div>
              <div>
                <span className="detail-label">Résolus</span>
                <span>{dashboard?.summary.resolved ?? 0}</span>
              </div>
              <div>
                <span className="detail-label">Clos</span>
                <span>{dashboard?.summary.closed ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="section-title">Incidents récents</h3>
          {dashboard?.recentIncidents.length ? (
            <ul className="stack" style={{ gap: "8px" }}>
              {dashboard.recentIncidents.map((incident) => (
                <li key={incident.id} className="stack" style={{ gap: "4px" }}>
                  <strong>{incident.title}</strong>
                  <span className="muted small">
                    {incident.status} • {formatDate(incident.detectedAt)} • Services: {incident.services.length}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">Aucun incident récent.</p>
          )}
        </div>

        <div className="card">
          <h3 className="section-title">Historique d'actions</h3>
          {dashboard?.recentActions.length ? (
            <ul className="stack" style={{ gap: "8px" }}>
              {dashboard.recentActions.map((action) => (
                <li key={action.id} className="stack" style={{ gap: "4px" }}>
                  <strong>{action.actionType}</strong>
                  <span className="muted small">
                    {action.incident?.title ?? "Incident"} • {formatDate(action.createdAt)}
                  </span>
                  {action.description && <span className="muted small">{action.description}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">Aucune action enregistrée.</p>
          )}
        </div>
      </div>

      <form id="incidents-create" className="card form-grid" onSubmit={handleCreateIncident}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Titre</span>
            <input
              type="text"
              value={newIncident.title}
              onChange={(e) => setNewIncident((s) => ({ ...s, title: e.target.value }))}
              required
            />
          </label>
          <label className="form-field">
            <span>Statut</span>
            <select
              value={newIncident.status}
              onChange={(e) => setNewIncident((s) => ({ ...s, status: e.target.value }))}
            >
              {INCIDENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Date de détection</span>
            <input
              type="datetime-local"
              value={newIncident.detectedAt}
              onChange={(e) => setNewIncident((s) => ({ ...s, detectedAt: e.target.value }))}
              required
            />
          </label>
          <label className="form-field">
            <span>Équipe responsable</span>
            <input
              type="text"
              value={newIncident.responsibleTeam}
              onChange={(e) => setNewIncident((s) => ({ ...s, responsibleTeam: e.target.value }))}
            />
          </label>
          <label className="form-field" style={{ gridColumn: "span 2" }}>
            <span>Description</span>
            <input
              type="text"
              value={newIncident.description}
              onChange={(e) => setNewIncident((s) => ({ ...s, description: e.target.value }))}
            />
          </label>
          <div className="form-field" style={{ gridColumn: "span 2" }}>
            <span>Services impactés</span>
            <div className="service-selector">
              {services.length === 0 ? (
                <div className="empty-state">Aucun service défini pour ce tenant.</div>
              ) : (
                services.map((service) => (
                  <label key={service.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={newIncident.selectedServiceIds.includes(service.id)}
                      onChange={() => handleToggleService(service.id)}
                    />
                    <span>
                      {service.name} <span className="muted">({service.type}, {service.criticality})</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="form-field" style={{ gridColumn: "span 1" }}>
            <span>Documents associés</span>
            <div className="service-selector">
              {documents.length === 0 ? (
                <div className="empty-state">Aucun document disponible.</div>
              ) : (
                documents.map((document) => (
                  <label key={document.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={newIncident.selectedDocumentIds.includes(document.id)}
                      onChange={() => handleToggleDocument(document.id)}
                    />
                    <span>
                      {document.originalName} <span className="muted">({document.docType ?? "n/a"})</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={creating}>
            {creating ? "Création..." : "Créer l'incident"}
          </button>
          {createError && <p className="helper error">{createError}</p>}
        </div>
      </form>

      <div className="panel-grid" style={{ marginTop: "24px" }}>
        <div className="card" id="incident-notifications">
          <div className="card-header">
            <div>
              <h3 className="section-title">Canaux de notification</h3>
              <p className="muted small">
                Configurez n8n ou vos webhooks pour envoyer vers SIEM, ticketing, e-mail, Slack ou Teams.
              </p>
            </div>
            <span className="pill subtle">{channels.length} canaux</span>
          </div>

          <form className="form-grid" onSubmit={handleCreateChannel}>
            <label className="form-field">
              <span>Type</span>
              <select
                value={newChannel.type}
                onChange={(e) => setNewChannel((s) => ({ ...s, type: e.target.value }))}
              >
                {CHANNEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Label</span>
              <input
                type="text"
                value={newChannel.label}
                onChange={(e) => setNewChannel((s) => ({ ...s, label: e.target.value }))}
              />
            </label>
            <label className="form-field">
              <span>Webhook n8n</span>
              <input
                type="url"
                value={newChannel.n8nWebhookUrl}
                onChange={(e) => setNewChannel((s) => ({ ...s, n8nWebhookUrl: e.target.value }))}
                required
              />
            </label>
            <label className="form-field">
              <span>Destinataires</span>
              <input
                type="text"
                value={newChannel.recipients}
                onChange={(e) => setNewChannel((s) => ({ ...s, recipients: e.target.value }))}
                placeholder="ex: crisis@company.com, #incident" 
              />
            </label>
            <label className="form-field checkbox">
              <span>Actif</span>
              <input
                type="checkbox"
                checked={newChannel.isEnabled}
                onChange={(e) => setNewChannel((s) => ({ ...s, isEnabled: e.target.checked }))}
              />
            </label>
            <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
              <button className="btn" type="submit" disabled={channelLoading}>
                {channelLoading ? "Enregistrement..." : "Ajouter le canal"}
              </button>
              {channelError && <p className="helper error">{channelError}</p>}
            </div>
          </form>

          {channels.length === 0 ? (
            <p className="empty-state">Aucun canal configuré pour le moment.</p>
          ) : (
            <div className="stack" style={{ gap: "12px" }}>
              {channels.map((channel) => (
                <div key={channel.id} className="card" style={{ padding: "12px" }}>
                  <div className="stack" style={{ gap: "6px" }}>
                    <div className="stack horizontal" style={{ justifyContent: "space-between" }}>
                      <strong>{channel.label || channel.type}</strong>
                      <span className={`pill ${channel.isEnabled ? "success" : "subtle"}`}>
                        {channel.isEnabled ? "Actif" : "Inactif"}
                      </span>
                    </div>
                    <span className="muted small">{channel.type} • {channel.n8nWebhookUrl}</span>
                    <button
                      className="btn subtle"
                      type="button"
                      disabled={channelLoading}
                      onClick={() => handleToggleChannel(channel)}
                    >
                      {channel.isEnabled ? "Désactiver" : "Activer"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="section-title">Historique des incidents</h3>
              <p className="muted small">Suivi des statuts, actions et services impactés.</p>
            </div>
          </div>
          {incidents.length === 0 ? (
            <p className="empty-state">Aucun incident enregistré.</p>
          ) : (
            <div className="stack" style={{ gap: "16px" }}>
              {incidents.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  services={services}
                  documents={documents}
                  onUpdated={loadData}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface IncidentCardProps {
  incident: Incident;
  services: Service[];
  documents: DocumentRecord[];
  onUpdated: () => void;
}

function IncidentCard({ incident, services, documents, onUpdated }: IncidentCardProps) {
  const [editing, setEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addingAction, setAddingAction] = useState(false);
  const [editIncident, setEditIncident] = useState({
    title: incident.title,
    description: incident.description ?? "",
    status: incident.status,
    detectedAt: toLocalInputValue(incident.detectedAt),
    responsibleTeam: incident.responsibleTeam ?? "",
    selectedServiceIds: incident.services.map((link) => link.service.id),
    selectedDocumentIds: incident.documents.map((link) => link.document.id),
  });
  const [newAction, setNewAction] = useState({
    actionType: "UPDATE",
    description: "",
  });

  const handleToggleService = (id: string) => {
    setEditIncident((prev) => {
      const exists = prev.selectedServiceIds.includes(id);
      return {
        ...prev,
        selectedServiceIds: exists
          ? prev.selectedServiceIds.filter((s) => s !== id)
          : [...prev.selectedServiceIds, id],
      };
    });
  };

  const handleToggleDocument = (id: string) => {
    setEditIncident((prev) => {
      const exists = prev.selectedDocumentIds.includes(id);
      return {
        ...prev,
        selectedDocumentIds: exists
          ? prev.selectedDocumentIds.filter((d) => d !== id)
          : [...prev.selectedDocumentIds, id],
      };
    });
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    setUpdateError(null);
    try {
      await apiFetch(`/incidents/${incident.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editIncident.title,
          description: editIncident.description,
          status: editIncident.status,
          detectedAt: editIncident.detectedAt,
          responsibleTeam: editIncident.responsibleTeam,
          serviceIds: editIncident.selectedServiceIds,
          documentIds: editIncident.selectedDocumentIds,
        }),
      });
      await onUpdated();
      setEditing(false);
    } catch (err: any) {
      setUpdateError(err.message || "Erreur lors de la mise à jour");
    } finally {
      setUpdating(false);
    }
  };

  const handleAddAction = async (e: FormEvent) => {
    e.preventDefault();
    setAddingAction(true);
    setActionError(null);
    try {
      await apiFetch(`/incidents/${incident.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          actionType: newAction.actionType,
          description: newAction.description,
        }),
      });
      await onUpdated();
      setNewAction({ actionType: "UPDATE", description: "" });
    } catch (err: any) {
      setActionError(err.message || "Erreur lors de l'ajout de l'action");
    } finally {
      setAddingAction(false);
    }
  };

  const statusClass = `pill status-${incident.status.toLowerCase()}`;

  return (
    <article className="card incident-card">
      <header className="scenario-header">
        <div>
          <h3>{incident.title}</h3>
          <p className="muted">
            <span className={statusClass}>{incident.status}</span> • Détection : {formatDate(incident.detectedAt)}
            {incident.responsibleTeam && <> • Équipe : {incident.responsibleTeam}</>}
          </p>
          {incident.description && <p className="muted small">{incident.description}</p>}
        </div>
        <div className="scenario-meta">
          <span className="pill subtle">Services: {incident.services.length}</span>
          <span className="pill subtle">Documents: {incident.documents.length}</span>
          <button className="btn ghost" onClick={() => setEditing((prev) => !prev)}>
            {editing ? "Fermer" : "Modifier"}
          </button>
        </div>
      </header>

      <div className="stack" style={{ gap: "8px" }}>
        <div>
          <span className="detail-label">Services impactés</span>
          <p className="muted small">
            {incident.services.length === 0
              ? "Aucun service associé"
              : incident.services
                  .map((link) => `${link.service.name} (${link.service.criticality})`)
                  .join(", ")}
          </p>
        </div>
        <div>
          <span className="detail-label">Documents associés</span>
          <p className="muted small">
            {incident.documents.length === 0
              ? "Aucun document associé"
              : incident.documents
                  .map((link) => `${link.document.originalName} (${link.document.docType ?? "n/a"})`)
                  .join(", ")}
          </p>
        </div>
      </div>

      <div className="table-wrapper" style={{ marginTop: "12px" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Description</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {incident.actions.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-state">Aucune action enregistrée.</td>
              </tr>
            ) : (
              incident.actions.map((action) => (
                <tr key={action.id}>
                  <td>{action.actionType}</td>
                  <td>{action.description ?? "-"}</td>
                  <td className="numeric">{formatDate(action.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form className="form-grid" onSubmit={handleAddAction}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Type d'action</span>
            <input
              type="text"
              value={newAction.actionType}
              onChange={(e) => setNewAction((s) => ({ ...s, actionType: e.target.value }))}
            />
          </label>
          <label className="form-field" style={{ gridColumn: "span 2" }}>
            <span>Description</span>
            <input
              type="text"
              value={newAction.description}
              onChange={(e) => setNewAction((s) => ({ ...s, description: e.target.value }))}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit" disabled={addingAction}>
            {addingAction ? "Ajout..." : "Ajouter l'action"}
          </button>
          {actionError && <p className="helper error">{actionError}</p>}
        </div>
      </form>

      {editing && (
        <form className="form-grid" onSubmit={handleUpdate}>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <label className="form-field">
              <span>Titre</span>
              <input
                type="text"
                value={editIncident.title}
                onChange={(e) => setEditIncident((s) => ({ ...s, title: e.target.value }))}
                required
              />
            </label>
            <label className="form-field">
              <span>Statut</span>
              <select
                value={editIncident.status}
                onChange={(e) => setEditIncident((s) => ({ ...s, status: e.target.value }))}
              >
                {INCIDENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Date de détection</span>
              <input
                type="datetime-local"
                value={editIncident.detectedAt}
                onChange={(e) => setEditIncident((s) => ({ ...s, detectedAt: e.target.value }))}
                required
              />
            </label>
            <label className="form-field">
              <span>Équipe responsable</span>
              <input
                type="text"
                value={editIncident.responsibleTeam}
                onChange={(e) => setEditIncident((s) => ({ ...s, responsibleTeam: e.target.value }))}
              />
            </label>
            <label className="form-field" style={{ gridColumn: "span 2" }}>
              <span>Description</span>
              <input
                type="text"
                value={editIncident.description}
                onChange={(e) => setEditIncident((s) => ({ ...s, description: e.target.value }))}
              />
            </label>
            <div className="form-field" style={{ gridColumn: "span 2" }}>
              <span>Services impactés</span>
              <div className="service-selector">
                {services.length === 0 ? (
                  <div className="empty-state">Aucun service défini pour ce tenant.</div>
                ) : (
                  services.map((service) => (
                    <label key={service.id} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={editIncident.selectedServiceIds.includes(service.id)}
                        onChange={() => handleToggleService(service.id)}
                      />
                      <span>
                        {service.name} <span className="muted">({service.type}, {service.criticality})</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="form-field" style={{ gridColumn: "span 1" }}>
              <span>Documents associés</span>
              <div className="service-selector">
                {documents.length === 0 ? (
                  <div className="empty-state">Aucun document disponible.</div>
                ) : (
                  documents.map((document) => (
                    <label key={document.id} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={editIncident.selectedDocumentIds.includes(document.id)}
                        onChange={() => handleToggleDocument(document.id)}
                      />
                      <span>
                        {document.originalName} <span className="muted">({document.docType ?? "n/a"})</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={updating}>
              {updating ? "Mise à jour..." : "Enregistrer"}
            </button>
            <button className="btn" type="button" onClick={() => setEditing(false)} disabled={updating}>
              Annuler
            </button>
            {updateError && <p className="helper error">{updateError}</p>}
          </div>
        </form>
      )}
    </article>
  );
}

function formatDate(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return buildLocalDateTime();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

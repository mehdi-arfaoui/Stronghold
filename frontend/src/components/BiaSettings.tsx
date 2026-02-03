import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../utils/api";

interface ProcessTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  defaultRtoHours: number;
  defaultRpoMinutes: number;
  defaultMtpdHours: number;
  suggestedFinancialImpact: number;
  suggestedRegulatoryImpact: number;
  isBuiltIn: boolean;
  isActive: boolean;
}

interface CriticalityThreshold {
  level: "critical" | "high" | "medium" | "low";
  minScore: number;
  maxScore: number;
  color: string;
  label: string;
  actionRequired: boolean;
  notifyOnCreate: boolean;
}

interface AlertConfiguration {
  id: string;
  type: "criticality_change" | "rto_breach" | "coverage_gap" | "risk_increase" | "incident_impact";
  isEnabled: boolean;
  threshold?: number;
  recipients: string[];
  channels: ("email" | "slack" | "teams" | "webhook")[];
  frequency: "immediate" | "hourly" | "daily" | "weekly";
}

interface DisplayPreferences {
  defaultTab: string;
  showCriticalOnly: boolean;
  defaultSortField: string;
  defaultSortOrder: "asc" | "desc";
  itemsPerPage: number;
  showImpactMatrix: boolean;
  dashboardRefreshInterval: number;
  chartColors: {
    critical: string;
    high: string;
    medium: string;
    low: string;
  };
}

interface BiaSettings {
  tenantId: string;
  processTemplates: ProcessTemplate[];
  criticalityThresholds: CriticalityThreshold[];
  alertConfigurations: AlertConfiguration[];
  displayPreferences: DisplayPreferences;
  lastUpdated: string;
}

type SettingsTab = "templates" | "thresholds" | "alerts" | "display";

const CATEGORIES = [
  { value: "finance", label: "Finance" },
  { value: "rh", label: "Ressources Humaines" },
  { value: "commercial", label: "Commercial" },
  { value: "logistique", label: "Logistique" },
  { value: "it", label: "IT / Infrastructure" },
  { value: "juridique", label: "Juridique" },
  { value: "production", label: "Production" },
  { value: "autre", label: "Autre" },
];

const ALERT_TYPES = [
  { value: "criticality_change", label: "Changement de criticité", description: "Alerte quand un processus change de niveau de criticité" },
  { value: "rto_breach", label: "Dépassement RTO", description: "Alerte quand le temps de reprise dépasse le RTO défini" },
  { value: "coverage_gap", label: "Lacune de couverture", description: "Alerte pour les processus sans runbook ou analyse de risque" },
  { value: "risk_increase", label: "Augmentation de risque", description: "Alerte quand un risque lié atteint un seuil critique" },
  { value: "incident_impact", label: "Impact incident", description: "Alerte quand un incident impacte un processus critique" },
];

const FREQUENCIES = [
  { value: "immediate", label: "Immédiat" },
  { value: "hourly", label: "Toutes les heures" },
  { value: "daily", label: "Quotidien" },
  { value: "weekly", label: "Hebdomadaire" },
];

const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "slack", label: "Slack" },
  { value: "teams", label: "Teams" },
  { value: "webhook", label: "Webhook" },
];

export function BiaSettings() {
  const [settings, setSettings] = useState<BiaSettings | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("templates");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Template creation form
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    name: "",
    description: "",
    category: "it",
    defaultRtoHours: 4,
    defaultRpoMinutes: 30,
    defaultMtpdHours: 24,
    suggestedFinancialImpact: 3,
    suggestedRegulatoryImpact: 3,
  });

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch("/bia/settings");
      setSettings(data);
    } catch (err: any) {
      setError(err.message || "Erreur lors du chargement des paramètres");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleCreateTemplate = async () => {
    if (!templateForm.name) return;

    try {
      setSaving(true);
      await apiFetch("/bia/settings/templates", {
        method: "POST",
        body: JSON.stringify(templateForm),
      });
      setShowTemplateForm(false);
      setTemplateForm({
        name: "",
        description: "",
        category: "it",
        defaultRtoHours: 4,
        defaultRpoMinutes: 30,
        defaultMtpdHours: 24,
        suggestedFinancialImpact: 3,
        suggestedRegulatoryImpact: 3,
      });
      await loadSettings();
      showSuccess("Template créé avec succès");
    } catch (err: any) {
      setError(err.message || "Erreur lors de la création");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTemplate = async (templateId: string, isActive: boolean) => {
    try {
      await apiFetch(`/bia/settings/templates/${templateId}/toggle`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      });
      await loadSettings();
    } catch (err: any) {
      setError(err.message || "Erreur lors de la mise à jour");
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce template ?")) return;

    try {
      await apiFetch(`/bia/settings/templates/${templateId}`, {
        method: "DELETE",
      });
      await loadSettings();
      showSuccess("Template supprimé");
    } catch (err: any) {
      setError(err.message || "Erreur lors de la suppression");
    }
  };

  const handleUpdateThreshold = async (index: number, field: keyof CriticalityThreshold, value: any) => {
    if (!settings) return;

    const updated = [...settings.criticalityThresholds];
    (updated[index] as any)[field] = value;

    try {
      await apiFetch("/bia/settings/thresholds", {
        method: "PUT",
        body: JSON.stringify({ thresholds: updated }),
      });
      await loadSettings();
    } catch (err: any) {
      setError(err.message || "Erreur lors de la mise à jour");
    }
  };

  const handleUpdateAlert = async (alertId: string, updates: Partial<AlertConfiguration>) => {
    if (!settings) return;

    const updated = settings.alertConfigurations.map((a) =>
      a.id === alertId ? { ...a, ...updates } : a
    );

    try {
      await apiFetch("/bia/settings/alerts", {
        method: "PUT",
        body: JSON.stringify({ configs: updated }),
      });
      await loadSettings();
    } catch (err: any) {
      setError(err.message || "Erreur lors de la mise à jour");
    }
  };

  const handleUpdateDisplay = async (updates: Partial<DisplayPreferences>) => {
    try {
      setSaving(true);
      await apiFetch("/bia/settings/display", {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      await loadSettings();
      showSuccess("Préférences mises à jour");
    } catch (err: any) {
      setError(err.message || "Erreur lors de la mise à jour");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (section?: "templates" | "thresholds" | "alerts" | "display") => {
    const message = section
      ? `Réinitialiser les ${section === "templates" ? "templates" : section === "thresholds" ? "seuils" : section === "alerts" ? "alertes" : "préférences"} par défaut ?`
      : "Réinitialiser tous les paramètres par défaut ?";

    if (!confirm(message)) return;

    try {
      setSaving(true);
      await apiFetch("/bia/settings/reset", {
        method: "POST",
        body: JSON.stringify({ section }),
      });
      await loadSettings();
      showSuccess("Paramètres réinitialisés");
    } catch (err: any) {
      setError(err.message || "Erreur lors de la réinitialisation");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="skeleton">Chargement des paramètres...</div>;
  }

  if (!settings) {
    return <div className="alert error">{error || "Impossible de charger les paramètres"}</div>;
  }

  return (
    <div className="bia-settings">
      {error && <div className="alert error" style={{ marginBottom: "1rem" }}>{error}</div>}
      {successMessage && <div className="alert success" style={{ marginBottom: "1rem" }}>{successMessage}</div>}

      {/* Settings Tabs */}
      <div className="settings-tabs">
        <button
          className={`tab-button ${activeTab === "templates" ? "active" : ""}`}
          onClick={() => setActiveTab("templates")}
        >
          Templates
        </button>
        <button
          className={`tab-button ${activeTab === "thresholds" ? "active" : ""}`}
          onClick={() => setActiveTab("thresholds")}
        >
          Seuils de criticité
        </button>
        <button
          className={`tab-button ${activeTab === "alerts" ? "active" : ""}`}
          onClick={() => setActiveTab("alerts")}
        >
          Alertes
        </button>
        <button
          className={`tab-button ${activeTab === "display" ? "active" : ""}`}
          onClick={() => setActiveTab("display")}
        >
          Affichage
        </button>
      </div>

      {/* Templates Tab */}
      {activeTab === "templates" && (
        <div className="settings-section">
          <div className="section-header">
            <div>
              <h3>Templates de processus</h3>
              <p className="muted small">Gérez les modèles pré-configurés pour la création de processus BIA.</p>
            </div>
            <div className="section-actions">
              <button className="button small" onClick={() => handleReset("templates")}>
                Réinitialiser
              </button>
              <button className="button primary small" onClick={() => setShowTemplateForm(true)}>
                + Nouveau template
              </button>
            </div>
          </div>

          {showTemplateForm && (
            <div className="card template-form" style={{ marginBottom: "1rem" }}>
              <div className="card-header">
                <h4>Nouveau template</h4>
              </div>
              <div className="form-grid" style={{ padding: "1rem" }}>
                <label className="form-field">
                  <span>Nom *</span>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                    placeholder="Ex: Gestion des contrats"
                  />
                </label>
                <label className="form-field">
                  <span>Catégorie *</span>
                  <select
                    value={templateForm.category}
                    onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field full-width">
                  <span>Description</span>
                  <textarea
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
                    placeholder="Description du processus..."
                    rows={2}
                  />
                </label>
                <label className="form-field">
                  <span>RTO par défaut (heures)</span>
                  <input
                    type="number"
                    min="0"
                    value={templateForm.defaultRtoHours}
                    onChange={(e) => setTemplateForm({ ...templateForm, defaultRtoHours: Number(e.target.value) })}
                  />
                </label>
                <label className="form-field">
                  <span>RPO par défaut (minutes)</span>
                  <input
                    type="number"
                    min="0"
                    value={templateForm.defaultRpoMinutes}
                    onChange={(e) => setTemplateForm({ ...templateForm, defaultRpoMinutes: Number(e.target.value) })}
                  />
                </label>
                <label className="form-field">
                  <span>MTPD par défaut (heures)</span>
                  <input
                    type="number"
                    min="0"
                    value={templateForm.defaultMtpdHours}
                    onChange={(e) => setTemplateForm({ ...templateForm, defaultMtpdHours: Number(e.target.value) })}
                  />
                </label>
                <label className="form-field">
                  <span>Impact financier suggéré (1-5)</span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={templateForm.suggestedFinancialImpact}
                    onChange={(e) => setTemplateForm({ ...templateForm, suggestedFinancialImpact: Number(e.target.value) })}
                  />
                  <span className="range-value">{templateForm.suggestedFinancialImpact}</span>
                </label>
                <label className="form-field">
                  <span>Impact réglementaire suggéré (1-5)</span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={templateForm.suggestedRegulatoryImpact}
                    onChange={(e) => setTemplateForm({ ...templateForm, suggestedRegulatoryImpact: Number(e.target.value) })}
                  />
                  <span className="range-value">{templateForm.suggestedRegulatoryImpact}</span>
                </label>
              </div>
              <div className="form-actions" style={{ padding: "0 1rem 1rem" }}>
                <button className="button" onClick={() => setShowTemplateForm(false)}>Annuler</button>
                <button
                  className="button primary"
                  onClick={handleCreateTemplate}
                  disabled={saving || !templateForm.name}
                >
                  {saving ? "Création..." : "Créer"}
                </button>
              </div>
            </div>
          )}

          <div className="templates-grid">
            {settings.processTemplates.map((template) => (
              <div
                key={template.id}
                className={`template-card ${!template.isActive ? "inactive" : ""}`}
              >
                <div className="template-header">
                  <div className="template-title">
                    <h4>{template.name}</h4>
                    {template.isBuiltIn && <span className="pill small subtle">Built-in</span>}
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={template.isActive}
                      onChange={(e) => handleToggleTemplate(template.id, e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
                {template.description && (
                  <p className="muted small">{template.description}</p>
                )}
                <div className="template-meta">
                  <span className="pill small subtle">{CATEGORIES.find((c) => c.value === template.category)?.label || template.category}</span>
                  <span className="muted small">RTO: {template.defaultRtoHours}h</span>
                  <span className="muted small">RPO: {template.defaultRpoMinutes}min</span>
                </div>
                {!template.isBuiltIn && (
                  <button
                    className="button small danger"
                    onClick={() => handleDeleteTemplate(template.id)}
                    style={{ marginTop: "0.5rem" }}
                  >
                    Supprimer
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thresholds Tab */}
      {activeTab === "thresholds" && (
        <div className="settings-section">
          <div className="section-header">
            <div>
              <h3>Seuils de criticité</h3>
              <p className="muted small">Configurez les niveaux de criticité et leurs actions associées.</p>
            </div>
            <button className="button small" onClick={() => handleReset("thresholds")}>
              Réinitialiser
            </button>
          </div>

          <div className="thresholds-list">
            {settings.criticalityThresholds.map((threshold, idx) => (
              <div key={threshold.level} className="threshold-card">
                <div
                  className="threshold-color"
                  style={{ backgroundColor: threshold.color }}
                />
                <div className="threshold-content">
                  <div className="threshold-header">
                    <h4>{threshold.label}</h4>
                    <span className="muted small">
                      Score: {threshold.minScore} - {threshold.maxScore}
                    </span>
                  </div>
                  <div className="threshold-options">
                    <label className="checkbox-option">
                      <input
                        type="checkbox"
                        checked={threshold.actionRequired}
                        onChange={(e) => handleUpdateThreshold(idx, "actionRequired", e.target.checked)}
                      />
                      <span>Action requise</span>
                    </label>
                    <label className="checkbox-option">
                      <input
                        type="checkbox"
                        checked={threshold.notifyOnCreate}
                        onChange={(e) => handleUpdateThreshold(idx, "notifyOnCreate", e.target.checked)}
                      />
                      <span>Notifier à la création</span>
                    </label>
                  </div>
                  <div className="threshold-color-picker">
                    <label>
                      <span className="muted small">Couleur:</span>
                      <input
                        type="color"
                        value={threshold.color}
                        onChange={(e) => handleUpdateThreshold(idx, "color", e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerts Tab */}
      {activeTab === "alerts" && (
        <div className="settings-section">
          <div className="section-header">
            <div>
              <h3>Configuration des alertes</h3>
              <p className="muted small">Configurez les notifications automatiques pour les événements BIA.</p>
            </div>
            <button className="button small" onClick={() => handleReset("alerts")}>
              Réinitialiser
            </button>
          </div>

          <div className="alerts-config-list">
            {settings.alertConfigurations.map((alert) => {
              const alertType = ALERT_TYPES.find((t) => t.value === alert.type);
              return (
                <div key={alert.id} className="alert-config-card">
                  <div className="alert-config-header">
                    <div>
                      <h4>{alertType?.label || alert.type}</h4>
                      <p className="muted small">{alertType?.description}</p>
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={alert.isEnabled}
                        onChange={(e) => handleUpdateAlert(alert.id, { isEnabled: e.target.checked })}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                  {alert.isEnabled && (
                    <div className="alert-config-options">
                      <div className="config-row">
                        <label className="form-field">
                          <span>Fréquence</span>
                          <select
                            value={alert.frequency}
                            onChange={(e) => handleUpdateAlert(alert.id, { frequency: e.target.value as any })}
                          >
                            {FREQUENCIES.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                        </label>
                        {(alert.type === "rto_breach" || alert.type === "risk_increase") && (
                          <label className="form-field">
                            <span>Seuil</span>
                            <input
                              type="number"
                              value={alert.threshold || 0}
                              onChange={(e) => handleUpdateAlert(alert.id, { threshold: Number(e.target.value) })}
                              min="0"
                            />
                          </label>
                        )}
                      </div>
                      <div className="config-row">
                        <label className="form-field">
                          <span>Canaux</span>
                          <div className="channel-checkboxes">
                            {CHANNELS.map((channel) => (
                              <label key={channel.value} className="checkbox-option">
                                <input
                                  type="checkbox"
                                  checked={alert.channels.includes(channel.value as any)}
                                  onChange={(e) => {
                                    const newChannels = e.target.checked
                                      ? [...alert.channels, channel.value]
                                      : alert.channels.filter((c) => c !== channel.value);
                                    handleUpdateAlert(alert.id, { channels: newChannels as any });
                                  }}
                                />
                                <span>{channel.label}</span>
                              </label>
                            ))}
                          </div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Display Tab */}
      {activeTab === "display" && (
        <div className="settings-section">
          <div className="section-header">
            <div>
              <h3>Préférences d'affichage</h3>
              <p className="muted small">Personnalisez l'interface de la section BIA.</p>
            </div>
            <button className="button small" onClick={() => handleReset("display")}>
              Réinitialiser
            </button>
          </div>

          <div className="display-options">
            <div className="card" style={{ padding: "1rem" }}>
              <div className="form-grid">
                <label className="form-field">
                  <span>Onglet par défaut</span>
                  <select
                    value={settings.displayPreferences.defaultTab}
                    onChange={(e) => handleUpdateDisplay({ defaultTab: e.target.value as any })}
                  >
                    <option value="dashboard">Dashboard</option>
                    <option value="wizard">Assistant</option>
                    <option value="prioritization">Priorisation</option>
                    <option value="reports">Rapports</option>
                    <option value="integration">Intégration</option>
                    <option value="list">Liste</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Éléments par page</span>
                  <select
                    value={settings.displayPreferences.itemsPerPage}
                    onChange={(e) => handleUpdateDisplay({ itemsPerPage: Number(e.target.value) })}
                  >
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Tri par défaut</span>
                  <select
                    value={settings.displayPreferences.defaultSortField}
                    onChange={(e) => handleUpdateDisplay({ defaultSortField: e.target.value })}
                  >
                    <option value="criticalityScore">Score de criticité</option>
                    <option value="impactScore">Score d'impact</option>
                    <option value="name">Nom</option>
                    <option value="rtoHours">RTO</option>
                    <option value="createdAt">Date de création</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Ordre de tri</span>
                  <select
                    value={settings.displayPreferences.defaultSortOrder}
                    onChange={(e) => handleUpdateDisplay({ defaultSortOrder: e.target.value as any })}
                  >
                    <option value="desc">Décroissant</option>
                    <option value="asc">Croissant</option>
                  </select>
                </label>
              </div>

              <div className="display-toggles" style={{ marginTop: "1rem" }}>
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={settings.displayPreferences.showCriticalOnly}
                    onChange={(e) => handleUpdateDisplay({ showCriticalOnly: e.target.checked })}
                  />
                  <span>Afficher uniquement les processus critiques</span>
                </label>
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={settings.displayPreferences.showImpactMatrix}
                    onChange={(e) => handleUpdateDisplay({ showImpactMatrix: e.target.checked })}
                  />
                  <span>Afficher la matrice d'impact dans la liste</span>
                </label>
              </div>

              <div className="color-config" style={{ marginTop: "1.5rem" }}>
                <h4>Couleurs des niveaux</h4>
                <div className="color-grid">
                  <label className="color-picker">
                    <span>Critique</span>
                    <input
                      type="color"
                      value={settings.displayPreferences.chartColors.critical}
                      onChange={(e) => handleUpdateDisplay({
                        chartColors: { ...settings.displayPreferences.chartColors, critical: e.target.value }
                      })}
                    />
                  </label>
                  <label className="color-picker">
                    <span>Élevé</span>
                    <input
                      type="color"
                      value={settings.displayPreferences.chartColors.high}
                      onChange={(e) => handleUpdateDisplay({
                        chartColors: { ...settings.displayPreferences.chartColors, high: e.target.value }
                      })}
                    />
                  </label>
                  <label className="color-picker">
                    <span>Modéré</span>
                    <input
                      type="color"
                      value={settings.displayPreferences.chartColors.medium}
                      onChange={(e) => handleUpdateDisplay({
                        chartColors: { ...settings.displayPreferences.chartColors, medium: e.target.value }
                      })}
                    />
                  </label>
                  <label className="color-picker">
                    <span>Faible</span>
                    <input
                      type="color"
                      value={settings.displayPreferences.chartColors.low}
                      onChange={(e) => handleUpdateDisplay({
                        chartColors: { ...settings.displayPreferences.chartColors, low: e.target.value }
                      })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="settings-footer">
        <span className="muted small">
          Dernière mise à jour: {new Date(settings.lastUpdated).toLocaleString("fr-FR")}
        </span>
      </div>
    </div>
  );
}

// Styles
export const biaSettingsStyles = `
.bia-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.settings-tabs {
  display: flex;
  gap: 0.5rem;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.5rem;
  margin-bottom: 1rem;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.section-header h3 {
  margin: 0 0 0.25rem 0;
}

.section-actions {
  display: flex;
  gap: 0.5rem;
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.template-card {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.template-card.inactive {
  opacity: 0.6;
  background: var(--color-surface-secondary);
}

.template-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.template-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.template-title h4 {
  margin: 0;
}

.template-meta {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-border);
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.toggle input:checked + .toggle-slider {
  background-color: var(--color-primary);
}

.toggle input:checked + .toggle-slider:before {
  transform: translateX(20px);
}

.thresholds-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.threshold-card {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.threshold-color {
  width: 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.threshold-content {
  flex: 1;
}

.threshold-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.threshold-header h4 {
  margin: 0;
}

.threshold-options {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 0.5rem;
}

.threshold-color-picker {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.threshold-color-picker input[type="color"] {
  width: 32px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
}

.checkbox-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.alerts-config-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.alert-config-card {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.alert-config-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.alert-config-header h4 {
  margin: 0 0 0.25rem 0;
}

.alert-config-options {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.config-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.channel-checkboxes {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.display-options {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.display-toggles {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.color-config h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

.color-picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.color-picker input[type="color"] {
  width: 48px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
}

.settings-footer {
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
  text-align: right;
}

.form-field.full-width {
  grid-column: 1 / -1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.range-value {
  font-weight: 600;
  margin-left: 0.5rem;
}

.button.danger {
  background: var(--color-error);
  color: white;
}

.button.danger:hover {
  background: #b91c1c;
}
`;

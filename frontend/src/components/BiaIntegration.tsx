import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../utils/api";
import type { BusinessProcess } from "../types";

interface BiaIntegrationProps {
  processes: BusinessProcess[];
  onNavigateToProcess: (processId: string) => void;
}

interface LinkedRisk {
  id: string;
  title: string;
  description: string | null;
  threatType: string;
  probability: number;
  impact: number;
  score: number;
  level: string;
  status: string | null;
  owner: string | null;
  processName: string | null;
  serviceName: string | null;
  mitigationCount: number;
  createdAt: string;
}

interface LinkedRunbook {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  scenarioTitle: string | null;
  generatedAt: string;
  hasDownloads: boolean;
}

interface LinkedIncident {
  id: string;
  title: string;
  description: string | null;
  status: string;
  detectedAt: string;
  responsibleTeam: string | null;
  impactedServices: Array<{ id: string; name: string }>;
  actionCount: number;
  createdAt: string;
}

interface CrossModuleAlert {
  type: "risk" | "incident" | "runbook" | "coverage";
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  processId?: string;
  processName?: string;
  relatedId?: string;
}

interface IntegrationSummary {
  tenantId: string;
  processCount: number;
  totalRisks: number;
  highRisks: number;
  criticalRisks: number;
  totalRunbooks: number;
  activeRunbooks: number;
  totalIncidents: number;
  openIncidents: number;
  inProgressIncidents: number;
  processesWithRisks: number;
  processesWithRunbooks: number;
  processesWithIncidents: number;
  crossModuleAlerts: CrossModuleAlert[];
}

interface ProcessIntegration {
  processId: string;
  processName: string;
  risks: LinkedRisk[];
  runbooks: LinkedRunbook[];
  incidents: LinkedIncident[];
  summary: {
    riskCount: number;
    highRiskCount: number;
    runbookCount: number;
    activeIncidentCount: number;
    totalIncidentCount: number;
  };
}

const THREAT_TYPES = [
  { value: "cyber", label: "Cyber" },
  { value: "physical", label: "Physique" },
  { value: "supplier", label: "Fournisseur" },
  { value: "human", label: "Humain" },
  { value: "operational", label: "Opérationnel" },
  { value: "environmental", label: "Environnemental" },
  { value: "compliance", label: "Conformité" },
];

export function BiaIntegration({ processes, onNavigateToProcess }: BiaIntegrationProps) {
  const [summary, setSummary] = useState<IntegrationSummary | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [processIntegration, setProcessIntegration] = useState<ProcessIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [processLoading, setProcessLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "risks" | "runbooks" | "incidents">("overview");

  // Risk creation modal
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [riskForm, setRiskForm] = useState({
    title: "",
    description: "",
    threatType: "operational",
    probability: 3,
    impact: 3,
  });
  const [creatingRisk, setCreatingRisk] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch("/bia/integration/summary");
      setSummary(data);
    } catch (err: any) {
      setError(err.message || "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProcessIntegration = useCallback(async (processId: string) => {
    try {
      setProcessLoading(true);
      const data = await apiFetch(`/bia/integration/process/${processId}`);
      setProcessIntegration(data);
    } catch (err: any) {
      console.error("Failed to load process integration", err);
    } finally {
      setProcessLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (selectedProcess) {
      loadProcessIntegration(selectedProcess);
    } else {
      setProcessIntegration(null);
    }
  }, [selectedProcess, loadProcessIntegration]);

  const handleCreateRisk = async () => {
    if (!selectedProcess) return;

    try {
      setCreatingRisk(true);
      await apiFetch(`/bia/integration/process/${selectedProcess}/create-risk`, {
        method: "POST",
        body: JSON.stringify(riskForm),
      });
      setShowRiskModal(false);
      setRiskForm({
        title: "",
        description: "",
        threatType: "operational",
        probability: 3,
        impact: 3,
      });
      await loadProcessIntegration(selectedProcess);
      await loadSummary();
    } catch (err: any) {
      alert(err.message || "Erreur lors de la création du risque");
    } finally {
      setCreatingRisk(false);
    }
  };

  const getSeverityClass = (severity: string) => {
    switch (severity) {
      case "critical":
        return "error";
      case "high":
        return "warning";
      case "medium":
        return "info";
      default:
        return "subtle";
    }
  };

  const getRiskLevelClass = (level: string) => {
    switch (level.toLowerCase()) {
      case "critical":
        return "error";
      case "high":
        return "warning";
      case "medium":
        return "info";
      default:
        return "success";
    }
  };

  const getIncidentStatusClass = (status: string) => {
    switch (status) {
      case "OPEN":
        return "error";
      case "IN_PROGRESS":
        return "warning";
      case "RESOLVED":
        return "info";
      default:
        return "success";
    }
  };

  if (loading) {
    return <div className="skeleton">Chargement de l'intégration...</div>;
  }

  if (error) {
    return <div className="alert error">{error}</div>;
  }

  if (!summary) {
    return <div className="alert info">Aucune donnée d'intégration disponible.</div>;
  }

  return (
    <div className="bia-integration">
      {/* Summary Cards */}
      <div className="integration-grid">
        <div className="card integration-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Risques</p>
              <h3>{summary.totalRisks}</h3>
            </div>
          </div>
          <div className="integration-stats">
            <div className="stat-row">
              <span className="muted">Critiques</span>
              <span className={`pill small ${summary.criticalRisks > 0 ? "error" : "success"}`}>
                {summary.criticalRisks}
              </span>
            </div>
            <div className="stat-row">
              <span className="muted">Élevés</span>
              <span className={`pill small ${summary.highRisks > 0 ? "warning" : "success"}`}>
                {summary.highRisks}
              </span>
            </div>
            <div className="stat-row">
              <span className="muted">Processus concernés</span>
              <span className="pill small subtle">{summary.processesWithRisks}</span>
            </div>
          </div>
        </div>

        <div className="card integration-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Runbooks</p>
              <h3>{summary.totalRunbooks}</h3>
            </div>
          </div>
          <div className="integration-stats">
            <div className="stat-row">
              <span className="muted">Actifs</span>
              <span className="pill small info">{summary.activeRunbooks}</span>
            </div>
            <div className="stat-row">
              <span className="muted">Processus couverts</span>
              <span className="pill small subtle">{summary.processesWithRunbooks}</span>
            </div>
          </div>
        </div>

        <div className="card integration-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Incidents</p>
              <h3>{summary.totalIncidents}</h3>
            </div>
          </div>
          <div className="integration-stats">
            <div className="stat-row">
              <span className="muted">Ouverts</span>
              <span className={`pill small ${summary.openIncidents > 0 ? "error" : "success"}`}>
                {summary.openIncidents}
              </span>
            </div>
            <div className="stat-row">
              <span className="muted">En cours</span>
              <span className={`pill small ${summary.inProgressIncidents > 0 ? "warning" : "success"}`}>
                {summary.inProgressIncidents}
              </span>
            </div>
            <div className="stat-row">
              <span className="muted">Processus impactés</span>
              <span className="pill small subtle">{summary.processesWithIncidents}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cross-Module Alerts */}
      {summary.crossModuleAlerts.length > 0 && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <div className="card-header">
            <div>
              <p className="eyebrow">Alertes</p>
              <h3>Alertes inter-modules</h3>
            </div>
            <span className="pill error">{summary.crossModuleAlerts.length}</span>
          </div>
          <div className="alerts-list">
            {summary.crossModuleAlerts.slice(0, 10).map((alert, idx) => (
              <div key={idx} className={`alert-item ${getSeverityClass(alert.severity)}`}>
                <div className="alert-icon">
                  {alert.type === "risk" && "⚠️"}
                  {alert.type === "incident" && "🔴"}
                  {alert.type === "runbook" && "📋"}
                  {alert.type === "coverage" && "📊"}
                </div>
                <div className="alert-content">
                  <span className={`pill small ${getSeverityClass(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <p>{alert.message}</p>
                </div>
                {alert.processId && (
                  <button
                    className="button small"
                    onClick={() => setSelectedProcess(alert.processId!)}
                  >
                    Voir
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Process Selection & Detail */}
      <div className="integration-detail" style={{ marginTop: "1rem" }}>
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Détail</p>
              <h3>Intégration par processus</h3>
            </div>
          </div>
          <div className="process-selector">
            <label className="form-field">
              <span>Sélectionner un processus</span>
              <select
                value={selectedProcess || ""}
                onChange={(e) => setSelectedProcess(e.target.value || null)}
              >
                <option value="">-- Choisir un processus --</option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (Score: {p.criticalityScore.toFixed(1)})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedProcess && processLoading && (
            <div className="skeleton">Chargement des données d'intégration...</div>
          )}

          {selectedProcess && processIntegration && !processLoading && (
            <div className="process-integration-detail">
              {/* Process Summary */}
              <div className="process-summary-row">
                <div className="summary-stat">
                  <span className="stat-value">{processIntegration.summary.riskCount}</span>
                  <span className="stat-label">Risques</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value">{processIntegration.summary.highRiskCount}</span>
                  <span className="stat-label">Risques élevés</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value">{processIntegration.summary.runbookCount}</span>
                  <span className="stat-label">Runbooks</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value">{processIntegration.summary.activeIncidentCount}</span>
                  <span className="stat-label">Incidents actifs</span>
                </div>
              </div>

              {/* Tabs */}
              <div className="integration-tabs">
                <button
                  className={`tab-button ${activeTab === "risks" ? "active" : ""}`}
                  onClick={() => setActiveTab("risks")}
                >
                  Risques ({processIntegration.risks.length})
                </button>
                <button
                  className={`tab-button ${activeTab === "runbooks" ? "active" : ""}`}
                  onClick={() => setActiveTab("runbooks")}
                >
                  Runbooks ({processIntegration.runbooks.length})
                </button>
                <button
                  className={`tab-button ${activeTab === "incidents" ? "active" : ""}`}
                  onClick={() => setActiveTab("incidents")}
                >
                  Incidents ({processIntegration.incidents.length})
                </button>
              </div>

              {/* Risks Tab */}
              {activeTab === "risks" && (
                <div className="tab-content">
                  <div className="tab-actions">
                    <button className="button primary small" onClick={() => setShowRiskModal(true)}>
                      + Ajouter un risque
                    </button>
                  </div>
                  {processIntegration.risks.length === 0 ? (
                    <p className="muted">Aucun risque lié à ce processus.</p>
                  ) : (
                    <div className="linked-items-list">
                      {processIntegration.risks.map((risk) => (
                        <div key={risk.id} className="linked-item risk-item">
                          <div className="item-header">
                            <span className={`pill small ${getRiskLevelClass(risk.level)}`}>
                              {risk.level} ({risk.score})
                            </span>
                            <span className="pill small subtle">{risk.threatType}</span>
                          </div>
                          <h4>{risk.title}</h4>
                          {risk.description && (
                            <p className="muted small">{risk.description}</p>
                          )}
                          <div className="item-meta">
                            <span className="muted small">
                              P: {risk.probability} | I: {risk.impact}
                            </span>
                            {risk.status && (
                              <span className="pill small subtle">{risk.status}</span>
                            )}
                            <span className="muted small">
                              {risk.mitigationCount} mitigation(s)
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Runbooks Tab */}
              {activeTab === "runbooks" && (
                <div className="tab-content">
                  {processIntegration.runbooks.length === 0 ? (
                    <p className="muted">Aucun runbook lié à ce processus.</p>
                  ) : (
                    <div className="linked-items-list">
                      {processIntegration.runbooks.map((runbook) => (
                        <div key={runbook.id} className="linked-item runbook-item">
                          <div className="item-header">
                            <span className={`pill small ${runbook.status === "ACTIVE" ? "success" : "subtle"}`}>
                              {runbook.status}
                            </span>
                            {runbook.hasDownloads && (
                              <span className="pill small info">Téléchargeable</span>
                            )}
                          </div>
                          <h4>{runbook.title}</h4>
                          {runbook.summary && (
                            <p className="muted small">{runbook.summary}</p>
                          )}
                          <div className="item-meta">
                            {runbook.scenarioTitle && (
                              <span className="muted small">Scénario: {runbook.scenarioTitle}</span>
                            )}
                            <span className="muted small">
                              Généré le {new Date(runbook.generatedAt).toLocaleDateString("fr-FR")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Incidents Tab */}
              {activeTab === "incidents" && (
                <div className="tab-content">
                  {processIntegration.incidents.length === 0 ? (
                    <p className="muted">Aucun incident lié à ce processus.</p>
                  ) : (
                    <div className="linked-items-list">
                      {processIntegration.incidents.map((incident) => (
                        <div key={incident.id} className="linked-item incident-item">
                          <div className="item-header">
                            <span className={`pill small ${getIncidentStatusClass(incident.status)}`}>
                              {incident.status}
                            </span>
                          </div>
                          <h4>{incident.title}</h4>
                          {incident.description && (
                            <p className="muted small">{incident.description}</p>
                          )}
                          <div className="item-meta">
                            <span className="muted small">
                              Détecté le {new Date(incident.detectedAt).toLocaleDateString("fr-FR")}
                            </span>
                            {incident.responsibleTeam && (
                              <span className="muted small">Équipe: {incident.responsibleTeam}</span>
                            )}
                            <span className="muted small">{incident.actionCount} action(s)</span>
                          </div>
                          {incident.impactedServices.length > 0 && (
                            <div className="impacted-services">
                              {incident.impactedServices.map((svc) => (
                                <span key={svc.id} className="pill small subtle">
                                  {svc.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Risk Creation Modal */}
      {showRiskModal && (
        <div className="modal-overlay" onClick={() => setShowRiskModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Créer un risque pour {processIntegration?.processName}</h3>
              <button className="close-button" onClick={() => setShowRiskModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <label className="form-field">
                  <span>Titre *</span>
                  <input
                    type="text"
                    value={riskForm.title}
                    onChange={(e) => setRiskForm({ ...riskForm, title: e.target.value })}
                    placeholder="Ex: Perte de données client"
                  />
                </label>
                <label className="form-field">
                  <span>Type de menace *</span>
                  <select
                    value={riskForm.threatType}
                    onChange={(e) => setRiskForm({ ...riskForm, threatType: e.target.value })}
                  >
                    {THREAT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field full-width">
                  <span>Description</span>
                  <textarea
                    value={riskForm.description}
                    onChange={(e) => setRiskForm({ ...riskForm, description: e.target.value })}
                    placeholder="Description détaillée du risque..."
                    rows={3}
                  />
                </label>
                <label className="form-field">
                  <span>Probabilité (1-5)</span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={riskForm.probability}
                    onChange={(e) => setRiskForm({ ...riskForm, probability: Number(e.target.value) })}
                  />
                  <span className="range-value">{riskForm.probability}</span>
                </label>
                <label className="form-field">
                  <span>Impact (1-5)</span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={riskForm.impact}
                    onChange={(e) => setRiskForm({ ...riskForm, impact: Number(e.target.value) })}
                  />
                  <span className="range-value">{riskForm.impact}</span>
                </label>
              </div>
              <div className="risk-preview">
                <span className="muted">Score estimé: </span>
                <span className={`pill ${riskForm.probability * riskForm.impact >= 15 ? "error" : riskForm.probability * riskForm.impact >= 10 ? "warning" : "success"}`}>
                  {riskForm.probability * riskForm.impact}
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="button" onClick={() => setShowRiskModal(false)}>
                Annuler
              </button>
              <button
                className="button primary"
                onClick={handleCreateRisk}
                disabled={creatingRisk || !riskForm.title}
              >
                {creatingRisk ? "Création..." : "Créer le risque"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Styles
export const biaIntegrationStyles = `
.bia-integration {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.integration-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

@media (max-width: 900px) {
  .integration-grid {
    grid-template-columns: 1fr;
  }
}

.integration-card .card-header h3 {
  font-size: 2rem;
  margin-top: 0.5rem;
}

.integration-stats {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.alerts-list {
  padding: 0.5rem;
}

.alert-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border);
  border-left: 3px solid transparent;
}

.alert-item:last-child {
  border-bottom: none;
}

.alert-item.error {
  border-left-color: var(--color-error);
  background: rgba(var(--color-error-rgb, 220, 38, 38), 0.05);
}

.alert-item.warning {
  border-left-color: var(--color-warning);
  background: rgba(var(--color-warning-rgb, 245, 158, 11), 0.05);
}

.alert-item.info {
  border-left-color: var(--color-primary);
  background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.05);
}

.alert-icon {
  font-size: 1.25rem;
}

.alert-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.alert-content p {
  margin: 0;
  font-size: 0.875rem;
}

.process-selector {
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.process-integration-detail {
  padding: 1rem;
}

.process-summary-row {
  display: flex;
  gap: 2rem;
  padding: 1rem;
  background: var(--color-surface-secondary);
  border-radius: 8px;
  margin-bottom: 1rem;
}

.summary-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.summary-stat .stat-value {
  font-size: 1.5rem;
  font-weight: 600;
}

.summary-stat .stat-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.integration-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.5rem;
}

.tab-content {
  padding: 0.5rem 0;
}

.tab-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1rem;
}

.linked-items-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.linked-item {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.linked-item:hover {
  border-color: var(--color-primary);
}

.item-header {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.linked-item h4 {
  margin: 0 0 0.25rem 0;
  font-size: 0.9375rem;
}

.item-meta {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.impacted-services {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-surface);
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h3 {
  margin: 0;
}

.close-button {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--color-text-secondary);
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.form-field.full-width {
  grid-column: 1 / -1;
}

.range-value {
  font-weight: 600;
  margin-left: 0.5rem;
}

.risk-preview {
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--color-surface-secondary);
  border-radius: 8px;
  text-align: center;
}
`;

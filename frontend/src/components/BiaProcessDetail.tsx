import { Suspense, lazy, useMemo, useState } from "react";
import type { BusinessProcess, Service } from "../types";

const ReactECharts = lazy(() => import("echarts-for-react"));

interface BiaProcessDetailProps {
  process: BusinessProcess;
  services: Service[];
  onClose: () => void;
  onExportPdf?: () => void;
}

type DetailTab = "overview" | "impacts" | "recovery" | "risks" | "history";

function SeverityBadge({ level }: { level: number }) {
  const className = level >= 4 ? "error" : level >= 3 ? "warning" : "success";
  const label = level >= 4 ? "Critique" : level >= 3 ? "Modéré" : "Faible";
  return <span className={`pill ${className}`}>{label}</span>;
}

function ImpactGauge({ value, label, max = 5 }: { value: number; label: string; max?: number }) {
  const percentage = (value / max) * 100;
  const color = value >= 4 ? "var(--color-error)" : value >= 3 ? "var(--color-warning)" : "var(--color-success)";

  return (
    <div className="impact-gauge">
      <div className="gauge-label">
        <span>{label}</span>
        <span className="gauge-value">{value}/{max}</span>
      </div>
      <div className="gauge-bar">
        <div className="gauge-fill" style={{ width: `${percentage}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`collapsible-section ${isOpen ? "open" : ""}`}>
      <button
        className="collapsible-header"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="collapsible-icon">{isOpen ? "−" : "+"}</span>
        <span className="collapsible-title">{title}</span>
        {badge}
      </button>
      {isOpen && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

export function BiaProcessDetail({ process, services, onClose, onExportPdf }: BiaProcessDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  const linkedServices = useMemo(() => {
    return process.services.map((link) => {
      const service = services.find((s) => s.id === link.serviceId);
      return service || link.service;
    });
  }, [process.services, services]);

  const criticalityLevel = process.criticalityScore >= 4 ? "critical" :
    process.criticalityScore >= 3 ? "high" :
    process.criticalityScore >= 2 ? "medium" : "low";

  const impactRadarOptions = useMemo(() => {
    return {
      tooltip: {},
      radar: {
        indicator: [
          { name: "Financier", max: 5 },
          { name: "Réglementaire", max: 5 },
          { name: "Opérationnel", max: 5 },
          { name: "Réputationnel", max: 5 },
        ],
        shape: "polygon",
        splitNumber: 5,
        axisName: {
          color: "var(--color-text-secondary)",
        },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: [
                process.financialImpactLevel,
                process.regulatoryImpactLevel,
                Math.round(process.impactScore),
                Math.round((process.financialImpactLevel + process.regulatoryImpactLevel) / 2),
              ],
              name: "Impact",
              areaStyle: {
                opacity: 0.3,
              },
            },
          ],
        },
      ],
    };
  }, [process]);

  const recoveryTimelineOptions = useMemo(() => {
    const maxTime = Math.max(process.rtoHours, process.mtpdHours, process.rpoMinutes / 60);

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      grid: { left: 60, right: 30, top: 20, bottom: 30 },
      xAxis: {
        type: "value",
        name: "Heures",
        max: maxTime * 1.2,
      },
      yAxis: {
        type: "category",
        data: ["RPO", "RTO", "MTPD"],
      },
      series: [
        {
          type: "bar",
          data: [
            {
              value: process.rpoMinutes / 60,
              itemStyle: { color: "#5470c6" },
            },
            {
              value: process.rtoHours,
              itemStyle: {
                color: process.rtoHours > process.mtpdHours ? "var(--color-error)" : "#91cc75",
              },
            },
            {
              value: process.mtpdHours,
              itemStyle: { color: "#fac858" },
            },
          ],
          label: {
            show: true,
            position: "right",
            formatter: (params: any) => {
              const hours = params.value;
              if (params.dataIndex === 0) {
                return `${Math.round(hours * 60)} min`;
              }
              return `${hours}h`;
            },
          },
        },
      ],
    };
  }, [process]);

  const rtoExceedsMtpd = process.rtoHours > process.mtpdHours;

  return (
    <div className="process-detail-modal">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content process-detail">
        {/* Header */}
        <div className="detail-header">
          <div className="header-main">
            <div className="header-info">
              <span className={`criticality-indicator ${criticalityLevel}`} />
              <div>
                <h2>{process.name}</h2>
                {process.owners && <p className="muted">{process.owners}</p>}
              </div>
            </div>
            <div className="header-actions">
              <SeverityBadge level={Math.round(process.criticalityScore)} />
              {onExportPdf && (
                <button className="button" onClick={onExportPdf}>
                  Exporter PDF
                </button>
              )}
              <button className="button" onClick={onClose}>
                Fermer
              </button>
            </div>
          </div>
          {process.description && (
            <p className="detail-description">{process.description}</p>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="detail-tabs">
          <button
            className={`detail-tab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            Vue d'ensemble
          </button>
          <button
            className={`detail-tab ${activeTab === "impacts" ? "active" : ""}`}
            onClick={() => setActiveTab("impacts")}
          >
            Impacts
          </button>
          <button
            className={`detail-tab ${activeTab === "recovery" ? "active" : ""}`}
            onClick={() => setActiveTab("recovery")}
          >
            Reprise
            {rtoExceedsMtpd && <span className="tab-alert">!</span>}
          </button>
          <button
            className={`detail-tab ${activeTab === "risks" ? "active" : ""}`}
            onClick={() => setActiveTab("risks")}
          >
            Risques
          </button>
          <button
            className={`detail-tab ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            Historique
          </button>
        </div>

        {/* Tab Content */}
        <div className="detail-content">
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="tab-content overview-tab">
              <div className="overview-grid">
                {/* Key Metrics */}
                <div className="card metrics-card">
                  <h4>Indicateurs clés</h4>
                  <div className="metrics-grid">
                    <div className="metric">
                      <span className="metric-label">Score de criticité</span>
                      <span className={`metric-value ${criticalityLevel}`}>
                        {process.criticalityScore.toFixed(2)}
                      </span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Score d'impact</span>
                      <span className="metric-value">{process.impactScore.toFixed(2)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">RTO</span>
                      <span className="metric-value">{process.rtoHours}h</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">RPO</span>
                      <span className="metric-value">{process.rpoMinutes} min</span>
                    </div>
                  </div>
                </div>

                {/* Dependencies */}
                <div className="card dependencies-card">
                  <h4>Dépendances</h4>
                  {linkedServices.length === 0 ? (
                    <p className="muted">Aucun service associé</p>
                  ) : (
                    <div className="service-list">
                      {linkedServices.map((service) => (
                        <div key={service.id} className="service-item">
                          <span className="service-name">{service.name}</span>
                          <span className={`pill ${service.criticality === "high" ? "error" : service.criticality === "medium" ? "warning" : "success"}`}>
                            {service.criticality}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {process.interdependencies && (
                    <div className="interdependencies">
                      <h5>Autres interdépendances</h5>
                      <p className="muted small">{process.interdependencies}</p>
                    </div>
                  )}
                </div>

                {/* Impact Radar */}
                <div className="card radar-card">
                  <h4>Radar d'impact</h4>
                  <Suspense fallback={<div className="skeleton">Chargement...</div>}>
                    <ReactECharts option={impactRadarOptions} style={{ height: 250 }} />
                  </Suspense>
                </div>
              </div>
            </div>
          )}

          {/* Impacts Tab */}
          {activeTab === "impacts" && (
            <div className="tab-content impacts-tab">
              <div className="impacts-grid">
                <div className="card">
                  <h4>Évaluation des impacts</h4>
                  <div className="impact-gauges">
                    <ImpactGauge value={process.financialImpactLevel} label="Impact financier" />
                    <ImpactGauge value={process.regulatoryImpactLevel} label="Impact réglementaire" />
                    <ImpactGauge value={Math.round(process.impactScore)} label="Impact opérationnel (estimé)" />
                  </div>
                </div>

                <div className="card">
                  <h4>Analyse détaillée</h4>
                  <CollapsibleSection title="Impact financier" defaultOpen badge={<SeverityBadge level={process.financialImpactLevel} />}>
                    <p className="muted">
                      Niveau d'impact financier: <strong>{process.financialImpactLevel}/5</strong>
                    </p>
                    <p className="muted small">
                      {process.financialImpactLevel >= 4
                        ? "Impact financier critique : pertes significatives en cas d'interruption prolongée."
                        : process.financialImpactLevel >= 3
                        ? "Impact financier modéré : pertes notables mais gérables."
                        : "Impact financier limité : pertes faibles ou négligeables."}
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection title="Impact réglementaire" badge={<SeverityBadge level={process.regulatoryImpactLevel} />}>
                    <p className="muted">
                      Niveau d'impact réglementaire: <strong>{process.regulatoryImpactLevel}/5</strong>
                    </p>
                    <p className="muted small">
                      {process.regulatoryImpactLevel >= 4
                        ? "Risque élevé de non-conformité : sanctions possibles."
                        : process.regulatoryImpactLevel >= 3
                        ? "Risque modéré de non-conformité : surveillance requise."
                        : "Faible risque réglementaire."}
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection title="Score de criticité global" badge={<SeverityBadge level={Math.round(process.criticalityScore)} />}>
                    <p className="muted">
                      Score calculé: <strong>{process.criticalityScore.toFixed(2)}/5</strong>
                    </p>
                    <p className="muted small">
                      Ce score combine l'impact financier (60%), l'impact réglementaire (40%)
                      et la sensibilité temporelle basée sur les objectifs RTO/RPO/MTPD.
                    </p>
                  </CollapsibleSection>
                </div>
              </div>
            </div>
          )}

          {/* Recovery Tab */}
          {activeTab === "recovery" && (
            <div className="tab-content recovery-tab">
              {rtoExceedsMtpd && (
                <div className="alert error" style={{ marginBottom: "1rem" }}>
                  <strong>Alerte :</strong> Le RTO ({process.rtoHours}h) dépasse le MTPD ({process.mtpdHours}h).
                  Le processus ne sera pas restauré avant les dommages irréversibles.
                </div>
              )}

              <div className="recovery-grid">
                <div className="card">
                  <h4>Objectifs de reprise</h4>
                  <div className="recovery-objectives">
                    <div className="objective">
                      <div className="objective-header">
                        <span className="objective-name">RTO</span>
                        <span className="objective-value">{process.rtoHours}h</span>
                      </div>
                      <p className="muted small">Recovery Time Objective - Temps maximum pour restaurer le service</p>
                    </div>
                    <div className="objective">
                      <div className="objective-header">
                        <span className="objective-name">RPO</span>
                        <span className="objective-value">{process.rpoMinutes} min</span>
                      </div>
                      <p className="muted small">Recovery Point Objective - Perte de données maximum acceptable</p>
                    </div>
                    <div className="objective">
                      <div className="objective-header">
                        <span className="objective-name">MTPD</span>
                        <span className="objective-value">{process.mtpdHours}h</span>
                      </div>
                      <p className="muted small">Maximum Tolerable Period of Disruption - Durée avant dommages irréversibles</p>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h4>Visualisation temporelle</h4>
                  <Suspense fallback={<div className="skeleton">Chargement...</div>}>
                    <ReactECharts option={recoveryTimelineOptions} style={{ height: 200 }} />
                  </Suspense>
                </div>

                <div className="card">
                  <h4>Recommandations</h4>
                  <div className="recommendations">
                    {process.criticalityScore >= 4 && (
                      <div className="recommendation">
                        <span className="rec-icon">!</span>
                        <span>Processus critique : envisager une stratégie multi-site ou warm standby.</span>
                      </div>
                    )}
                    {process.rtoHours <= 4 && (
                      <div className="recommendation">
                        <span className="rec-icon">i</span>
                        <span>RTO court : des sauvegardes fréquentes et une infrastructure redondante sont recommandées.</span>
                      </div>
                    )}
                    {process.rpoMinutes <= 30 && (
                      <div className="recommendation">
                        <span className="rec-icon">i</span>
                        <span>RPO très court : envisager une réplication synchrone ou near-synchrone.</span>
                      </div>
                    )}
                    {linkedServices.length === 0 && (
                      <div className="recommendation">
                        <span className="rec-icon">?</span>
                        <span>Aucun service associé : identifier les dépendances pour une meilleure analyse.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Risks Tab */}
          {activeTab === "risks" && (
            <div className="tab-content risks-tab">
              <div className="card">
                <h4>Risques identifiés</h4>
                <p className="muted">
                  Les risques associés à ce processus sont synchronisés avec le module de gestion des risques.
                </p>

                <div className="risk-scenarios">
                  <CollapsibleSection title="Scénario : Panne infrastructure" defaultOpen>
                    <p className="muted small">
                      Impact potentiel si les services dépendants deviennent indisponibles.
                      {linkedServices.filter(s => s.criticality === "high").length > 0 && (
                        <span className="highlight"> {linkedServices.filter(s => s.criticality === "high").length} service(s) critique(s) identifié(s).</span>
                      )}
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection title="Scénario : Cyberattaque">
                    <p className="muted small">
                      En cas de compromission, le processus pourrait être affecté.
                      Un RTO de {process.rtoHours}h et RPO de {process.rpoMinutes} min doivent être respectés.
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection title="Scénario : Sinistre site">
                    <p className="muted small">
                      Perte totale du site principal nécessitant une bascule vers le site de secours.
                    </p>
                  </CollapsibleSection>
                </div>
              </div>

              <div className="card" style={{ marginTop: "1rem" }}>
                <h4>Actions de mitigation suggérées</h4>
                <div className="mitigation-actions">
                  {process.criticalityScore >= 4 && (
                    <div className="action-item">
                      <span className="action-priority high">Haute</span>
                      <span>Mettre en place une stratégie de reprise multi-AZ ou multi-région</span>
                    </div>
                  )}
                  {process.rpoMinutes <= 60 && (
                    <div className="action-item">
                      <span className="action-priority high">Haute</span>
                      <span>Configurer des sauvegardes incrémentales fréquentes</span>
                    </div>
                  )}
                  <div className="action-item">
                    <span className="action-priority medium">Moyenne</span>
                    <span>Documenter les procédures de reprise dans un runbook dédié</span>
                  </div>
                  <div className="action-item">
                    <span className="action-priority low">Faible</span>
                    <span>Planifier des exercices de continuité réguliers</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === "history" && (
            <div className="tab-content history-tab">
              <div className="card">
                <h4>Journal des modifications</h4>
                <div className="audit-log">
                  <div className="audit-entry">
                    <div className="audit-date">
                      {new Date(process.updatedAt).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="audit-content">
                      <span className="audit-action">Dernière modification</span>
                      <p className="muted small">Processus mis à jour</p>
                    </div>
                  </div>
                  <div className="audit-entry">
                    <div className="audit-date">
                      {new Date(process.createdAt).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="audit-content">
                      <span className="audit-action">Création</span>
                      <p className="muted small">Processus BIA créé</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginTop: "1rem" }}>
                <h4>Informations de traçabilité</h4>
                <dl className="trace-info">
                  <dt>ID du processus</dt>
                  <dd><code>{process.id}</code></dd>
                  <dt>Tenant</dt>
                  <dd><code>{process.tenantId}</code></dd>
                  <dt>Créé le</dt>
                  <dd>{new Date(process.createdAt).toISOString()}</dd>
                  <dt>Modifié le</dt>
                  <dd>{new Date(process.updatedAt).toISOString()}</dd>
                </dl>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Styles
export const biaProcessDetailStyles = `
.process-detail-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}

.modal-content.process-detail {
  position: relative;
  background: var(--color-surface);
  border-radius: 12px;
  max-width: 900px;
  width: 100%;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.detail-header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-secondary);
}

.header-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.header-info {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.criticality-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-top: 8px;
}

.criticality-indicator.critical {
  background: var(--color-error);
  box-shadow: 0 0 8px var(--color-error);
}

.criticality-indicator.high {
  background: var(--color-warning);
}

.criticality-indicator.medium {
  background: var(--color-success);
}

.criticality-indicator.low {
  background: var(--color-text-muted);
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.detail-description {
  margin-top: 1rem;
  color: var(--color-text-secondary);
}

.detail-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  padding: 0 1rem;
}

.detail-tab {
  padding: 0.75rem 1rem;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-text-muted);
  border-bottom: 2px solid transparent;
  position: relative;
}

.detail-tab:hover {
  color: var(--color-text-primary);
}

.detail-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.tab-alert {
  position: absolute;
  top: 0.5rem;
  right: 0.25rem;
  width: 16px;
  height: 16px;
  background: var(--color-error);
  color: white;
  border-radius: 50%;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.tab-content {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.overview-grid .radar-card {
  grid-column: 1 / -1;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}

.metric {
  text-align: center;
  padding: 0.75rem;
  background: var(--color-surface-secondary);
  border-radius: 8px;
}

.metric-label {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-bottom: 0.25rem;
}

.metric-value {
  font-size: 1.5rem;
  font-weight: 700;
}

.metric-value.critical {
  color: var(--color-error);
}

.metric-value.high {
  color: var(--color-warning);
}

.service-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.service-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background: var(--color-surface-secondary);
  border-radius: 4px;
}

.interdependencies {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.impacts-grid {
  display: grid;
  gap: 1rem;
}

.impact-gauges {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
}

.impact-gauge {
  padding: 0.5rem 0;
}

.gauge-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
}

.gauge-value {
  font-weight: 600;
}

.gauge-bar {
  height: 8px;
  background: var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}

.gauge-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.collapsible-section {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-top: 0.75rem;
}

.collapsible-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}

.collapsible-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-secondary);
  border-radius: 4px;
  font-weight: 600;
}

.collapsible-title {
  flex: 1;
  font-weight: 500;
}

.collapsible-content {
  padding: 0 1rem 1rem;
}

.recovery-grid {
  display: grid;
  gap: 1rem;
}

.recovery-objectives {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
}

.objective {
  padding: 1rem;
  background: var(--color-surface-secondary);
  border-radius: 8px;
}

.objective-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.objective-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.objective-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-primary);
}

.recommendations {
  margin-top: 1rem;
}

.recommendation {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  background: var(--color-surface-secondary);
  border-radius: 4px;
}

.rec-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary);
  color: white;
  border-radius: 50%;
  font-size: 0.75rem;
  flex-shrink: 0;
}

.risk-scenarios {
  margin-top: 1rem;
}

.mitigation-actions {
  margin-top: 1rem;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--color-surface-secondary);
  border-radius: 4px;
}

.action-priority {
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.action-priority.high {
  background: rgba(255, 107, 107, 0.2);
  color: var(--color-error);
}

.action-priority.medium {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-warning);
}

.action-priority.low {
  background: rgba(40, 167, 69, 0.2);
  color: var(--color-success);
}

.audit-log {
  margin-top: 1rem;
}

.audit-entry {
  display: flex;
  gap: 1rem;
  padding: 1rem 0;
  border-bottom: 1px solid var(--color-border);
}

.audit-entry:last-child {
  border-bottom: none;
}

.audit-date {
  width: 150px;
  flex-shrink: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.audit-action {
  font-weight: 500;
}

.trace-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem 1rem;
  margin-top: 1rem;
}

.trace-info dt {
  color: var(--color-text-muted);
}

.trace-info dd {
  margin: 0;
}

.trace-info code {
  font-size: 0.8125rem;
  background: var(--color-surface-secondary);
  padding: 0.125rem 0.25rem;
  border-radius: 4px;
}

.highlight {
  color: var(--color-warning);
  font-weight: 500;
}

@media (max-width: 768px) {
  .process-detail-modal {
    padding: 0;
  }

  .modal-content.process-detail {
    max-height: 100vh;
    border-radius: 0;
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }

  .header-main {
    flex-direction: column;
  }

  .detail-tabs {
    overflow-x: auto;
  }
}
`;

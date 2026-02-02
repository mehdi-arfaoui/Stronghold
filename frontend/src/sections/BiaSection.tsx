import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import { BiaDashboardView } from "../components/BiaDashboard";
import type { BiaDashboard, BusinessProcess, Service } from "../types";
import { apiFetch } from "../utils/api";

interface BiaSectionProps {
  configVersion: number;
}

type BiaTab = "dashboard" | "create" | "list";

type ProcessDraft = {
  name: string;
  description: string;
  owners: string;
  financialImpactLevel: number;
  regulatoryImpactLevel: number;
  operationalImpactLevel: number;
  reputationalImpactLevel: number;
  interdependencies: string;
  rtoHours: number;
  rpoMinutes: number;
  mtpdHours: number;
  serviceIds: string[];
  domain: string;
  status: "draft" | "in_progress" | "completed";
};

const impactLevels = [
  { value: 1, label: "1 - Faible" },
  { value: 2, label: "2 - Modéré" },
  { value: 3, label: "3 - Notable" },
  { value: 4, label: "4 - Élevé" },
  { value: 5, label: "5 - Critique" },
];

const domains = [
  { value: "", label: "-- Sélectionner --" },
  { value: "finance", label: "Finance" },
  { value: "rh", label: "Ressources Humaines" },
  { value: "production", label: "Production" },
  { value: "it", label: "IT / Infrastructure" },
  { value: "commercial", label: "Commercial / Ventes" },
  { value: "logistique", label: "Logistique" },
  { value: "juridique", label: "Juridique" },
  { value: "autre", label: "Autre" },
];

const ReactECharts = lazy(() => import("echarts-for-react"));

const defaultDraft: ProcessDraft = {
  name: "",
  description: "",
  owners: "",
  financialImpactLevel: 3,
  regulatoryImpactLevel: 3,
  operationalImpactLevel: 3,
  reputationalImpactLevel: 3,
  interdependencies: "",
  rtoHours: 4,
  rpoMinutes: 60,
  mtpdHours: 24,
  serviceIds: [],
  domain: "",
  status: "draft",
};

function SeverityBadge({ level }: { level: "critical" | "high" | "medium" | "low" | number }) {
  const numLevel = typeof level === "number" ? level :
    level === "critical" ? 5 : level === "high" ? 4 : level === "medium" ? 3 : 1;
  const className = numLevel >= 4 ? "error" : numLevel >= 3 ? "warning" : "success";
  const label = numLevel >= 4 ? "Critique" : numLevel >= 3 ? "Modéré" : "Faible";
  return <span className={`pill ${className}`}>{label}</span>;
}

export function BiaSection({ configVersion }: BiaSectionProps) {
  const [activeTab, setActiveTab] = useState<BiaTab>("dashboard");
  const [services, setServices] = useState<Service[]>([]);
  const [processes, setProcesses] = useState<BusinessProcess[]>([]);
  const [dashboard, setDashboard] = useState<BiaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProcessDraft>({ ...defaultDraft });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Filters for list view
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDomain, setFilterDomain] = useState<string>("all");
  const [filterCriticality, setFilterCriticality] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const loadBia = async () => {
    try {
      setLoading(true);
      setError(null);
      const [servicesData, processData] = await Promise.all([
        apiFetch("/services"),
        apiFetch("/bia/processes"),
      ]);
      setServices(servicesData);
      setProcesses(processData);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async () => {
    try {
      setDashboardLoading(true);
      setDashboardError(null);
      const data = await apiFetch("/bia/dashboard");
      setDashboard(data);
    } catch (err: any) {
      setDashboardError(err.message || "Erreur lors du chargement du dashboard");
    } finally {
      setDashboardLoading(false);
    }
  };

  useEffect(() => {
    loadBia();
    loadDashboard();
  }, [configVersion]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/bia/processes", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          description: draft.description || null,
          owners: draft.owners || null,
          financialImpactLevel: draft.financialImpactLevel,
          regulatoryImpactLevel: draft.regulatoryImpactLevel,
          interdependencies: draft.interdependencies || null,
          rtoHours: draft.rtoHours,
          rpoMinutes: draft.rpoMinutes,
          mtpdHours: draft.mtpdHours,
          serviceIds: draft.serviceIds,
        }),
      });
      await Promise.all([loadBia(), loadDashboard()]);
      setDraft({ ...defaultDraft });
      setActiveTab("list");
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  const handleProcessClick = (processId: string) => {
    setActiveTab("list");
    // Could scroll to the process or highlight it
  };

  const criticalProcesses = processes.filter(
    (process) => process.criticalityScore >= 4 || process.impactScore >= 4
  );

  const filteredProcesses = useMemo(() => {
    return processes.filter((process) => {
      if (filterCriticality !== "all") {
        const level = process.criticalityScore >= 4 ? "critical" :
          process.criticalityScore >= 3 ? "high" :
          process.criticalityScore >= 2 ? "medium" : "low";
        if (level !== filterCriticality) return false;
      }
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        if (!process.name.toLowerCase().includes(search) &&
            !process.description?.toLowerCase().includes(search) &&
            !process.owners?.toLowerCase().includes(search)) {
          return false;
        }
      }
      return true;
    });
  }, [processes, filterStatus, filterDomain, filterCriticality, searchTerm]);

  const impactMatrix = useMemo(() => {
    if (processes.length === 0) return null;
    const buckets = new Map<string, BusinessProcess[]>();
    const clampScore = (score: number) => {
      const rounded = Math.round(score);
      return Math.min(5, Math.max(1, rounded));
    };

    processes.forEach((process) => {
      const impact = clampScore(process.impactScore);
      const criticality = clampScore(process.criticalityScore);
      const key = `${impact}:${criticality}`;
      const existing = buckets.get(key) ?? [];
      existing.push(process);
      buckets.set(key, existing);
    });

    const data: Array<[number, number, number]> = [];
    const cellLookup = new Map<string, BusinessProcess[]>();
    for (let impact = 1; impact <= 5; impact += 1) {
      for (let criticality = 1; criticality <= 5; criticality += 1) {
        const key = `${impact}:${criticality}`;
        const processesInCell = buckets.get(key) ?? [];
        data.push([impact - 1, criticality - 1, processesInCell.length]);
        if (processesInCell.length > 0) {
          cellLookup.set(`${impact - 1}:${criticality - 1}`, processesInCell);
        }
      }
    }

    const maxValue = Math.max(...data.map((entry) => entry[2]), 1);

    return {
      tooltip: {
        formatter: (params: any) => {
          const processesInCell = cellLookup.get(`${params.data[0]}:${params.data[1]}`) ?? [];
          if (processesInCell.length === 0) {
            return "Aucun processus";
          }
          const labels = processesInCell.slice(0, 5).map((process) => process.name);
          const moreCount = processesInCell.length - labels.length;
          return `
            <strong>${processesInCell.length} processus</strong><br/>
            ${labels.join("<br/>")}
            ${moreCount > 0 ? `<br/>+${moreCount} autres` : ""}
          `;
        },
      },
      grid: { left: 50, right: 20, top: 30, bottom: 40, containLabel: true },
      xAxis: {
        type: "category",
        data: ["1", "2", "3", "4", "5"],
        name: "Impact",
        nameLocation: "middle",
        nameGap: 30,
        splitArea: { show: true },
      },
      yAxis: {
        type: "category",
        data: ["1", "2", "3", "4", "5"],
        name: "Criticité",
        nameLocation: "middle",
        nameGap: 35,
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: maxValue,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        inRange: {
          color: ["#d4f4dd", "#ffe5b4", "#ffd0d0", "#ff6b6b"],
        },
      },
      series: [
        {
          type: "heatmap",
          data,
          label: { show: true },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.3)",
            },
          },
        },
      ],
    };
  }, [processes]);

  if (loading && !dashboard) {
    return <div className="skeleton">Chargement des analyses BIA...</div>;
  }

  if (error && !dashboard) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  const progressSteps = [processes.length > 0, services.length > 0, dashboard !== null];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <>
      <PageIntro
        title="Business Impact Analysis"
        subtitle="Analysez vos processus métiers, leurs impacts et les interdépendances pour prioriser la continuité."
        objective="Dashboard BIA complet avec KPIs, matrice de risques, alertes et gestion des processus."
        steps={[
          "Consulter le dashboard pour une vue d'ensemble",
          "Créer et évaluer les processus métiers",
          "Analyser la matrice d'impact et les alertes",
          "Prioriser les actions de continuité",
        ]}
        tips={[
          "Utilisez le dashboard pour identifier rapidement les processus critiques.",
          "Associez les services pour une analyse d'impact complète.",
          "Consultez les alertes pour les actions prioritaires.",
        ]}
        links={[
          { label: "Dashboard", href: "#bia-dashboard", description: "Vue d'ensemble" },
          { label: "Créer un processus", href: "#bia-form", description: "Formulaire" },
          { label: "Liste des processus", href: "#bia-table", description: "Table" },
        ]}
        expectedData={[
          "Impacts financiers/réglementaires",
          "RTO/RPO/MTPD par processus",
          "Lien avec les services/applications",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      {/* Tab Navigation */}
      <div className="tab-nav" style={{ marginBottom: "1.5rem" }}>
        <button
          className={`tab-button ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
          {dashboard && dashboard.alerts.filter(a => a.severity === "critical" || a.severity === "high").length > 0 && (
            <span className="tab-badge">{dashboard.alerts.filter(a => a.severity === "critical" || a.severity === "high").length}</span>
          )}
        </button>
        <button
          className={`tab-button ${activeTab === "create" ? "active" : ""}`}
          onClick={() => setActiveTab("create")}
        >
          Nouveau processus
        </button>
        <button
          className={`tab-button ${activeTab === "list" ? "active" : ""}`}
          onClick={() => setActiveTab("list")}
        >
          Processus ({processes.length})
        </button>
      </div>

      {/* Dashboard Tab */}
      {activeTab === "dashboard" && (
        <div id="bia-dashboard">
          <BiaDashboardView
            dashboard={dashboard}
            loading={dashboardLoading}
            error={dashboardError}
            onProcessClick={handleProcessClick}
          />
        </div>
      )}

      {/* Create Tab */}
      {activeTab === "create" && (
        <form id="bia-form" className="card form-grid" onSubmit={handleCreate}>
          <div className="card-header" style={{ gridColumn: "1 / -1" }}>
            <div>
              <p className="eyebrow">Processus métier</p>
              <h3>Nouveau processus BIA</h3>
            </div>
          </div>

          {/* Basic Information */}
          <div style={{ gridColumn: "1 / -1" }}>
            <h4 style={{ marginBottom: "1rem", color: "var(--color-text-secondary)" }}>
              1. Identification du processus
            </h4>
          </div>

          <label className="form-field">
            <span>Nom du processus *</span>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Ex: Traitement des paiements"
              required
            />
          </label>

          <label className="form-field">
            <span>Domaine métier</span>
            <select
              value={draft.domain}
              onChange={(event) => setDraft((prev) => ({ ...prev, domain: event.target.value }))}
            >
              {domains.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Propriétaires</span>
            <input
              type="text"
              value={draft.owners}
              onChange={(event) => setDraft((prev) => ({ ...prev, owners: event.target.value }))}
              placeholder="Direction financière, DSI"
            />
          </label>

          <label className="form-field" style={{ gridColumn: "1 / -1" }}>
            <span>Description</span>
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, description: event.target.value }))
              }
              rows={3}
              placeholder="Décrivez le processus, son rôle et son importance..."
            />
          </label>

          {/* Impact Evaluation */}
          <div style={{ gridColumn: "1 / -1", marginTop: "1rem" }}>
            <h4 style={{ marginBottom: "1rem", color: "var(--color-text-secondary)" }}>
              2. Évaluation des impacts
            </h4>
          </div>

          <label className="form-field">
            <span>
              Impact financier
              <span className="helper" title="Pertes financières en cas d'interruption">?</span>
            </span>
            <select
              value={draft.financialImpactLevel}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  financialImpactLevel: Number(event.target.value),
                }))
              }
            >
              {impactLevels.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>
              Impact réglementaire
              <span className="helper" title="Non-conformité, sanctions réglementaires">?</span>
            </span>
            <select
              value={draft.regulatoryImpactLevel}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  regulatoryImpactLevel: Number(event.target.value),
                }))
              }
            >
              {impactLevels.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>
              Impact opérationnel
              <span className="helper" title="Perturbation des opérations quotidiennes">?</span>
            </span>
            <select
              value={draft.operationalImpactLevel}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  operationalImpactLevel: Number(event.target.value),
                }))
              }
            >
              {impactLevels.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>
              Impact réputationnel
              <span className="helper" title="Atteinte à l'image et à la confiance">?</span>
            </span>
            <select
              value={draft.reputationalImpactLevel}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  reputationalImpactLevel: Number(event.target.value),
                }))
              }
            >
              {impactLevels.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>

          {/* Recovery Objectives */}
          <div style={{ gridColumn: "1 / -1", marginTop: "1rem" }}>
            <h4 style={{ marginBottom: "1rem", color: "var(--color-text-secondary)" }}>
              3. Objectifs de reprise
            </h4>
          </div>

          <label className="form-field">
            <span>
              RTO (Recovery Time Objective)
              <span className="helper" title="Temps maximum acceptable pour restaurer le processus">?</span>
            </span>
            <div className="input-with-unit">
              <input
                type="number"
                min={0}
                value={draft.rtoHours}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, rtoHours: Number(event.target.value) }))
                }
              />
              <span className="unit">heures</span>
            </div>
          </label>

          <label className="form-field">
            <span>
              RPO (Recovery Point Objective)
              <span className="helper" title="Perte de données maximum acceptable">?</span>
            </span>
            <div className="input-with-unit">
              <input
                type="number"
                min={0}
                value={draft.rpoMinutes}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, rpoMinutes: Number(event.target.value) }))
                }
              />
              <span className="unit">minutes</span>
            </div>
          </label>

          <label className="form-field">
            <span>
              MTPD (Maximum Tolerable Period of Disruption)
              <span className="helper" title="Durée maximum avant dommages irréversibles">?</span>
            </span>
            <div className="input-with-unit">
              <input
                type="number"
                min={0}
                value={draft.mtpdHours}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, mtpdHours: Number(event.target.value) }))
                }
              />
              <span className="unit">heures</span>
            </div>
          </label>

          {/* Dependencies */}
          <div style={{ gridColumn: "1 / -1", marginTop: "1rem" }}>
            <h4 style={{ marginBottom: "1rem", color: "var(--color-text-secondary)" }}>
              4. Dépendances
            </h4>
          </div>

          <label className="form-field" style={{ gridColumn: "1 / -1" }}>
            <span>Interdépendances (texte libre)</span>
            <textarea
              value={draft.interdependencies}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, interdependencies: event.target.value }))
              }
              rows={2}
              placeholder="Flux entre agences, interfaces partenaires, etc."
            />
          </label>

          <label className="form-field" style={{ gridColumn: "1 / -1" }}>
            <span>Services / applications concernés</span>
            <select
              multiple
              value={draft.serviceIds}
              onChange={(event) => {
                const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                setDraft((prev) => ({ ...prev, serviceIds: selected }));
              }}
              style={{ minHeight: "120px" }}
            >
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} ({service.criticality})
                </option>
              ))}
            </select>
            <p className="helper">Maintenez Ctrl/Cmd pour sélectionner plusieurs services.</p>
          </label>

          {/* Criticality Preview */}
          <div className="card" style={{ gridColumn: "1 / -1", marginTop: "1rem", padding: "1rem", background: "var(--color-surface-secondary)" }}>
            <h4 style={{ marginBottom: "0.5rem" }}>Aperçu de la criticité</h4>
            <div className="stack horizontal" style={{ gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <span className="muted small">Score d'impact: </span>
                <strong>{((draft.financialImpactLevel * 0.6 + draft.regulatoryImpactLevel * 0.4)).toFixed(1)}</strong>
              </div>
              <div>
                <span className="muted small">Niveau: </span>
                <SeverityBadge level={Math.round(draft.financialImpactLevel * 0.6 + draft.regulatoryImpactLevel * 0.4)} />
              </div>
            </div>
          </div>

          {createError && (
            <div className="alert error" style={{ gridColumn: "1 / -1" }}>
              {createError}
            </div>
          )}

          <div className="form-field" style={{ gridColumn: "1 / -1" }}>
            <button className="button primary" type="submit" disabled={creating}>
              {creating ? "Création..." : "Enregistrer le processus"}
            </button>
          </div>
        </form>
      )}

      {/* List Tab */}
      {activeTab === "list" && (
        <>
          {/* Filters */}
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-header">
              <div>
                <p className="eyebrow">Filtres</p>
                <h3>Rechercher des processus</h3>
              </div>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <label className="form-field">
                <span>Recherche</span>
                <input
                  type="text"
                  placeholder="Nom, description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Criticité</span>
                <select
                  value={filterCriticality}
                  onChange={(e) => setFilterCriticality(e.target.value)}
                >
                  <option value="all">Toutes</option>
                  <option value="critical">Critique (4-5)</option>
                  <option value="high">Élevé (3-4)</option>
                  <option value="medium">Moyen (2-3)</option>
                  <option value="low">Faible (1-2)</option>
                </select>
              </label>
              <label className="form-field">
                <span>Domaine</span>
                <select
                  value={filterDomain}
                  onChange={(e) => setFilterDomain(e.target.value)}
                >
                  <option value="all">Tous</option>
                  {domains.slice(1).map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </label>
              <div className="form-field" style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    setSearchTerm("");
                    setFilterCriticality("all");
                    setFilterDomain("all");
                    setFilterStatus("all");
                  }}
                >
                  Réinitialiser
                </button>
              </div>
            </div>
          </div>

          {/* Process Table */}
          <div id="bia-table" className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Synthèse</p>
                <h3>Processus & scores</h3>
              </div>
              <div className="stack horizontal" style={{ gap: "0.5rem" }}>
                <div className="badge subtle">{filteredProcesses.length} processus</div>
                {criticalProcesses.length > 0 && (
                  <div className="badge error">{criticalProcesses.length} critiques</div>
                )}
              </div>
            </div>
            {filteredProcesses.length === 0 ? (
              <p className="muted">Aucun processus ne correspond aux critères de recherche.</p>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Processus</th>
                      <th>Impacts</th>
                      <th>RTO/RPO/MTPD</th>
                      <th>Scores</th>
                      <th>Services liés</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProcesses.map((process) => (
                      <tr key={process.id}>
                        <td>
                          <strong>{process.name}</strong>
                          {process.description && <p className="muted small">{process.description}</p>}
                          {process.owners && <p className="muted small">Propriétaire: {process.owners}</p>}
                        </td>
                        <td>
                          <div className="stack" style={{ gap: "4px" }}>
                            <span className="muted small">Financier: <strong>{process.financialImpactLevel}</strong></span>
                            <span className="muted small">Réglementaire: <strong>{process.regulatoryImpactLevel}</strong></span>
                          </div>
                        </td>
                        <td>
                          <div className="stack" style={{ gap: "4px" }}>
                            <span className="muted small">RTO: <strong>{process.rtoHours}h</strong></span>
                            <span className="muted small">RPO: <strong>{process.rpoMinutes}min</strong></span>
                            <span className="muted small">MTPD: <strong>{process.mtpdHours}h</strong></span>
                          </div>
                        </td>
                        <td>
                          <div className="stack" style={{ gap: "4px" }}>
                            <span className="muted small">Impact: <strong>{process.impactScore.toFixed(2)}</strong></span>
                            <span className="muted small">Criticité: <strong>{process.criticalityScore.toFixed(2)}</strong></span>
                            <SeverityBadge level={Math.round(process.criticalityScore)} />
                          </div>
                        </td>
                        <td>
                          {process.services.length === 0
                            ? <span className="muted">Aucun</span>
                            : (
                              <div className="stack" style={{ gap: "4px" }}>
                                {process.services.slice(0, 3).map((link) => (
                                  <span key={link.service.id} className="pill subtle small">
                                    {link.service.name}
                                  </span>
                                ))}
                                {process.services.length > 3 && (
                                  <span className="muted small">+{process.services.length - 3} autres</span>
                                )}
                              </div>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Impact Matrix */}
          <div id="bia-matrix" className="card" style={{ marginTop: "1.5rem" }}>
            <div className="card-header">
              <div>
                <p className="eyebrow">Analyse visuelle</p>
                <h3>Matrice d'impact</h3>
              </div>
              <div className="badge subtle">{criticalProcesses.length} points critiques</div>
            </div>
            {impactMatrix ? (
              <Suspense fallback={<div className="skeleton">Chargement du graphique...</div>}>
                <ReactECharts option={impactMatrix} style={{ height: 360 }} />
              </Suspense>
            ) : (
              <p className="muted">La matrice s'affichera dès qu'un processus sera créé.</p>
            )}
            {criticalProcesses.length > 0 && (
              <p className="muted" style={{ marginTop: "1rem" }}>
                <strong>Processus critiques :</strong>{" "}
                {criticalProcesses.map((process) => process.name).join(", ")}
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}

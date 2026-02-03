import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { PageIntro } from "../components/PageIntro";
import { BiaDashboardView } from "../components/BiaDashboard";
import { BiaWizard, type WizardData } from "../components/BiaWizard";
import { BiaProcessDetail } from "../components/BiaProcessDetail";
import { BiaPrioritization } from "../components/BiaPrioritization";
import { BiaReports } from "../components/BiaReports";
import { BiaIntegration } from "../components/BiaIntegration";
import type { BiaDashboard, BusinessProcess, Service } from "../types";
import { apiFetch } from "../utils/api";

interface BiaSectionProps {
  configVersion: number;
}

type BiaTab = "dashboard" | "wizard" | "prioritization" | "reports" | "integration" | "list";

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

  // Filters for list view
  const [filterDomain, setFilterDomain] = useState<string>("all");
  const [filterCriticality, setFilterCriticality] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Selected process for detail view
  const [selectedProcess, setSelectedProcess] = useState<BusinessProcess | null>(null);

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

  const handleWizardComplete = async (wizardData: WizardData) => {
    // Convert wizard data to API format
    const avgFinancial = Math.round(
      (wizardData.financialImpact.at24h + wizardData.financialImpact.at72h + wizardData.financialImpact.at1Week) / 3
    );
    const avgRegulatory = Math.round(
      (wizardData.regulatoryImpact.at24h + wizardData.regulatoryImpact.at72h + wizardData.regulatoryImpact.at1Week) / 3
    );

    await apiFetch("/bia/processes", {
      method: "POST",
      body: JSON.stringify({
        name: wizardData.name,
        description: wizardData.description || null,
        owners: wizardData.owners || null,
        financialImpactLevel: avgFinancial,
        regulatoryImpactLevel: avgRegulatory,
        interdependencies: wizardData.interdependencies || null,
        rtoHours: wizardData.rtoHours,
        rpoMinutes: wizardData.rpoMinutes,
        mtpdHours: wizardData.mtpdHours,
        serviceIds: wizardData.serviceIds,
      }),
    });

    await Promise.all([loadBia(), loadDashboard()]);
    setActiveTab("list");
  };

  const handleProcessClick = (processId: string) => {
    setActiveTab("list");
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
  }, [processes, filterDomain, filterCriticality, searchTerm]);

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
        objective="Dashboard BIA complet avec KPIs, matrice de risques, alertes et assistant de création guidé."
        steps={[
          "Consulter le dashboard pour une vue d'ensemble",
          "Utiliser l'assistant pour créer un processus BIA",
          "Analyser la matrice d'impact et les alertes",
          "Prioriser les actions de continuité",
        ]}
        tips={[
          "L'assistant vous guide à travers 4 étapes pour créer un processus complet.",
          "Les données sont sauvegardées automatiquement à chaque étape.",
          "Utilisez le catalogue de processus types pour gagner du temps.",
        ]}
        links={[
          { label: "Dashboard", href: "#bia-dashboard", description: "Vue d'ensemble" },
          { label: "Assistant BIA", href: "#bia-wizard", description: "Création guidée" },
          { label: "Liste des processus", href: "#bia-table", description: "Table" },
        ]}
        expectedData={[
          "Impacts financiers/réglementaires sur différentes échelles de temps",
          "RTO/RPO/MTPD par processus avec valeurs suggérées",
          "Lien avec les services/applications existants",
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
          className={`tab-button ${activeTab === "wizard" ? "active" : ""}`}
          onClick={() => setActiveTab("wizard")}
        >
          Assistant BIA
        </button>
        <button
          className={`tab-button ${activeTab === "prioritization" ? "active" : ""}`}
          onClick={() => setActiveTab("prioritization")}
        >
          Priorisation
        </button>
        <button
          className={`tab-button ${activeTab === "reports" ? "active" : ""}`}
          onClick={() => setActiveTab("reports")}
        >
          Rapports
        </button>
        <button
          className={`tab-button ${activeTab === "integration" ? "active" : ""}`}
          onClick={() => setActiveTab("integration")}
        >
          Intégration
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

      {/* Wizard Tab */}
      {activeTab === "wizard" && (
        <div id="bia-wizard">
          <BiaWizard
            services={services}
            onComplete={handleWizardComplete}
            onCancel={() => setActiveTab("dashboard")}
          />
        </div>
      )}

      {/* Prioritization Tab */}
      {activeTab === "prioritization" && (
        <div id="bia-prioritization">
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-header">
              <div>
                <p className="eyebrow">Analyse</p>
                <h3>Tableau de priorisation BIA</h3>
              </div>
              <p className="muted small">
                Triez, filtrez et exportez vos processus pour identifier les priorités.
              </p>
            </div>
          </div>
          <BiaPrioritization
            processes={processes}
            onProcessSelect={(process) => setSelectedProcess(process)}
          />
        </div>
      )}

      {/* Reports Tab */}
      {activeTab === "reports" && (
        <div id="bia-reports">
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-header">
              <div>
                <p className="eyebrow">Export</p>
                <h3>Génération de rapports BIA</h3>
              </div>
              <p className="muted small">
                Générez des rapports complets, synthétiques ou par scénario en différents formats.
              </p>
            </div>
          </div>
          <BiaReports processCount={processes.length} />
        </div>
      )}

      {/* Integration Tab */}
      {activeTab === "integration" && (
        <div id="bia-integration">
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-header">
              <div>
                <p className="eyebrow">Modules</p>
                <h3>Intégration Stronghold</h3>
              </div>
              <p className="muted small">
                Vue unifiée des risques, runbooks et incidents liés aux processus BIA.
              </p>
            </div>
          </div>
          <BiaIntegration
            processes={processes}
            onNavigateToProcess={(processId) => {
              const process = processes.find((p) => p.id === processId);
              if (process) {
                setSelectedProcess(process);
                setActiveTab("list");
              }
            }}
          />
        </div>
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
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProcesses.map((process) => (
                      <tr
                        key={process.id}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelectedProcess(process)}
                      >
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
                        <td>
                          <button
                            className="button small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProcess(process);
                            }}
                          >
                            Voir détails
                          </button>
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

      {/* Process Detail Modal */}
      {selectedProcess && (
        <BiaProcessDetail
          process={selectedProcess}
          services={services}
          onClose={() => setSelectedProcess(null)}
        />
      )}
    </>
  );
}

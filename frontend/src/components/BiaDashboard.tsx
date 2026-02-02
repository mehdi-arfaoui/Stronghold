import { Suspense, lazy, useMemo, useState } from "react";
import type { BiaDashboard, BiaAlert, BiaKpi } from "../types";

const ReactECharts = lazy(() => import("echarts-for-react"));

interface BiaDashboardProps {
  dashboard: BiaDashboard | null;
  loading: boolean;
  error: string | null;
  onProcessClick?: (processId: string) => void;
}

type FilterStatus = "all" | "critical" | "high" | "medium" | "low";
type FilterDomain = "all" | "financial" | "regulatory" | "operational";

function KpiCard({ kpi }: { kpi: BiaKpi }) {
  const severityClass = kpi.severity === "success" ? "success" :
    kpi.severity === "warning" ? "warning" :
    kpi.severity === "error" ? "error" : "";

  return (
    <div className={`kpi-card ${severityClass}`}>
      <span className="kpi-label">{kpi.label}</span>
      <span className="kpi-value">
        {kpi.value}
        {kpi.unit && <span className="kpi-unit">{kpi.unit}</span>}
      </span>
      {kpi.trend && (
        <span className={`kpi-trend ${kpi.trend}`}>
          {kpi.trend === "up" ? "↑" : kpi.trend === "down" ? "↓" : "→"}
        </span>
      )}
    </div>
  );
}

function AlertCard({ alert, onClick }: { alert: BiaAlert; onClick?: () => void }) {
  const severityClass = alert.severity === "critical" ? "error" :
    alert.severity === "high" ? "warning" :
    alert.severity === "medium" ? "info" : "success";

  return (
    <div
      className={`alert-card ${severityClass}`}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <div className="alert-header">
        <span className={`pill ${severityClass}`}>{alert.severity.toUpperCase()}</span>
        <span className="alert-title">{alert.title}</span>
      </div>
      <p className="alert-description muted small">{alert.description}</p>
      <p className="alert-recommendation">
        <strong>Recommandation:</strong> {alert.recommendation}
      </p>
    </div>
  );
}

export function BiaDashboardView({ dashboard, loading, error, onProcessClick }: BiaDashboardProps) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterDomain, setFilterDomain] = useState<FilterDomain>("all");

  const heatmapOptions = useMemo(() => {
    if (!dashboard) return null;

    const { heatmap } = dashboard;
    const data: Array<[number, number, number]> = [];
    const cellLookup = new Map<string, typeof heatmap.cells[0]>();

    for (const cell of heatmap.cells) {
      const x = cell.severity - 1;
      const y = cell.probability - 1;
      data.push([x, y, cell.count]);
      if (cell.count > 0) {
        cellLookup.set(`${x}:${y}`, cell);
      }
    }

    const maxValue = Math.max(...data.map((d) => d[2]), 1);

    return {
      tooltip: {
        formatter: (params: any) => {
          const cell = cellLookup.get(`${params.data[0]}:${params.data[1]}`);
          if (!cell || cell.count === 0) return "Aucun processus";
          const names = cell.processes.slice(0, 5).map((p) => p.name);
          const more = cell.count - names.length;
          return `
            <strong>${cell.count} processus (${cell.level})</strong><br/>
            ${names.join("<br/>")}
            ${more > 0 ? `<br/>+${more} autres` : ""}
          `;
        },
      },
      grid: { left: 60, right: 20, top: 30, bottom: 50, containLabel: true },
      xAxis: {
        type: "category",
        data: ["1", "2", "3", "4", "5"],
        name: "Sévérité de l'impact",
        nameLocation: "middle",
        nameGap: 35,
        splitArea: { show: true },
      },
      yAxis: {
        type: "category",
        data: ["1", "2", "3", "4", "5"],
        name: "Probabilité (temps)",
        nameLocation: "middle",
        nameGap: 45,
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
  }, [dashboard]);

  const impactChartOptions = useMemo(() => {
    if (!dashboard) return null;

    const { impactDistribution } = dashboard;
    const categories = ["Financier", "Réglementaire", "Opérationnel"];
    const counts = [
      impactDistribution.financial.count,
      impactDistribution.regulatory.count,
      impactDistribution.operational.count,
    ];
    const avgScores = [
      impactDistribution.financial.avgScore,
      impactDistribution.regulatory.avgScore,
      impactDistribution.operational.avgScore,
    ];

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      legend: {
        data: ["Nombre de processus", "Score moyen"],
        bottom: 0,
      },
      grid: { left: 50, right: 50, top: 20, bottom: 60, containLabel: true },
      xAxis: {
        type: "category",
        data: categories,
      },
      yAxis: [
        {
          type: "value",
          name: "Nombre",
          position: "left",
        },
        {
          type: "value",
          name: "Score",
          position: "right",
          max: 5,
        },
      ],
      series: [
        {
          name: "Nombre de processus",
          type: "bar",
          data: counts,
          itemStyle: { color: "#5470c6" },
        },
        {
          name: "Score moyen",
          type: "line",
          yAxisIndex: 1,
          data: avgScores,
          itemStyle: { color: "#ee6666" },
          lineStyle: { width: 2 },
          symbol: "circle",
          symbolSize: 8,
        },
      ],
    };
  }, [dashboard]);

  const filteredAlerts = useMemo(() => {
    if (!dashboard) return [];
    let alerts = dashboard.alerts;

    if (filterStatus !== "all") {
      alerts = alerts.filter((a) => a.severity === filterStatus);
    }

    return alerts;
  }, [dashboard, filterStatus]);

  if (loading) {
    return <div className="skeleton">Chargement du dashboard BIA...</div>;
  }

  if (error) {
    return <div className="alert error">Erreur: {error}</div>;
  }

  if (!dashboard) {
    return <div className="empty-state">Aucune donnée BIA disponible.</div>;
  }

  const criticalAlerts = dashboard.alerts.filter((a) => a.severity === "critical" || a.severity === "high");

  return (
    <div className="bia-dashboard">
      {/* KPI Cards */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-header">
          <div>
            <p className="eyebrow">Vue d'ensemble</p>
            <h3>Indicateurs clés BIA</h3>
          </div>
          <div className="badge subtle">
            Mis à jour: {new Date(dashboard.meta.generatedAt).toLocaleString("fr-FR")}
          </div>
        </div>
        <div className="kpi-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "1rem",
          padding: "1rem 0"
        }}>
          {dashboard.kpis.map((kpi, index) => (
            <KpiCard key={index} kpi={kpi} />
          ))}
        </div>
      </div>

      {/* Alerts Section */}
      {criticalAlerts.length > 0 && (
        <div className="card" style={{ marginBottom: "1.5rem", borderLeft: "4px solid var(--color-error)" }}>
          <div className="card-header">
            <div>
              <p className="eyebrow">Alertes prioritaires</p>
              <h3>Actions à suivre</h3>
            </div>
            <span className="pill error">{criticalAlerts.length} alertes</span>
          </div>
          <div className="stack" style={{ gap: "0.75rem" }}>
            {criticalAlerts.slice(0, 5).map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onClick={alert.processId ? () => onProcessClick?.(alert.processId!) : undefined}
              />
            ))}
            {criticalAlerts.length > 5 && (
              <p className="muted small">+{criticalAlerts.length - 5} autres alertes</p>
            )}
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="panel-grid" style={{ marginBottom: "1.5rem" }}>
        {/* Impact Distribution Chart */}
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Répartition</p>
              <h3>Distribution des impacts</h3>
            </div>
          </div>
          {impactChartOptions ? (
            <Suspense fallback={<div className="skeleton">Chargement...</div>}>
              <ReactECharts option={impactChartOptions} style={{ height: 300 }} />
            </Suspense>
          ) : (
            <p className="muted">Aucune donnée à afficher.</p>
          )}
        </div>

        {/* Risk Heatmap */}
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Matrice de risques</p>
              <h3>Heatmap BIA</h3>
            </div>
            <div className="badge subtle">
              Probabilité × Sévérité
            </div>
          </div>
          {heatmapOptions ? (
            <Suspense fallback={<div className="skeleton">Chargement...</div>}>
              <ReactECharts option={heatmapOptions} style={{ height: 350 }} />
            </Suspense>
          ) : (
            <p className="muted">Aucune donnée à afficher.</p>
          )}
        </div>
      </div>

      {/* All Alerts with Filters */}
      <div className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Toutes les alertes</p>
            <h3>Actions recommandées</h3>
          </div>
          <div className="stack horizontal" style={{ gap: "0.5rem" }}>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
              className="input-small"
            >
              <option value="all">Tous les niveaux</option>
              <option value="critical">Critique</option>
              <option value="high">Élevé</option>
              <option value="medium">Moyen</option>
              <option value="low">Faible</option>
            </select>
          </div>
        </div>

        {filteredAlerts.length === 0 ? (
          <p className="empty-state">Aucune alerte ne correspond aux filtres sélectionnés.</p>
        ) : (
          <div className="stack" style={{ gap: "0.75rem", maxHeight: "400px", overflowY: "auto" }}>
            {filteredAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onClick={alert.processId ? () => onProcessClick?.(alert.processId!) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// CSS-in-JS styles that can be added to the main stylesheet
export const biaDashboardStyles = `
.bia-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  border-radius: 8px;
  background: var(--color-surface-secondary);
  border: 1px solid var(--color-border);
  text-align: center;
}

.kpi-card.success {
  border-left: 4px solid var(--color-success);
}

.kpi-card.warning {
  border-left: 4px solid var(--color-warning);
}

.kpi-card.error {
  border-left: 4px solid var(--color-error);
}

.kpi-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kpi-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.kpi-unit {
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--color-text-muted);
  margin-left: 2px;
}

.kpi-trend {
  font-size: 0.875rem;
  font-weight: 600;
}

.kpi-trend.up {
  color: var(--color-error);
}

.kpi-trend.down {
  color: var(--color-success);
}

.kpi-trend.stable {
  color: var(--color-text-muted);
}

.alert-card {
  padding: 1rem;
  border-radius: 8px;
  background: var(--color-surface-secondary);
  border: 1px solid var(--color-border);
  transition: box-shadow 0.2s ease;
}

.alert-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.alert-card.error {
  border-left: 4px solid var(--color-error);
  background: rgba(255, 107, 107, 0.05);
}

.alert-card.warning {
  border-left: 4px solid var(--color-warning);
  background: rgba(255, 193, 7, 0.05);
}

.alert-card.info {
  border-left: 4px solid var(--color-info);
  background: rgba(23, 162, 184, 0.05);
}

.alert-card.success {
  border-left: 4px solid var(--color-success);
  background: rgba(40, 167, 69, 0.05);
}

.alert-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.alert-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.alert-description {
  margin-bottom: 0.5rem;
}

.alert-recommendation {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
}

.input-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}
`;

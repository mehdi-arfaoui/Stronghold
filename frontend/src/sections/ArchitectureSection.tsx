import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { PageIntro } from "../components/PageIntro";
import type { GraphApiResponse, GraphNode } from "../types";
import { apiFetch } from "../utils/api";

interface ArchitectureSectionProps {
  configVersion: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  Foundation: "#2563eb",
  Platform: "#0ea5e9",
  Application: "#22c55e",
  Network: "#f97316",
};

const CRITICALITY_ORDER = ["critical", "high", "medium", "low"];
const CRITICALITY_LABELS: Record<string, string> = {
  critical: "Critique",
  high: "Haute",
  medium: "Moyenne",
  low: "Faible",
};

function nodeColor(category?: string, criticality?: string) {
  const base = CATEGORY_COLORS[category || ""] || "#64748b";
  if (criticality === "critical") return "#ef4444";
  if (criticality === "high") return "#f97316";
  if (criticality === "medium") return "#fbbf24";
  return base;
}

export function ArchitectureSection({ configVersion }: ArchitectureSectionProps) {
  const [graph, setGraph] = useState<GraphApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState("all");
  const [selectedCriticalities, setSelectedCriticalities] = useState<string[]>(
    CRITICALITY_ORDER
  );
  const chartRef = useRef<ReactECharts>(null);

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const data: GraphApiResponse = await apiFetch("/graph?view=architecture-lite");
        setGraph(data);
      } catch (err: any) {
        setError(err.message || "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    };
    fetchGraph();
  }, [configVersion]);

  const domains = useMemo(() => {
    if (!graph) return [];
    return Array.from(
      new Set(
        graph.nodes
          .map((node) => node.domain || "")
          .filter((domain) => domain.trim().length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [graph, filteredNodes, filteredEdges]);

  const filteredNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((node) => {
      const crit = (node.criticality || "").toLowerCase();
      const critMatch = selectedCriticalities.includes(crit);
      const domainMatch =
        domainFilter === "all" ? true : (node.domain || "").toLowerCase() === domainFilter;
      return critMatch && domainMatch;
    });
  }, [graph, selectedCriticalities, domainFilter]);

  const filteredEdges = useMemo(() => {
    if (!graph) return [];
    const allowed = new Set(filteredNodes.map((node) => node.id));
    return graph.edges.filter((edge) => allowed.has(edge.from) && allowed.has(edge.to));
  }, [graph, filteredNodes]);

  const categorySummary = useMemo(() => {
    if (!graph) return [];
    const scoreMap: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    const summary = filteredNodes.reduce<Record<string, { count: number; score: number }>>(
      (acc, node) => {
        const category = node.category || "Application";
        const critScore = scoreMap[(node.criticality || "low").toLowerCase()] ?? 1;
        const current = acc[category] || { count: 0, score: 0 };
        current.count += 1;
        current.score += critScore;
        acc[category] = current;
        return acc;
      },
      {}
    );

    const edgesByCategory = filteredEdges.reduce<Record<string, number>>((acc, edge) => {
      const sourceCategory = filteredNodes.find((node) => node.id === edge.from)?.category;
      const targetCategory = filteredNodes.find((node) => node.id === edge.to)?.category;
      if (!sourceCategory || !targetCategory) return acc;
      const key = `${sourceCategory}::${targetCategory}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(summary)
      .map(([category, stats]) => {
        const average = stats.score / Math.max(1, stats.count);
        const averageCriticality =
          average >= 3.5 ? "critical" : average >= 2.5 ? "high" : average >= 1.5 ? "medium" : "low";
        const dependencies = Object.entries(edgesByCategory)
          .filter(([key]) => key.startsWith(`${category}::`))
          .map(([key, count]) => ({
            target: key.split("::")[1],
            count,
          }));
        return {
          category,
          serviceCount: stats.count,
          averageCriticality,
          dependencies,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [graph, filteredNodes, filteredEdges]);

  const options = useMemo(() => {
    if (!graph) return null;
    const categories = Array.from(
      new Set(filteredNodes.map((node) => node.category || "Application"))
    );

    const nodes = filteredNodes.map((node: GraphNode) => ({
      id: node.id,
      name: node.summaryLabel || node.label,
      value: node.criticality,
      category: categories.indexOf(node.category || "Application"),
      symbol: node.nodeKind === "application" ? "circle" : "rect",
      symbolSize: node.nodeKind === "application" ? 32 : 38,
      itemStyle: { color: nodeColor(node.category, node.criticality) },
      label: {
        show: true,
        formatter: node.summaryLabel || node.label,
      },
    }));

    const links = filteredEdges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      value: edge.type,
      lineStyle: { opacity: 0.5, width: edge.strength === "strong" ? 3 : 1 },
      label: { show: false, formatter: edge.type || "" },
    }));

    return {
      tooltip: {
        formatter: (params: any) => {
          if (params.dataType === "node") {
            return `${params.data.name}<br/>Catégorie: ${categories[params.data.category]}<br/>Criticité: ${params.data.value}`;
          }
          return params.data.value || "Dépendance";
        },
      },
      legend: [{ data: categories }],
      series: [
        {
          type: "graph",
          layout: "circular",
          roam: true,
          data: nodes,
          links,
          categories: categories.map((cat) => ({ name: cat })),
          emphasis: { focus: "adjacency" },
          lineStyle: { curveness: 0.2 },
        },
      ],
    };
  }, [graph]);

  const handleExport = (type: "png" | "svg") => {
    if (!chartRef.current) return;
    const instance = chartRef.current.getEchartsInstance();
    const dataUrl = instance.getDataURL({
      type,
      pixelRatio: 2,
      backgroundColor: "#ffffff",
    });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `architecture-diagram.${type}`;
    link.click();
  };

  if (loading) return <div className="skeleton">Chargement du diagramme...</div>;
  if (error) return <div className="alert error">Erreur lors du chargement : {error}</div>;
  if (!options) return null;

  const progressSteps = [
    (graph?.nodes.length ?? 0) > 0,
    (graph?.edges.length ?? 0) > 0,
    (graph?.nodes ?? []).some((node) => Boolean(node.category)),
  ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <section id="architecture-panel" className="panel" aria-labelledby="architecture-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Architecture</p>
          <h2 id="architecture-title">Vue architecture de l'entreprise</h2>
          <p className="muted">
            Diagramme lisible par catégorie avec annotations et interactions détaillées pour le rapport final.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            id="architecture-export-png"
            className="btn"
            type="button"
            onClick={() => handleExport("png")}
          >
            Export PNG
          </button>
          <button
            id="architecture-export-svg"
            className="btn"
            type="button"
            onClick={() => handleExport("svg")}
          >
            Export SVG
          </button>
        </div>
      </div>

      <PageIntro
        title="Synthétiser l'architecture"
        objective="Offrir une vue globale des composants et dépendances pour alimenter les audits et comités PRA."
        steps={[
          "Charger les composants et catégories",
          "Analyser les dépendances critiques",
          "Exporter le diagramme pour les rapports",
        ]}
        links={[
          { label: "Visualiser le schéma", href: "#architecture-chart", description: "Graphique" },
          { label: "Exporter l'image", href: "#architecture-export-png", description: "PNG" },
          { label: "Relire les annotations", href: "#architecture-notes", description: "Astuce" },
        ]}
        expectedData={[
          "Catégories d'architecture et criticités",
          "Liens entre applications et infra",
          "Niveaux de priorité métier",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <div id="architecture-filters" className="card form-grid" style={{ marginTop: "1.5rem" }}>
        <div className="card-header" style={{ gridColumn: "1 / -1" }}>
          <div>
            <p className="eyebrow">Filtres</p>
            <h3>Affiner la vue</h3>
          </div>
        </div>

        <label className="form-field">
          <span>Domaine</span>
          <select
            value={domainFilter}
            onChange={(event) => setDomainFilter(event.target.value)}
          >
            <option value="all">Tous les domaines</option>
            {domains.map((domain) => (
              <option key={domain} value={domain.toLowerCase()}>
                {domain}
              </option>
            ))}
          </select>
          <p className="helper">Filtrez le graphe par domaine fonctionnel.</p>
        </label>

        <div className="form-field" style={{ gridColumn: "1 / -1" }}>
          <span>Criticité</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem" }}>
            {CRITICALITY_ORDER.map((crit) => {
              const isChecked = selectedCriticalities.includes(crit);
              return (
                <label key={crit} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelectedCriticalities((prev) =>
                        checked ? [...prev, crit] : prev.filter((value) => value !== crit)
                      );
                    }}
                  />
                  <span>{CRITICALITY_LABELS[crit]}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div id="architecture-summary" className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <div>
            <p className="eyebrow">Résumé</p>
            <h3>Vue par catégorie</h3>
          </div>
        </div>
        <div style={{ display: "grid", gap: "1rem" }}>
          {categorySummary.map((summary) => (
            <div key={summary.category} className="muted">
              <strong>{summary.category}</strong> — {summary.serviceCount} services • Criticité
              moyenne: {CRITICALITY_LABELS[summary.averageCriticality] || summary.averageCriticality}
              {summary.dependencies.length > 0 && (
                <span>
                  {" "}
                  • Dépendances:{" "}
                  {summary.dependencies.map((dep) => `${dep.target} (${dep.count})`).join(", ")}
                </span>
              )}
            </div>
          ))}
          {categorySummary.length === 0 && (
            <div className="muted">Aucune donnée à afficher avec ces filtres.</div>
          )}
        </div>
      </div>

      <div id="architecture-chart" className="card">
        <ReactECharts
          ref={chartRef}
          option={options as any}
          style={{ height: 600 }}
          opts={{ renderer: "svg" }}
        />
      </div>
      <div id="architecture-notes" className="muted small">
        Astuce : utilisez le zoom et le déplacement pour annoter les interactions clés avant export.
      </div>
    </section>
  );
}

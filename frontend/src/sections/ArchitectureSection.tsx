import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
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
  const chartRef = useRef<ReactECharts>(null);

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const data: GraphApiResponse = await apiFetch("/graph");
        setGraph(data);
      } catch (err: any) {
        setError(err.message || "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    };
    fetchGraph();
  }, [configVersion]);

  const options = useMemo(() => {
    if (!graph) return null;
    const categories = Array.from(
      new Set(graph.nodes.map((node) => node.category || "Application"))
    );

    const nodes = graph.nodes.map((node: GraphNode) => ({
      id: node.id,
      name: node.label,
      value: node.criticality,
      category: categories.indexOf(node.category || "Application"),
      symbol: node.nodeKind === "application" ? "circle" : "rect",
      symbolSize: node.nodeKind === "application" ? 36 : 42,
      itemStyle: { color: nodeColor(node.category, node.criticality) },
      label: {
        show: true,
        formatter: `${node.label}\n${node.category || "Application"}`,
      },
    }));

    const links = graph.edges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      value: edge.type,
      lineStyle: { opacity: 0.5, width: edge.strength === "strong" ? 3 : 1 },
      label: { show: true, formatter: edge.type || "" },
    }));

    return {
      tooltip: {
        formatter: (params: any) => {
          if (params.dataType === "node") {
            return `${params.data.name}<br/>Catégorie: ${categories[params.data.category]}<br/>Criticité: ${
              params.data.value
            }`;
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

  const handleExport = () => {
    if (!chartRef.current) return;
    const instance = chartRef.current.getEchartsInstance();
    const dataUrl = instance.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "architecture-diagram.png";
    link.click();
  };

  if (loading) return <div className="skeleton">Chargement du diagramme...</div>;
  if (error) return <div className="alert error">Erreur lors du chargement : {error}</div>;
  if (!options) return null;

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
        <button className="btn" type="button" onClick={handleExport}>
          Exporter le diagramme
        </button>
      </div>

      <div className="card">
        <ReactECharts ref={chartRef} option={options as any} style={{ height: 600 }} />
      </div>
      <div className="muted small">
        Astuce : utilisez le zoom et le déplacement pour annoter les interactions clés avant export.
      </div>
    </section>
  );
}

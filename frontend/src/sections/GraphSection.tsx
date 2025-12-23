import { useEffect, useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ReactECharts from "echarts-for-react";
import type { GraphApiResponse, GraphEdge, GraphNode } from "../types";
import { apiFetch } from "../utils/api";

type GraphView = "landing" | "applications" | "mixed" | "bubbles";

interface GraphSectionProps {
  configVersion: number;
}

const CRIT_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#fbbf24",
  low: "#10b981",
  default: "#6b7280",
};

const VIEW_LABELS: Record<GraphView, string> = {
  landing: "Service Landing Zone",
  applications: "Application",
  mixed: "Service ↔ Application",
  bubbles: "Bulles de criticité",
};

function colorFromCrit(crit?: string | null) {
  if (!crit) return CRIT_COLORS.default;
  return CRIT_COLORS[crit] || CRIT_COLORS.default;
}

function shapeNode(
  node: GraphNode,
  ctx: CanvasRenderingContext2D,
  scale: number
) {
  const size = 12 / scale;
  const color = colorFromCrit(node.criticality);

  if (node.nodeKind === "application") {
    ctx.beginPath();
    ctx.ellipse(node.x!, node.y!, size, size * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    const width = size * 2;
    const height = size * 1.2;
    ctx.fillStyle = color;
    ctx.fillRect(node.x! - width / 2, node.y! - height / 2, width, height);
  }

  ctx.font = `${10 / scale}px Sans-Serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#111827";
  ctx.fillText(node.label, node.x!, node.y! + size);
}

function filterNodesByView(nodes: GraphNode[], view: GraphView) {
  if (view === "landing") {
    return nodes.filter((n) => n.isLandingZone);
  }
  if (view === "applications") {
    return nodes.filter((n) => n.nodeKind === "application");
  }
  return nodes;
}

function filterEdges(edges: GraphEdge[], nodes: GraphNode[]) {
  const allowed = new Set(nodes.map((n) => n.id));
  return edges
    .filter((e) => allowed.has(e.from) && allowed.has(e.to))
    .map((edge) => ({ ...edge, source: edge.from, target: edge.to }));
}

export function GraphSection({ configVersion }: GraphSectionProps) {
  const [graph, setGraph] = useState<GraphApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<GraphView>("landing");
  const [critFilter, setCritFilter] = useState<string>("all");

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

  const filteredNodes = useMemo(() => {
    if (!graph) return [];
    const critAllowed = critFilter === "all" ? null : critFilter;
    const base = filterNodesByView(
      graph.nodes.map((n) => ({
        ...n,
        label: n.label || n.id,
      })),
      view
    );

    return critAllowed ? base.filter((n) => (n.criticality || "").toLowerCase() === critAllowed) : base;
  }, [graph, view, critFilter]);

  const filteredEdges = useMemo(() => {
    if (!graph) return [];
    return filterEdges(
      graph.edges.map((e) => ({ ...e })),
      filteredNodes
    );
  }, [graph, filteredNodes]);

  const bubbleOptions = useMemo(() => {
    const categories = graph?.views?.categories ?? graph?.categories ?? [];
    const nodes = categories.map((cat) => ({
      name: cat.category,
      value: cat.serviceCount || cat.count || 1,
      symbolSize: 24 + Math.sqrt(cat.serviceCount || cat.count || 1) * 6,
      itemStyle: { color: colorFromCrit(cat.averageCriticality) },
      label: { formatter: `${cat.category}\n${cat.serviceCount || cat.count} svc` },
      tooltip: {
        formatter: () =>
          `${cat.category}<br/>Services: ${cat.serviceCount || cat.count}<br/>Criticité: ${
            cat.averageCriticality
          }`,
      },
    }));

    const links =
      categories.flatMap((cat) =>
        (cat.dependencies || []).map((dep) => ({
          source: cat.category,
          target: dep.target,
          value: dep.count,
          label: { show: true, formatter: `${dep.count}` },
        }))
      ) || [];

    return {
      tooltip: { trigger: "item" },
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          data: nodes,
          links,
          emphasis: { focus: "adjacency" },
          label: { show: true },
          force: { repulsion: 180, edgeLength: 120 },
        },
      ],
    };
  }, [graph]);

  if (loading) return <div className="skeleton">Chargement du graphe...</div>;
  if (error) return <div className="alert error">Erreur lors du chargement : {error}</div>;
  if (!graph) return null;

  return (
    <section id="graph-panel" className="panel" aria-labelledby="graph-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Dépendances</p>
          <h2 id="graph-title">Graphe des dépendances</h2>
          <p className="muted">
            Visualisation des relations entre services et applications : filtres par criticité, vues multi-perspectives
            et bulles de catégories.
          </p>
        </div>
        <div className="stack" style={{ alignItems: "flex-end", gap: "8px" }}>
          <div className="stack horizontal" style={{ gap: "8px" }}>
            {(Object.keys(VIEW_LABELS) as GraphView[]).map((key) => (
              <label key={key} className="chip">
                <input
                  type="radio"
                  name="graph-view"
                  value={key}
                  checked={view === key}
                  onChange={() => setView(key)}
                />
                {VIEW_LABELS[key]}
              </label>
            ))}
          </div>
          <label className="form-field" style={{ minWidth: "200px" }}>
            <span>Filtrer par criticité</span>
            <select value={critFilter} onChange={(e) => setCritFilter(e.target.value)}>
              <option value="all">Toutes</option>
              <option value="critical">Critique</option>
              <option value="high">Haute</option>
              <option value="medium">Moyenne</option>
              <option value="low">Faible</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card graph-card">
        {view === "bubbles" ? (
          <ReactECharts option={bubbleOptions as any} style={{ height: 520 }} />
        ) : (
          <ForceGraph2D
            graphData={{ nodes: filteredNodes, links: filteredEdges }}
            enableZoomInteraction
            nodeLabel={(node: any) =>
              `${node.label}\nType: ${node.type}\nCatégorie: ${node.category || "-"}\nCriticité: ${
                node.criticality
              }\nDépend de: ${node.dependsOnCount ?? 0} • Utilisé par: ${node.usedByCount ?? 0}\nRTO: ${
                node.rtoHours ?? "-"
              }h / RPO: ${node.rpoMinutes ?? "-"} min`
            }
            linkDirectionalArrowLength={6}
            linkDirectionalArrowRelPos={1}
            linkLabel={(link: any) => link.type || "dépendance"}
            nodeCanvasObject={(node: any, ctx, globalScale) => shapeNode(node as GraphNode, ctx, globalScale)}
          />
        )}
      </div>
      <div className="muted small">
        Astuces : survoler pour le détail, zoom/drag activés, les rectangles = services, ellipses = applications, couleurs = criticité.
      </div>
    </section>
  );
}

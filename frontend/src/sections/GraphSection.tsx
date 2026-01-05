import { useEffect, useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ReactECharts from "echarts-for-react";
import type { GraphApiResponse, GraphEdge, GraphNode } from "../types";
import { apiFetch } from "../utils/api";

type GraphView = "landing" | "applications" | "mixed" | "bubbles";
type InfoLevel = "compact" | "normal" | "detailed";

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

const INFO_LEVEL_LABELS: Record<InfoLevel, string> = {
  compact: "Compact",
  normal: "Normal",
  detailed: "Détaillé",
};

const CRIT_LEGEND = [
  { key: "critical", label: "Critique" },
  { key: "high", label: "Haute" },
  { key: "medium", label: "Moyenne" },
  { key: "low", label: "Faible" },
] as const;

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

function getNodeDetails(node: GraphNode) {
  return (
    node.detailPayload || {
      name: node.label,
      type: node.type ?? null,
      category: node.category || "-",
      criticality: node.criticality,
      businessPriority: node.businessPriority ?? null,
      domain: node.domain ?? null,
      isLandingZone: Boolean(node.isLandingZone),
      rtoHours: node.rtoHours ?? null,
      rpoMinutes: node.rpoMinutes ?? null,
      mtpdHours: node.mtpdHours ?? null,
      dependsOnCount: node.dependsOnCount ?? 0,
      usedByCount: node.usedByCount ?? 0,
    }
  );
}

function isEssentialNode(node: GraphNode) {
  const crit = (node.criticality || "").toLowerCase();
  const details = getNodeDetails(node);
  const linkLoad = (details.dependsOnCount || 0) + (details.usedByCount || 0);
  return crit === "critical" || crit === "high" || Boolean(details.isLandingZone) || linkLoad >= 6;
}

function buildTooltip(node: GraphNode, infoLevel: InfoLevel) {
  const details = getNodeDetails(node);
  const lines = [
    `<strong>${details.name}</strong>`,
    `Criticité: ${details.criticality}`,
  ];

  if (infoLevel !== "compact") {
    lines.push(
      `Type: ${details.type || "-"}`,
      `Catégorie: ${details.category || "-"}`,
      `Dépend de: ${details.dependsOnCount} • Utilisé par: ${details.usedByCount}`
    );
  }

  if (infoLevel === "detailed") {
    lines.push(
      `Domaine: ${details.domain || "-"}`,
      `Priorité métier: ${details.businessPriority ?? "-"}`,
      `RTO: ${details.rtoHours ?? "-"}h / RPO: ${details.rpoMinutes ?? "-"} min / MTPD: ${
        details.mtpdHours ?? "-"
      }h`,
      `Landing zone: ${details.isLandingZone ? "Oui" : "Non"}`
    );
  }

  return lines.join("<br/>");
}

export function GraphSection({ configVersion }: GraphSectionProps) {
  const [graph, setGraph] = useState<GraphApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<GraphView>("landing");
  const [critFilter, setCritFilter] = useState<string>("all");
  const [showDetails, setShowDetails] = useState(false);
  const [infoLevel, setInfoLevel] = useState<InfoLevel>("normal");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

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
        label: n.summaryLabel || n.label || n.id,
      })),
      view
    );

    const filteredByCrit = critAllowed
      ? base.filter((n) => (n.criticality || "").toLowerCase() === critAllowed)
      : base;

    return showDetails ? filteredByCrit : filteredByCrit.filter((n) => isEssentialNode(n));
  }, [graph, view, critFilter, showDetails]);

  const filteredEdges = useMemo(() => {
    if (!graph) return [];
    return filterEdges(
      graph.edges.map((e) => ({ ...e })),
      filteredNodes
    );
  }, [graph, filteredNodes]);

  useEffect(() => {
    if (!selectedNode) return;
    const stillVisible = filteredNodes.some((node) => node.id === selectedNode.id);
    if (!stillVisible) {
      setSelectedNode(null);
    }
  }, [filteredNodes, selectedNode]);

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

      <div className="graph-toolbar">
        <div className="legend">
          <span className="legend-title">Criticité</span>
          {CRIT_LEGEND.map((item) => (
            <span key={item.key} className="legend-item">
              <span className="legend-swatch" style={{ background: CRIT_COLORS[item.key] }} />
              {item.label}
            </span>
          ))}
          <span className="legend-divider" />
          <span className="legend-title">Formes</span>
          <span className="legend-item">
            <span className="legend-shape legend-shape-service" />
            Service
          </span>
          <span className="legend-item">
            <span className="legend-shape legend-shape-app" />
            Application
          </span>
        </div>
        <div className="stack horizontal" style={{ gap: "12px" }}>
          <label className="form-field" style={{ minWidth: "180px" }}>
            <span>Niveau d'information</span>
            <select value={infoLevel} onChange={(e) => setInfoLevel(e.target.value as InfoLevel)}>
              {(Object.keys(INFO_LEVEL_LABELS) as InfoLevel[]).map((level) => (
                <option key={level} value={level}>
                  {INFO_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
            <span>Détails</span>
          </label>
        </div>
      </div>

      <div className="graph-layout">
        <div className="card graph-card">
          {view === "bubbles" ? (
            <ReactECharts option={bubbleOptions as any} style={{ height: 520 }} />
          ) : (
            <ForceGraph2D
              graphData={{ nodes: filteredNodes, links: filteredEdges }}
              enableZoomInteraction
              nodeLabel={(node: any) => buildTooltip(node as GraphNode, infoLevel)}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
              linkLabel={(link: any) =>
                infoLevel === "detailed"
                  ? link.edgeLabelLong || link.edgeLabelShort || link.type || "dépendance"
                  : link.edgeLabelShort || link.type || "dépendance"
              }
              onNodeClick={(node: any) => setSelectedNode(node as GraphNode)}
              onBackgroundClick={() => setSelectedNode(null)}
              nodeCanvasObject={(node: any, ctx, globalScale) => shapeNode(node as GraphNode, ctx, globalScale)}
            />
          )}
        </div>

        <aside className="graph-side-panel card" aria-live="polite">
          <div className="card-header">
            <h3 className="section-title">Détails du nœud</h3>
            {selectedNode ? (
              <button className="btn subtle" type="button" onClick={() => setSelectedNode(null)}>
                Fermer
              </button>
            ) : null}
          </div>
          {selectedNode ? (
            (() => {
              const details = getNodeDetails(selectedNode);
              return (
                <div className="detail-list">
                  <div>
                    <span className="detail-label">Nom</span>
                    <span>{details.name}</span>
                  </div>
                  {infoLevel !== "compact" ? (
                    <>
                      <div>
                        <span className="detail-label">Type</span>
                        <span>{details.type || "-"}</span>
                      </div>
                      <div>
                        <span className="detail-label">Catégorie</span>
                        <span>{details.category || "-"}</span>
                      </div>
                    </>
                  ) : null}
                  <div>
                    <span className="detail-label">Criticité</span>
                    <span>{details.criticality}</span>
                  </div>
                  {infoLevel !== "compact" ? (
                    <div>
                      <span className="detail-label">Relations</span>
                      <span>
                        Dépend de {details.dependsOnCount} • Utilisé par {details.usedByCount}
                      </span>
                    </div>
                  ) : null}
                  {infoLevel === "detailed" ? (
                    <>
                      <div>
                        <span className="detail-label">Domaine</span>
                        <span>{details.domain || "-"}</span>
                      </div>
                      <div>
                        <span className="detail-label">Priorité métier</span>
                        <span>{details.businessPriority ?? "-"}</span>
                      </div>
                      <div>
                        <span className="detail-label">Continuité</span>
                        <span>
                          RTO {details.rtoHours ?? "-"}h / RPO {details.rpoMinutes ?? "-"} min / MTPD{" "}
                          {details.mtpdHours ?? "-"}h
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Landing zone</span>
                        <span>{details.isLandingZone ? "Oui" : "Non"}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })()
          ) : (
            <p className="muted">Cliquez sur un nœud pour afficher ses informations détaillées.</p>
          )}
        </aside>
      </div>

      <div className="muted small">
        Astuces : survoler pour le détail, zoom/drag activés, rectangles = services, ellipses = applications, couleurs
        = criticité. Le mode essentiel masque les nœuds secondaires.
      </div>
    </section>
  );
}

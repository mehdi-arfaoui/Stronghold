import { useEffect, useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ReactECharts from "echarts-for-react";
import { PageIntro } from "../components/PageIntro";
import { ActionToolbar } from "../components/ui/ActionToolbar";
import { InlineHelp } from "../components/ui/InlineHelp";
import type { GraphApiResponse, GraphEdge, GraphNode } from "../types";
import { apiFetch } from "../utils/api";

type GraphView = "landing" | "applications" | "mixed" | "dependencyMap" | "bubbles";
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
  dependencyMap: "Dependency Map (services)",
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

const EDGE_KIND_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  STRONG: "#f97316",
  NORMAL: "#94a3b8",
  default: "#94a3b8",
};

function colorFromCrit(crit?: string | null) {
  if (!crit) return CRIT_COLORS.default;
  return CRIT_COLORS[crit] || CRIT_COLORS.default;
}

function colorFromEdgeKind(edgeKind?: string | null) {
  if (!edgeKind) return EDGE_KIND_COLORS.default;
  return EDGE_KIND_COLORS[edgeKind] || EDGE_KIND_COLORS.default;
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
  if (view === "dependencyMap") {
    return nodes.filter((n) => n.nodeKind !== "application");
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
  const [dependencyGraph, setDependencyGraph] = useState<GraphApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dependencyLoading, setDependencyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [view, setView] = useState<GraphView>("landing");
  const [critFilter, setCritFilter] = useState<string>("all");
  const [showDetails, setShowDetails] = useState(false);
  const [infoLevel, setInfoLevel] = useState<InfoLevel>("normal");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [highlightDependencies, setHighlightDependencies] = useState(true);
  const [showDependencyType, setShowDependencyType] = useState(true);

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

  useEffect(() => {
    setDependencyGraph(null);
    setDependencyError(null);
  }, [configVersion]);

  useEffect(() => {
    if (view !== "dependencyMap" || dependencyGraph || dependencyLoading) return;
    const fetchDependencyGraph = async () => {
      setDependencyLoading(true);
      setDependencyError(null);
      try {
        const data: GraphApiResponse = await apiFetch("/graph/dependencies-only");
        setDependencyGraph(data);
      } catch (err: any) {
        setDependencyError(err.message || "Erreur inconnue");
      } finally {
        setDependencyLoading(false);
      }
    };
    fetchDependencyGraph();
  }, [view, dependencyGraph, dependencyLoading, configVersion]);

  const activeGraph = view === "dependencyMap" ? dependencyGraph : graph;
  const activeLoading = view === "dependencyMap" ? dependencyLoading : loading;
  const activeError = view === "dependencyMap" ? dependencyError : error;

  const filteredNodes = useMemo(() => {
    if (!activeGraph) return [];
    const critAllowed = critFilter === "all" ? null : critFilter;
    const base = filterNodesByView(
      activeGraph.nodes.map((n) => ({
        ...n,
        label: n.summaryLabel || n.label || n.id,
      })),
      view
    );

    const filteredByCrit = critAllowed
      ? base.filter((n) => (n.criticality || "").toLowerCase() === critAllowed)
      : base;

    return showDetails ? filteredByCrit : filteredByCrit.filter((n) => isEssentialNode(n));
  }, [activeGraph, view, critFilter, showDetails]);

  const filteredEdges = useMemo(() => {
    if (!activeGraph) return [];
    return filterEdges(
      activeGraph.edges.map((e) => ({ ...e })),
      filteredNodes
    );
  }, [activeGraph, filteredNodes]);

  const isEdgeConnected = (edge: GraphEdge, nodeId: string) => edge.from === nodeId || edge.to === nodeId;

  const getLinkColor = (link: GraphEdge) => {
    const baseColor = colorFromEdgeKind(link.edgeKind);
    if (highlightDependencies && hoveredNode) {
      return isEdgeConnected(link, hoveredNode.id) ? baseColor : "rgba(148, 163, 184, 0.25)";
    }
    return baseColor;
  };

  const getLinkWidth = (link: GraphEdge) => {
    const baseWidth = Math.max(1, (link.edgeWeight ?? 1) * 0.6);
    if (highlightDependencies && hoveredNode) {
      return isEdgeConnected(link, hoveredNode.id) ? baseWidth + 1 : Math.max(0.5, baseWidth * 0.5);
    }
    return baseWidth;
  };

  const getLinkLabel = (link: GraphEdge) => {
    if (!showDependencyType) return undefined;
    if (infoLevel === "detailed") {
      return link.edgeLabelLong || link.edgeLabelShort || link.type || "dépendance";
    }
    return link.edgeLabelShort || link.type || "dépendance";
  };

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

  if (activeLoading) return <div className="skeleton">Chargement du graphe...</div>;
  if (activeError) return <div className="alert error">Erreur lors du chargement : {activeError}</div>;
  if (!activeGraph) return null;

  const progressSteps =
    view === "dependencyMap"
      ? [activeGraph.nodes.length > 0, activeGraph.edges.length > 0]
      : [
          (graph?.nodes.length ?? 0) > 0,
          (graph?.edges.length ?? 0) > 0,
          (graph?.views?.categories ?? graph?.categories ?? []).length > 0,
        ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

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
        <div id="graph-views" className="stack" style={{ alignItems: "flex-end", gap: "8px" }}>
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

      <PageIntro
        title="Explorer les dépendances"
        objective="Comprendre les liens entre services, applications et Landing Zone pour anticiper les impacts PRA."
        steps={[
          "Choisir une vue de graphe",
          "Filtrer par criticité ou niveau d'information",
          "Analyser les dépendances clés",
        ]}
        tips={[
          "Passez en vue bulles pour comparer les criticités.",
          "Utilisez le filtre de criticité pour isoler les impacts majeurs.",
          "Activez le niveau détaillé pour enrichir les tooltips.",
        ]}
        links={[
          { label: "Changer de vue", href: "#graph-views", description: "Vues disponibles" },
          { label: "Ajuster les filtres", href: "#graph-controls", description: "Toolbar" },
          { label: "Lire les détails", href: "#graph-details", description: "Panneau latéral" },
        ]}
        expectedData={[
          "Services et applications chargés",
          "Relations et criticités renseignées",
          "Catégories et vues disponibles",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <ActionToolbar id="graph-controls">
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
          <span className="legend-divider" />
          <span className="legend-title">Dépendances</span>
          <span className="legend-item">
            <span className="legend-edge" style={{ color: EDGE_KIND_COLORS.CRITICAL }} />
            Critique
          </span>
          <span className="legend-item">
            <span className="legend-edge" style={{ color: EDGE_KIND_COLORS.STRONG }} />
            Forte
          </span>
          <span className="legend-item">
            <span className="legend-edge" style={{ color: EDGE_KIND_COLORS.NORMAL }} />
            Normale
          </span>
          <span className="legend-item">
            <span className="legend-edge" style={{ color: "var(--color-neutral-400)" }} />
            Sens : source → cible
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
            <input
              type="checkbox"
              checked={highlightDependencies}
              onChange={(e) => setHighlightDependencies(e.target.checked)}
            />
            <span>Highlight dépendances</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showDependencyType}
              onChange={(e) => setShowDependencyType(e.target.checked)}
            />
            <span>Type en tooltip</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
            <span>Détails</span>
          </label>
        </div>
        <InlineHelp>
          <strong>Astuce :</strong> combinez les filtres pour isoler les dépendances critiques.
        </InlineHelp>
      </ActionToolbar>

      <div className="graph-layout">
        <div className="card graph-card">
          {view === "bubbles" ? (
            <ReactECharts option={bubbleOptions as any} style={{ height: 520 }} />
          ) : (
            <ForceGraph2D
              graphData={{ nodes: filteredNodes, links: filteredEdges }}
              enableZoomInteraction
              nodeLabel={(node: any) => buildTooltip(node as GraphNode, infoLevel)}
              linkDirectionalArrowLength={(link: any) => Math.max(6, (link.edgeWeight ?? 1) * 1.5)}
              linkDirectionalArrowRelPos={1}
              linkLabel={(link: any) => getLinkLabel(link as GraphEdge)}
              linkWidth={(link: any) => getLinkWidth(link as GraphEdge)}
              linkColor={(link: any) => getLinkColor(link as GraphEdge)}
              linkDirectionalArrowColor={(link: any) => getLinkColor(link as GraphEdge)}
              onNodeClick={(node: any) => setSelectedNode(node as GraphNode)}
              onNodeHover={(node: any) => setHoveredNode(node ? (node as GraphNode) : null)}
              onBackgroundClick={() => {
                setSelectedNode(null);
                setHoveredNode(null);
              }}
              nodeCanvasObject={(node: any, ctx, globalScale) => shapeNode(node as GraphNode, ctx, globalScale)}
            />
          )}
        </div>

        <aside id="graph-details" className="graph-side-panel card" aria-live="polite">
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

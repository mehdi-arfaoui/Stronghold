import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { SectionLayout } from "../components/ui/SectionLayout";
import { ActionToolbar } from "../components/ui/ActionToolbar";
import { InlineHelp } from "../components/ui/InlineHelp";
import { InfrastructureGraph } from "../components/graph/InfrastructureGraph";
import type { InfrastructureGraphHandle } from "../components/graph/InfrastructureGraph";
import type { InfrastructureGraphData, InfrastructureNodeType } from "../types/infrastructureGraph";
import { useFetchGraphData } from "../hooks/useFetchGraphData";
import { buildCytoscapeElements, filterGraphByTypes } from "../utils/graphTransform";

type GraphView = "cytoscape" | "landing" | "applications" | "mixed" | "dependencyMap" | "bubbles";
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
  cytoscape: "Graphe Cytoscape",
  landing: "Service Landing Zone",
  applications: "Application",
  mixed: "Service + Application",
  dependencyMap: "Carte des dépendances",
  bubbles: "Bulles de criticité",
};

const VIEW_DESCRIPTIONS: Record<GraphView, string> = {
  cytoscape: "Visualisation interactive complète avec Cytoscape.js",
  landing: "Services de la zone d'atterrissage",
  applications: "Vue centrée sur les applications",
  mixed: "Relations services-applications",
  dependencyMap: "Dépendances entre services et infrastructure",
  bubbles: "Vue agrégée par catégorie avec ECharts",
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

function filterNodesByView(nodes: InfrastructureGraphData["nodes"], view: GraphView) {
  if (view === "landing") {
    return nodes.filter((n) => Boolean(n.metadata && (n.metadata as any).isLandingZone));
  }
  if (view === "applications") {
    return nodes.filter((n) => n.type === "application");
  }
  if (view === "dependencyMap") {
    return nodes.filter((n) => n.type !== "application");
  }
  return nodes;
}

function isEssentialNode(node: InfrastructureGraphData["nodes"][number]) {
  const crit = (node.criticality || "").toLowerCase();
  const linkLoad = (node.dependsOnCount || 0) + (node.usedByCount || 0);
  const isLandingZone = Boolean(node.metadata && (node.metadata as any).isLandingZone);
  return crit === "critical" || crit === "high" || isLandingZone || linkLoad >= 6;
}

export function GraphSection({ configVersion }: GraphSectionProps) {
  const [view, setView] = useState<GraphView>("cytoscape");
  const [critFilter, setCritFilter] = useState<string>("all");
  const [showDetails, setShowDetails] = useState(true);
  const [infoLevel, setInfoLevel] = useState<InfoLevel>("normal");
  const [selectedNode, setSelectedNode] = useState<InfrastructureGraphData["nodes"][number] | null>(null);
  const [allowedTypes, setAllowedTypes] = useState<Set<InfrastructureNodeType>>(
    () => new Set(["service", "application", "infra"])
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const graphRef = useRef<InfrastructureGraphHandle | null>(null);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const {
    raw: graph,
    data: graphData,
    loading,
    error,
    refresh,
  } = useFetchGraphData({ endpoint: "/graph", refreshKey: configVersion });

  const {
    raw: dependencyGraph,
    data: dependencyGraphData,
    loading: dependencyLoading,
    error: dependencyError,
    refresh: refreshDependencies,
  } = useFetchGraphData({
    endpoint: "/graph/dependencies-only",
    enabled: view === "dependencyMap",
    refreshKey: configVersion,
  });

  const activeGraph = view === "dependencyMap" ? dependencyGraph : graph;
  const activeGraphData = view === "dependencyMap" ? dependencyGraphData : graphData;
  const activeLoading = view === "dependencyMap" ? dependencyLoading : loading;
  const activeError = view === "dependencyMap" ? dependencyError : error;

  const filteredNodes = useMemo(() => {
    if (!activeGraphData) return [];
    const critAllowed = critFilter === "all" ? null : critFilter;
    const base = filterNodesByView(activeGraphData.nodes, view);
    const filteredByType = filterGraphByTypes({ nodes: base, edges: activeGraphData.edges }, allowedTypes).nodes;
    const filteredByCrit = critAllowed
      ? filteredByType.filter((n) => (n.criticality || "").toLowerCase() === critAllowed)
      : filteredByType;
    return showDetails ? filteredByCrit : filteredByCrit.filter((n) => isEssentialNode(n));
  }, [activeGraphData, view, critFilter, showDetails, allowedTypes]);

  const filteredEdges = useMemo(() => {
    if (!activeGraphData) return [];
    const allowed = new Set(filteredNodes.map((node) => node.id));
    return activeGraphData.edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
  }, [activeGraphData, filteredNodes]);

  useEffect(() => {
    if (!selectedNode) return;
    const stillVisible = filteredNodes.some((node) => node.id === selectedNode.id);
    if (!stillVisible) {
      setSelectedNode(null);
    }
  }, [filteredNodes, selectedNode]);

  // Statistiques du graphe
  const graphStats = useMemo(() => {
    if (!activeGraphData) return null;
    const nodes = filteredNodes;
    const edges = filteredEdges;

    const serviceCount = nodes.filter(n => n.type === "service").length;
    const appCount = nodes.filter(n => n.type === "application").length;
    const infraCount = nodes.filter(n => n.type === "infra").length;

    const criticalCount = nodes.filter(n => n.criticality?.toLowerCase() === "critical").length;
    const highCount = nodes.filter(n => n.criticality?.toLowerCase() === "high").length;

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      serviceCount,
      appCount,
      infraCount,
      criticalCount,
      highCount,
    };
  }, [activeGraphData, filteredNodes, filteredEdges]);

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

  if (activeLoading) return <div className="skeleton">Chargement du graphe Cytoscape...</div>;
  if (activeError) return <div className="alert error">Erreur lors du chargement : {activeError}</div>;
  if (!activeGraph) return null;

  const filteredGraph = { nodes: filteredNodes, edges: filteredEdges };

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

  const isCytoscapeView = view !== "bubbles";

  return (
    <section id="graph-panel" className="panel" aria-labelledby="graph-title">
      {/* En-tête de section avec statistiques */}
      <div className="panel-header">
        <div>
          <p className="eyebrow">Visualisation Cytoscape</p>
          <h2 id="graph-title">Graphes d'Infrastructure</h2>
          <p className="muted">
            Explorez les relations et dépendances de votre infrastructure avec des graphes interactifs
            générés par Cytoscape.js. Filtrez par criticité, type de nœud et niveau de détail.
          </p>
        </div>
        {graphStats && (
          <div className="graph-stats-badges">
            <span className="badge subtle">{graphStats.totalNodes} nœuds</span>
            <span className="badge subtle">{graphStats.totalEdges} liens</span>
            {graphStats.criticalCount > 0 && (
              <span className="badge" style={{ background: CRIT_COLORS.critical }}>{graphStats.criticalCount} critiques</span>
            )}
          </div>
        )}
      </div>

      {/* Sélecteur de vues */}
      <div id="graph-views" className="graph-view-selector">
        <p className="legend-title">Choisir une vue</p>
        <div className="graph-view-grid">
          {(Object.keys(VIEW_LABELS) as GraphView[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`graph-view-btn ${view === key ? "active" : ""}`}
              onClick={() => setView(key)}
              aria-pressed={view === key}
            >
              <span className="graph-view-btn-label">{VIEW_LABELS[key]}</span>
              <span className="graph-view-btn-desc">{VIEW_DESCRIPTIONS[key]}</span>
            </button>
          ))}
        </div>
      </div>

      <SectionLayout
        id="graph"
        title="Graphe Cytoscape"
        description="Visualisez les dépendances entre services, applications et infrastructure avec Cytoscape.js."
        badge={`${filteredNodes.length} nœuds affichés`}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
        whyThisStep="Le graphe de dépendances révèle les impacts potentiels et les points critiques du PRA."
        quickLinks={[
          { label: "Changer de vue", href: "#graph-views" },
          { label: "Ajuster les filtres", href: "#graph-controls" },
          { label: "Détails du nœud", href: "#graph-details" },
        ]}
        tips={[
          "Double-cliquez sur un nœud pour zoomer sur son sous-graphe.",
          "Utilisez le filtre de criticité pour isoler les impacts majeurs.",
          "Exportez en PNG ou SVG pour vos rapports.",
        ]}
      >
        {/* Barre de légende et filtres */}
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
            <span className="legend-item">
              <span className="legend-shape legend-shape-infra" />
              Infrastructure
            </span>
          </div>
        </ActionToolbar>

        {/* Contrôles de filtre */}
        <div className="graph-controls-row">
          <div className="stack horizontal" style={{ gap: "12px", flexWrap: "wrap" }}>
            <label className="form-field" style={{ minWidth: "160px" }}>
              <span>Filtrer par criticité</span>
              <select value={critFilter} onChange={(e) => setCritFilter(e.target.value)}>
                <option value="all">Toutes</option>
                <option value="critical">Critique</option>
                <option value="high">Haute</option>
                <option value="medium">Moyenne</option>
                <option value="low">Faible</option>
              </select>
            </label>
            <label className="form-field" style={{ minWidth: "160px" }}>
              <span>Niveau d'information</span>
              <select value={infoLevel} onChange={(e) => setInfoLevel(e.target.value as InfoLevel)}>
                {(Object.keys(INFO_LEVEL_LABELS) as InfoLevel[]).map((level) => (
                  <option key={level} value={level}>
                    {INFO_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
            <div className="stack horizontal" style={{ gap: "8px", alignItems: "flex-end" }}>
              <label className="toggle">
                <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
                <span>Tous les nœuds</span>
              </label>
            </div>
            <div className="stack horizontal" style={{ gap: "6px", alignItems: "flex-end" }}>
              {([
                { label: "Services", value: "service" },
                { label: "Applications", value: "application" },
                { label: "Infra", value: "infra" },
              ] as const).map((item) => (
                <label key={item.value} className="toggle">
                  <input
                    type="checkbox"
                    checked={allowedTypes.has(item.value)}
                    onChange={(e) => {
                      const next = new Set(allowedTypes);
                      if (e.target.checked) {
                        next.add(item.value);
                      } else {
                        next.delete(item.value);
                      }
                      setAllowedTypes(next);
                    }}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions du graphe */}
          <div className="graph-actions">
            {isCytoscapeView && (
              <>
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => graphRef.current?.relayout()}
                  title="Recalculer la disposition des nœuds"
                >
                  Relancer layout
                </button>
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => graphRef.current?.fit()}
                  title="Ajuster le zoom pour voir tout le graphe"
                >
                  Recentrer
                </button>
              </>
            )}
            <button
              type="button"
              className="btn subtle"
              onClick={() => {
                void refresh();
                void refreshDependencies();
              }}
              title="Recharger les données depuis l'API"
            >
              Actualiser
            </button>
            {isCytoscapeView && (
              <>
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => {
                    if (isFullscreen) {
                      graphRef.current?.exitFullscreen();
                    } else {
                      graphRef.current?.enterFullscreen();
                    }
                    setIsFullscreen((prev) => !prev);
                  }}
                  title={isFullscreen ? "Quitter le mode plein écran" : "Afficher en plein écran"}
                >
                  {isFullscreen ? "Quitter plein écran" : "Plein écran"}
                </button>
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => {
                    const png = graphRef.current?.exportPng();
                    if (!png) return;
                    const link = document.createElement("a");
                    link.href = png;
                    link.download = "stronghold-cytoscape-graph.png";
                    link.click();
                  }}
                  title="Exporter le graphe en image PNG"
                >
                  Export PNG
                </button>
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => {
                    const svg = graphRef.current?.exportSvg();
                    if (!svg) return;
                    const blob = new Blob([svg], { type: "image/svg+xml" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "stronghold-cytoscape-graph.svg";
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                  title="Exporter le graphe en format SVG vectoriel"
                >
                  Export SVG
                </button>
              </>
            )}
          </div>
        </div>

        <InlineHelp>
          <strong>Astuce :</strong> double-cliquez sur un nœud pour centrer son sous-graphe. Utilisez la molette pour zoomer.
        </InlineHelp>

        {/* Zone principale du graphe */}
        <div className="graph-layout">
          <div className="card graph-card cytoscape-container">
            {/* Titre de la vue courante */}
            <div className="graph-view-header">
              <h3 className="graph-view-title">{VIEW_LABELS[view]}</h3>
              <span className="graph-view-badge">
                {view === "bubbles" ? "ECharts" : "Cytoscape.js"}
              </span>
            </div>

            {view === "bubbles" ? (
              <ReactECharts option={bubbleOptions as any} style={{ height: 480 }} />
            ) : filteredNodes.length === 0 ? (
              <div className="empty-state" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480 }}>
                <div style={{ textAlign: "center" }}>
                  <p className="muted" style={{ marginBottom: "var(--space-3)" }}>
                    Aucun nœud à afficher avec les filtres actuels.
                  </p>
                  <button className="btn" onClick={() => {
                    setCritFilter("all");
                    setShowDetails(true);
                    setAllowedTypes(new Set(["service", "application", "infra"]));
                  }}>
                    Réinitialiser les filtres
                  </button>
                </div>
              </div>
            ) : (
              <InfrastructureGraph
                ref={graphRef}
                elements={buildCytoscapeElements(filteredGraph)}
                isLoading={activeLoading}
                onNodeSelect={(node) => setSelectedNode(node)}
                onFocusSubgraph={(node) => {
                  setSelectedNode(node);
                }}
                onZoom={() => {
                  // Placeholder pour analytics future
                }}
              />
            )}
          </div>

          {/* Panneau latéral - Détails du nœud */}
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
                const details = selectedNode.metadata as any;
                return (
                  <div className="detail-list">
                    <div>
                      <span className="detail-label">Nom</span>
                      <span className="detail-value">{selectedNode.label}</span>
                    </div>
                    {infoLevel !== "compact" ? (
                      <>
                        <div>
                          <span className="detail-label">Type</span>
                          <span className="detail-value">
                            {selectedNode.type === "service" && "Service"}
                            {selectedNode.type === "application" && "Application"}
                            {selectedNode.type === "infra" && "Infrastructure"}
                          </span>
                        </div>
                        <div>
                          <span className="detail-label">Catégorie</span>
                          <span className="detail-value">{selectedNode.category || "—"}</span>
                        </div>
                      </>
                    ) : null}
                    <div>
                      <span className="detail-label">Criticité</span>
                      <span className={`pill criticality-${selectedNode.criticality?.toLowerCase()}`}>
                        {selectedNode.criticality}
                      </span>
                    </div>
                    {infoLevel !== "compact" ? (
                      <div>
                        <span className="detail-label">Relations</span>
                        <span className="detail-value">
                          Dépend de {selectedNode.dependsOnCount ?? 0} • Utilisé par {selectedNode.usedByCount ?? 0}
                        </span>
                      </div>
                    ) : null}
                    {infoLevel === "detailed" ? (
                      <>
                        <div>
                          <span className="detail-label">Domaine</span>
                          <span className="detail-value">{details?.domain || "—"}</span>
                        </div>
                        <div>
                          <span className="detail-label">Priorité métier</span>
                          <span className="detail-value">{details?.businessPriority ?? "—"}</span>
                        </div>
                        <div>
                          <span className="detail-label">Continuité</span>
                          <span className="detail-value">
                            RTO {details?.rtoHours ?? "—"}h / RPO {details?.rpoMinutes ?? "—"} min / MTPD{" "}
                            {details?.mtpdHours ?? "—"}h
                          </span>
                        </div>
                        <div>
                          <span className="detail-label">Landing zone</span>
                          <span className="detail-value">{details?.isLandingZone ? "Oui" : "Non"}</span>
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })()
            ) : (
              <div className="empty-node-info">
                <p className="muted">Cliquez sur un nœud du graphe Cytoscape pour afficher ses informations détaillées.</p>
                <div className="node-info-hint">
                  <span className="legend-shape legend-shape-service" /> Services
                  <span className="legend-shape legend-shape-app" /> Applications
                  <span className="legend-shape legend-shape-infra" /> Infrastructure
                </div>
              </div>
            )}

            {/* Statistiques du graphe dans le panneau latéral */}
            {graphStats && (
              <div className="graph-stats-panel">
                <h4 className="detail-label">Statistiques du graphe</h4>
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-value">{graphStats.serviceCount}</span>
                    <span className="stat-label">Services</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{graphStats.appCount}</span>
                    <span className="stat-label">Applications</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{graphStats.infraCount}</span>
                    <span className="stat-label">Infra</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{graphStats.totalEdges}</span>
                    <span className="stat-label">Connexions</span>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>

        <div className="graph-footer-info muted small">
          <strong>Cytoscape.js</strong> — Moteur de visualisation de graphes.
          Rectangles = services, ellipses = applications, hexagones = infrastructure.
          Couleurs = niveau de criticité. Le mode essentiel masque les nœuds secondaires.
        </div>
      </SectionLayout>
    </section>
  );
}

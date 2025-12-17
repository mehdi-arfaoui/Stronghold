import { useEffect, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphApiResponse } from "../types";
import { apiFetch } from "../utils/api";

interface GraphSectionProps {
  configVersion: number;
}

export function GraphSection({ configVersion }: GraphSectionProps) {
  const [data, setData] = useState<{ nodes: any[]; links: any[] }>({
    nodes: [],
    links: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const graph: GraphApiResponse = await apiFetch("/graph");

        const nodes = graph.nodes.map((node) => ({
          id: node.id,
          name: node.label,
          type: node.type,
          criticality: node.criticality,
          rtoHours: node.rtoHours,
          rpoMinutes: node.rpoMinutes,
          mtpdHours: node.mtpdHours,
        }));

        const links = graph.edges.map((edge) => ({
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: edge.type,
        }));

        setData({ nodes, links });
      } catch (err: any) {
        setError(err.message || "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    };

    fetchGraph();
  }, [configVersion]);

  if (loading) return <div className="skeleton">Chargement du graphe...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  return (
    <section id="graph-panel" className="panel" aria-labelledby="graph-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Dépendances</p>
          <h2 id="graph-title">Graphe des dépendances</h2>
          <p className="muted">
            Visualisation des relations entre services (les flèches vont du service dépendant vers le service dont il dépend).
          </p>
        </div>
      </div>

      <div className="card graph-card">
        <ForceGraph2D
          graphData={data}
          nodeLabel={(node: any) =>
            `${node.name}\nType: ${node.type}\nCriticité: ${node.criticality}\nRTO: ${
              node.rtoHours ?? "-"
            }h / RPO: ${node.rpoMinutes ?? "-"} min`
          }
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const label = node.name as string;
            const fontSize = 12 / globalScale;
            const radius = 6;

            let color = "#6b7280";
            if (node.criticality === "high") color = "#ef4444";
            else if (node.criticality === "medium") color = "#f59e0b";
            else if (node.criticality === "low") color = "#10b981";

            ctx.beginPath();
            ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI, false);
            ctx.fillStyle = color;
            ctx.fill();

            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = "#111827";
            ctx.fillText(label, node.x!, node.y! + radius + 2);
          }}
          linkDirectionalArrowLength={6}
          linkDirectionalArrowRelPos={1}
          linkLabel={(link: any) => link.type}
        />
      </div>
    </section>
  );
}

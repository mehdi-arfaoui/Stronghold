import { useEffect, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

/* ==== Config env ==== */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;
const API_KEY = import.meta.env.VITE_API_KEY as string;

/* ==== Helper API ==== */

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} – ${text}`);
  }
  return res.json();
}

/* ==== Types backend existants ==== */

type Continuity = {
  rtoHours: number;
  rpoMinutes: number;
  mtpdHours: number;
  notes: string | null;
};

type InfraLink = {
  infra: {
    name: string;
    type: string;
    provider: string | null;
    location: string | null;
  };
};

type Service = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  criticality: string;
  recoveryPriority: number | null;
  domain?: string | null;         
  continuity: Continuity | null;
  infraLinks: InfraLink[];
};



type AppWarning = {
  type: string;
  service: string;
  dependsOn: string;
  message: string;
};

type InfraFinding = {
  type: string;
  infra: string;
  infraType: string;
  location?: string | null;
  message: string;
};

/* ==== Types pour /graph ==== */

type GraphNode = {
  id: string;
  label: string;
  type: string;
  criticality: string;
  rtoHours: number | null;
  rpoMinutes: number | null;
  mtpdHours: number | null;
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: string;
};

type GraphApiResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/* ==== Types infra ==== */

type InfraComponent = {
  id: string;
  name: string;
  type: string;
  provider: string | null;
  location: string | null;
  criticality: string | null;
  isSingleAz: boolean;
  notes: string | null;
  services?: {
    service: {
      id: string;
      name: string;
      criticality: string;
    };
  }[];
};

/* ==== Types scénarios / runbooks ==== */

type ScenarioServiceLinkFront = {
  service: {
    id: string;
    name: string;
    criticality: string;
  };
};

type RunbookStepFront = {
  id: string;
  order: number;
  title: string;
  description: string | null;
  estimatedDurationMinutes: number | null;
  role: string | null;
  blocking: boolean;
};

type ScenarioFront = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  impactLevel: string | null;
  rtoTargetHours: number | null;
  services: ScenarioServiceLinkFront[];
  steps: RunbookStepFront[];
};

type Tab = "services" | "analysis" | "graph" | "landing" | "scenarios";
const SERVICE_DOMAINS = [
  { value: "APP", label: "Application", icon: "🟦" },
  { value: "DB", label: "Base de données", icon: "🗄️" },
  { value: "NETWORK", label: "Réseau", icon: "🌐" },
  { value: "SECURITY", label: "Sécurité", icon: "🛡️" },
  { value: "IAC", label: "IaC", icon: "🧱" },
  { value: "GOV", label: "Gouvernance", icon: "⚖️" },
  { value: "SAAS", label: "SaaS", icon: "☁️" },
  { value: "DATA", label: "Data / ETL", icon: "📊" },
] as const;

const domainMetaByValue: Record<
  string,
  { value: string; label: string; icon: string }
> = SERVICE_DOMAINS.reduce((acc, d) => {
  acc[d.value] = d;
  return acc;
}, {} as any);

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("services");

  return (
    <div style={{ padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1>Stronghold PRA/PCA</h1>
      <p style={{ marginBottom: 16 }}>
        Noyau PRA/PCA multi-tenant : services, Landing Zone, scénarios & runbooks, analyses et graphe.
      </p>

      {/* Onglets */}
      <div
        style={{
          marginBottom: 20,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setActiveTab("services")}
          style={activeTab === "services" ? btnActive : btn}
        >
          Services
        </button>
        <button
          onClick={() => setActiveTab("analysis")}
          style={activeTab === "analysis" ? btnActive : btn}
        >
          Analyse PRA
        </button>
        <button
          onClick={() => setActiveTab("graph")}
          style={activeTab === "graph" ? btnActive : btn}
        >
          Graphe des dépendances
        </button>
        <button
          onClick={() => setActiveTab("landing")}
          style={activeTab === "landing" ? btnActive : btn}
        >
          Landing Zone / Infra
        </button>
        <button
          onClick={() => setActiveTab("scenarios")}
          style={activeTab === "scenarios" ? btnActive : btn}
        >
          Scénarios PRA & Runbooks
        </button>
      </div>

      {activeTab === "services" && <ServicesView />}
      {activeTab === "analysis" && <AnalysisView />}
      {activeTab === "graph" && <GraphView />}
      {activeTab === "landing" && <LandingZoneView />}
      {activeTab === "scenarios" && <ScenariosView />}
    </div>
  );
}

/* === VUE SERVICES === */

function ServicesView() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newService, setNewService] = useState({
    name: "",
    type: "app",
    criticality: "medium",
    recoveryPriority: 2,
    rtoHours: 4,
    rpoMinutes: 60,
    mtpdHours: 24,
    domain: "APP",
  });

  const loadServices = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch("/services");
      setServices(data);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/services", {
        method: "POST",
        body: JSON.stringify({
          name: newService.name,
          type: newService.type,
          criticality: newService.criticality,
          recoveryPriority: newService.recoveryPriority,
          rtoHours: newService.rtoHours,
          rpoMinutes: newService.rpoMinutes,
          mtpdHours: newService.mtpdHours,
          description: "",
          notes: "",
          domain: newService.domain,
        }),
      });
      await loadServices();
      setNewService({
        name: "",
        type: "app",
        criticality: "medium",
        recoveryPriority: 2,
        rtoHours: 4,
        rpoMinutes: 60,
        mtpdHours: 24,
        domain: "APP",
      });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div>Chargement des services...</div>;

  if (error) {
    return (
      <div style={{ color: "red" }}>
        Erreur lors du chargement des services : {error}
      </div>
    );
  }

  return (
    <div>
      <h2>Catalogue des services</h2>
      <p>Vue consolidée des services, priorités PRA et rattachements à la Landing Zone.</p>

      {/* Formulaire de création */}
      <form
        onSubmit={handleCreate}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 8,
          alignItems: "end",
          marginTop: 16,
          marginBottom: 24,
          border: "1px solid #e5e7eb",
          padding: 12,
          borderRadius: 8,
        }}
      >
      <div>
        <label>Domaine</label>
        <select
            value={newService.domain}
            onChange={(e) =>
              setNewService((s) => ({ ...s, domain: e.target.value }))
            }
            style={input}
          >
            {SERVICE_DOMAINS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.icon} {d.label}
              </option>
            ))}
            </select>
         </div>

        <div>
          <label>Nom</label>
          <input
            type="text"
            value={newService.name}
            onChange={(e) =>
              setNewService((s) => ({ ...s, name: e.target.value }))
            }
            required
            style={input}
          />
        </div>
        <div>
          <label>Type</label>
          <select
            value={newService.type}
            onChange={(e) =>
              setNewService((s) => ({ ...s, type: e.target.value }))
            }
            style={input}
          >
            <option value="app">app</option>
            <option value="db">db</option>
            <option value="infra">infra</option>
            <option value="network">network</option>
            <option value="cloud">cloud</option>
          </select>
        </div>
        <div>
          <label>Criticité</label>
          <select
            value={newService.criticality}
            onChange={(e) =>
              setNewService((s) => ({ ...s, criticality: e.target.value }))
            }
            style={input}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
        <div>
          <label>Priorité (1–5)</label>
          <input
            type="number"
            min={1}
            max={5}
            value={newService.recoveryPriority}
            onChange={(e) =>
              setNewService((s) => ({
                ...s,
                recoveryPriority: Number(e.target.value),
              }))
            }
            style={input}
          />
        </div>
        <div>
          <label>RTO (h)</label>
          <input
            type="number"
            min={0}
            value={newService.rtoHours}
            onChange={(e) =>
              setNewService((s) => ({
                ...s,
                rtoHours: Number(e.target.value),
              }))
            }
            style={input}
          />
        </div>
        <div>
          <label>RPO (min)</label>
          <input
            type="number"
            min={0}
            value={newService.rpoMinutes}
            onChange={(e) =>
              setNewService((s) => ({
                ...s,
                rpoMinutes: Number(e.target.value),
              }))
            }
            style={input}
          />
        </div>
        <div>
          <label>MTPD (h)</label>
          <input
            type="number"
            min={0}
            value={newService.mtpdHours}
            onChange={(e) =>
              setNewService((s) => ({
                ...s,
                mtpdHours: Number(e.target.value),
              }))
            }
            style={input}
          />
        </div>
        <div>
          <button type="submit" disabled={creating} style={btnPrimary}>
            {creating ? "Création..." : "Ajouter le service"}
          </button>
          {createError && (
            <div style={{ color: "red", marginTop: 4 }}>{createError}</div>
          )}
        </div>
      </form>

      {/* Tableau */}
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Service</th>
            <th style={th}>Domaine</th>
            <th style={th}>Type</th>
            <th style={th}>Criticité</th>
            <th style={th}>Priorité</th>
            <th style={th}>RTO (h)</th>
            <th style={th}>RPO (min)</th>
            <th style={th}>MTPD (h)</th>
            <th style={th}>Infra (LZ)</th>
          </tr>
        </thead>
        <tbody>
        {services.map((s) => {
  const infraNames =
    s.infraLinks?.map((l) => l.infra.name).join(", ") || "-";

  const domainMeta = s.domain ? domainMetaByValue[s.domain] : null;

  return (
    <tr key={s.id}>
      <td style={td}>
        {domainMeta ? (
          <>
            <span style={{ marginRight: 4 }}>{domainMeta.icon}</span>
            {s.name}
          </>
        ) : (
          s.name
        )}
      </td>
      <td style={td}>
        {domainMeta ? domainMeta.label : "-"}
      </td>
      <td style={td}>{s.type}</td>
      <td style={td}>{s.criticality}</td>
      <td style={td}>{s.recoveryPriority ?? "-"}</td>
      <td style={td}>{s.continuity?.rtoHours ?? "-"}</td>
      <td style={td}>{s.continuity?.rpoMinutes ?? "-"}</td>
      <td style={td}>{s.continuity?.mtpdHours ?? "-"}</td>
      <td style={td}>{infraNames}</td>
    </tr>
  );
})}

        </tbody>
      </table>
    </div>
  );
}

/* === VUE ANALYSE PRA === */

function AnalysisView() {
  const [appWarnings, setAppWarnings] = useState<AppWarning[]>([]);
  const [infraFindings, setInfraFindings] = useState<InfraFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const [appData, infraData] = await Promise.all([
          apiFetch("/analysis/basic"),
          apiFetch("/analysis/infra-basic"),
        ]);

        setAppWarnings(appData);
        setInfraFindings(infraData);
      } catch (err: any) {
        setError(err.message || "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    };

    fetchAnalysis();
  }, []);

  if (loading) return <div>Analyse en cours...</div>;

  if (error) {
    return (
      <div style={{ color: "red" }}>
        Erreur lors du chargement de l&apos;analyse : {error}
      </div>
    );
  }

  return (
    <div>
      <h2>Analyse PRA</h2>
      <p>
        Synthèse des incohérences RTO/RPO/criticité et des points de risque Landing Zone pour ce tenant.
      </p>

      <section style={{ marginTop: 24 }}>
        <h3>Analyse applicative</h3>
        {appWarnings.length === 0 ? (
          <p>Aucune incohérence applicative détectée.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Type</th>
                <th style={th}>Service</th>
                <th style={th}>Dépend de</th>
                <th style={th}>Message</th>
              </tr>
            </thead>
            <tbody>
              {appWarnings.map((w, idx) => (
                <tr key={idx}>
                  <td style={td}>{w.type}</td>
                  <td style={td}>{w.service}</td>
                  <td style={td}>{w.dependsOn}</td>
                  <td style={td}>{w.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h3>Analyse infrastructure / Landing Zone</h3>
        {infraFindings.length === 0 ? (
          <p>Aucun point particulier détecté sur l&apos;infra.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Type</th>
                <th style={th}>Composant</th>
                <th style={th}>Type LZ</th>
                <th style={th}>Localisation</th>
                <th style={th}>Message</th>
              </tr>
            </thead>
            <tbody>
              {infraFindings.map((f, idx) => (
                <tr key={idx}>
                  <td style={td}>{f.type}</td>
                  <td style={td}>{f.infra}</td>
                  <td style={td}>{f.infraType}</td>
                  <td style={td}>{f.location ?? "-"}</td>
                  <td style={td}>{f.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* === VUE GRAPHE === */

function GraphView() {
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

        const nodes = graph.nodes.map((n) => ({
          id: n.id,
          name: n.label,
          type: n.type,
          criticality: n.criticality,
          rtoHours: n.rtoHours,
          rpoMinutes: n.rpoMinutes,
          mtpdHours: n.mtpdHours,
        }));

        const links = graph.edges.map((e) => ({
          id: e.id,
          source: e.from,
          target: e.to,
          type: e.type,
        }));

        setData({ nodes, links });
      } catch (err: any) {
        setError(err.message || "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    };

    fetchGraph();
  }, []);

  if (loading) return <div>Chargement du graphe...</div>;

  if (error) {
    return (
      <div style={{ color: "red" }}>
        Erreur lors du chargement du graphe : {error}
      </div>
    );
  }

  return (
    <div>
      <h2>Graphe des dépendances</h2>
      <p>
        Visualisation des relations entre services (les flèches vont du service dépendant vers le service dont il dépend).
      </p>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          marginTop: 12,
          height: "600px",
        }}
      >
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
    </div>
  );
}

/* === VUE LANDING ZONE / INFRA === */

function LandingZoneView() {
  const [components, setComponents] = useState<InfraComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newInfra, setNewInfra] = useState({
    name: "",
    type: "vpc",
    provider: "aws",
    location: "eu-west-3",
    criticality: "high",
    isSingleAz: false,
    notes: "",
  });

  const loadInfra = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch("/infra/components");
      setComponents(data);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInfra();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/infra/components", {
        method: "POST",
        body: JSON.stringify({
          name: newInfra.name,
          type: newInfra.type,
          provider: newInfra.provider,
          location: newInfra.location,
          criticality: newInfra.criticality,
          isSingleAz: newInfra.isSingleAz,
          notes: newInfra.notes,
        }),
      });
      await loadInfra();
      setNewInfra({
        name: "",
        type: "vpc",
        provider: "aws",
        location: "eu-west-3",
        criticality: "high",
        isSingleAz: false,
        notes: "",
      });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div>Chargement des composants d&apos;infra...</div>;

  if (error) {
    return (
      <div style={{ color: "red" }}>
        Erreur lors du chargement de l&apos;infra : {error}
      </div>
    );
  }

  return (
    <div>
      <h2>Landing Zone / Infrastructure</h2>
      <p>
        Modélisation des composants d&apos;infra (VPC, subnets, zones, comptes...) et services hébergés.
      </p>

      {/* Formulaire de création */}
      <form
        onSubmit={handleCreate}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 8,
          alignItems: "end",
          marginTop: 16,
          marginBottom: 24,
          border: "1px solid #e5e7eb",
          padding: 12,
          borderRadius: 8,
        }}
      >
        <div>
          <label>Nom</label>
          <input
            type="text"
            value={newInfra.name}
            onChange={(e) =>
              setNewInfra((s) => ({ ...s, name: e.target.value }))
            }
            required
            style={input}
          />
        </div>
        <div>
          <label>Type</label>
          <select
            value={newInfra.type}
            onChange={(e) =>
              setNewInfra((s) => ({ ...s, type: e.target.value }))
            }
            style={input}
          >
            <option value="vpc">vpc</option>
            <option value="subnet">subnet</option>
            <option value="az">az</option>
            <option value="region">region</option>
            <option value="account">account</option>
            <option value="firewall">firewall</option>
            <option value="natgw">natgw</option>
            <option value="bastion">bastion</option>
          </select>
        </div>
        <div>
          <label>Provider</label>
          <select
            value={newInfra.provider}
            onChange={(e) =>
              setNewInfra((s) => ({ ...s, provider: e.target.value }))
            }
            style={input}
          >
            <option value="aws">aws</option>
            <option value="azure">azure</option>
            <option value="gcp">gcp</option>
            <option value="onprem">onprem</option>
          </select>
        </div>
        <div>
          <label>Localisation</label>
          <input
            type="text"
            value={newInfra.location}
            onChange={(e) =>
              setNewInfra((s) => ({ ...s, location: e.target.value }))
            }
            style={input}
          />
        </div>
        <div>
          <label>Criticité</label>
          <select
            value={newInfra.criticality}
            onChange={(e) =>
              setNewInfra((s) => ({ ...s, criticality: e.target.value }))
            }
            style={input}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
        <div>
          <label>Single-AZ ?</label>
          <input
            type="checkbox"
            checked={newInfra.isSingleAz}
            onChange={(e) =>
              setNewInfra((s) => ({ ...s, isSingleAz: e.target.checked }))
            }
          />
        </div>
        <div>
          <label>Notes</label>
          <input
            type="text"
            value={newInfra.notes}
            onChange={(e) =>
              setNewInfra((s) => ({ ...s, notes: e.target.value }))
            }
            style={input}
          />
        </div>
        <div>
          <button type="submit" disabled={creating} style={btnPrimary}>
            {creating ? "Création..." : "Ajouter le composant"}
          </button>
          {createError && (
            <div style={{ color: "red", marginTop: 4 }}>{createError}</div>
          )}
        </div>
      </form>

      {/* Tableau des composants */}
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Nom</th>
            <th style={th}>Type</th>
            <th style={th}>Provider</th>
            <th style={th}>Localisation</th>
            <th style={th}>Criticité</th>
            <th style={th}>Single AZ</th>
            <th style={th}># Services</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => {
            const count = c.services?.length ?? 0;
            return (
              <tr key={c.id}>
                <td style={td}>{c.name}</td>
                <td style={td}>{c.type}</td>
                <td style={td}>{c.provider ?? "-"}</td>
                <td style={td}>{c.location ?? "-"}</td>
                <td style={td}>{c.criticality ?? "-"}</td>
                <td style={td}>{c.isSingleAz ? "Oui" : "Non"}</td>
                <td style={td}>{count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* === VUE SCÉNARIOS PRA & RUNBOOKS === */

function ScenariosView() {
  const [scenarios, setScenarios] = useState<ScenarioFront[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newScenario, setNewScenario] = useState({
    name: "",
    type: "REGION_LOSS",
    impactLevel: "high",
    rtoTargetHours: 24,
    selectedServiceIds: [] as string[],
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [scData, svcData] = await Promise.all([
        apiFetch("/scenarios"),
        apiFetch("/services"),
      ]);
      setScenarios(scData);
      setServices(svcData);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleServiceSelection = (id: string) => {
    setNewScenario((prev) => {
      const exists = prev.selectedServiceIds.includes(id);
      return {
        ...prev,
        selectedServiceIds: exists
          ? prev.selectedServiceIds.filter((s) => s !== id)
          : [...prev.selectedServiceIds, id],
      };
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/scenarios", {
        method: "POST",
        body: JSON.stringify({
          name: newScenario.name,
          type: newScenario.type,
          impactLevel: newScenario.impactLevel,
          rtoTargetHours: newScenario.rtoTargetHours,
          serviceIds: newScenario.selectedServiceIds,
          description: "",
        }),
      });
      await loadData();
      setNewScenario({
        name: "",
        type: "REGION_LOSS",
        impactLevel: "high",
        rtoTargetHours: 24,
        selectedServiceIds: [],
      });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div>Chargement des scénarios...</div>;

  if (error) {
    return (
      <div style={{ color: "red" }}>
        Erreur lors du chargement des scénarios : {error}
      </div>
    );
  }

  return (
    <div>
      <h2>Scénarios PRA & Runbooks</h2>
      <p>
        Modélisation des scénarios de sinistre (perte AZ, région, corruption DB, perte AD...) et des étapes de reprise.
      </p>

      {/* Formulaire de création de scénario */}
      <form
        onSubmit={handleCreate}
        style={{
          marginTop: 16,
          marginBottom: 24,
          border: "1px solid #e5e7eb",
          padding: 12,
          borderRadius: 8,
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
          alignItems: "start",
        }}
      >
        <div>
          <label>Nom du scénario</label>
          <input
            type="text"
            value={newScenario.name}
            onChange={(e) =>
              setNewScenario((s) => ({ ...s, name: e.target.value }))
            }
            required
            style={input}
          />
        </div>
        <div>
          <label>Type</label>
          <select
            value={newScenario.type}
            onChange={(e) =>
              setNewScenario((s) => ({ ...s, type: e.target.value }))
            }
            style={input}
          >
            <option value="REGION_LOSS">Perte région</option>
            <option value="AZ_LOSS">Perte AZ</option>
            <option value="DC_LOSS">Perte DC on-prem</option>
            <option value="DB_CORRUPTION">Corruption base de données</option>
            <option value="RANSOMWARE">Ransomware</option>
            <option value="AD_FAILURE">Perte Active Directory</option>
          </select>
        </div>
        <div>
          <label>Impact</label>
          <select
            value={newScenario.impactLevel}
            onChange={(e) =>
              setNewScenario((s) => ({ ...s, impactLevel: e.target.value }))
            }
            style={input}
          >
            <option value="low">Faible</option>
            <option value="medium">Moyen</option>
            <option value="high">Fort</option>
          </select>
        </div>
        <div>
          <label>RTO cible global (h)</label>
          <input
            type="number"
            min={0}
            value={newScenario.rtoTargetHours}
            onChange={(e) =>
              setNewScenario((s) => ({
                ...s,
                rtoTargetHours: Number(e.target.value),
              }))
            }
            style={input}
          />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label>Services impactés</label>
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: 8,
              maxHeight: 140,
              overflowY: "auto",
              fontSize: 13,
            }}
          >
            {services.length === 0 ? (
              <div style={{ fontStyle: "italic" }}>
                Aucun service défini pour ce tenant.
              </div>
            ) : (
              services.map((svc) => (
                <label
                  key={svc.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginBottom: 4,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={newScenario.selectedServiceIds.includes(svc.id)}
                    onChange={() => toggleServiceSelection(svc.id)}
                  />
                  <span>
                    {svc.name}{" "}
                    <span style={{ color: "#6b7280" }}>
                      ({svc.type}, {svc.criticality})
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
        <div style={{ gridColumn: "span 3" }}>
          <button type="submit" disabled={creating} style={btnPrimary}>
            {creating ? "Création..." : "Créer le scénario"}
          </button>
          {createError && (
            <div style={{ color: "red", marginTop: 4 }}>{createError}</div>
          )}
        </div>
      </form>

      {/* Liste des scénarios */}
      {scenarios.length === 0 ? (
        <p>Aucun scénario défini pour le moment.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {scenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              onUpdated={loadData}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioCard({
  scenario,
  onUpdated,
}: {
  scenario: ScenarioFront;
  onUpdated: () => void;
}) {
  const [addingStep, setAddingStep] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [newStep, setNewStep] = useState({
    order: (scenario.steps?.length || 0) + 1,
    title: "",
    estimatedDurationMinutes: 30,
    role: "",
    blocking: false,
    description: "",
  });

  const totalDuration = scenario.steps.reduce(
    (sum, s) => sum + (s.estimatedDurationMinutes ?? 0),
    0
  );

  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingStep(true);
    setStepError(null);
    try {
      await apiFetch(`/scenarios/${scenario.id}/steps`, {
        method: "POST",
        body: JSON.stringify({
          order: newStep.order,
          title: newStep.title,
          estimatedDurationMinutes: newStep.estimatedDurationMinutes,
          role: newStep.role,
          blocking: newStep.blocking,
          description: newStep.description,
        }),
      });
      await onUpdated();
      setNewStep({
        order: (scenario.steps?.length || 0) + 2,
        title: "",
        estimatedDurationMinutes: 30,
        role: "",
        blocking: false,
        description: "",
      });
    } catch (err: any) {
      setStepError(err.message || "Erreur lors de l'ajout de l'étape");
    } finally {
      setAddingStep(false);
    }
  };

  const impactLabel =
    scenario.impactLevel === "high"
      ? "Fort"
      : scenario.impactLevel === "medium"
      ? "Moyen"
      : scenario.impactLevel === "low"
      ? "Faible"
      : "-";

  const impactColor =
    scenario.impactLevel === "high"
      ? "#b91c1c"
      : scenario.impactLevel === "medium"
      ? "#b45309"
      : scenario.impactLevel === "low"
      ? "#15803d"
      : "#6b7280";

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>{scenario.name}</div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            Type : {scenario.type} • Impact :{" "}
            <span style={{ color: impactColor }}>{impactLabel}</span>{" "}
            {scenario.rtoTargetHours != null && (
              <>• RTO cible : {scenario.rtoTargetHours} h</>
            )}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Services impactés :{" "}
            {scenario.services.length === 0
              ? "aucun"
              : scenario.services
                  .map((s) => `${s.service.name} (${s.service.criticality})`)
                  .join(", ")}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 13 }}>
          <div>Étapes : {scenario.steps.length}</div>
          <div>Durée estimée : ~{totalDuration} min</div>
        </div>
      </div>

      {/* Tableau des étapes */}
      <div style={{ marginTop: 12 }}>
        {scenario.steps.length === 0 ? (
          <div style={{ fontSize: 13, fontStyle: "italic" }}>
            Aucune étape définie pour ce scénario.
          </div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Ordre</th>
                <th style={th}>Étape</th>
                <th style={th}>Rôle</th>
                <th style={th}>Durée (min)</th>
                <th style={th}>Bloquant</th>
              </tr>
            </thead>
            <tbody>
              {scenario.steps.map((step) => (
                <tr key={step.id}>
                  <td style={td}>{step.order}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{step.title}</div>
                    {step.description && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          marginTop: 2,
                        }}
                      >
                        {step.description}
                      </div>
                    )}
                  </td>
                  <td style={td}>{step.role ?? "-"}</td>
                  <td style={td}>
                    {step.estimatedDurationMinutes ?? "-"}
                  </td>
                  <td style={td}>{step.blocking ? "Oui" : "Non"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Formulaire d'ajout d'étape */}
      <form
        onSubmit={handleAddStep}
        style={{
          marginTop: 12,
          borderTop: "1px solid #e5e7eb",
          paddingTop: 8,
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 8,
          alignItems: "end",
        }}
      >
        <div>
          <label>Ordre</label>
          <input
            type="number"
            min={1}
            value={newStep.order}
            onChange={(e) =>
              setNewStep((s) => ({
                ...s,
                order: Number(e.target.value),
              }))
            }
            style={input}
          />
        </div>
        <div>
          <label>Titre de l&apos;étape</label>
          <input
            type="text"
            value={newStep.title}
            onChange={(e) =>
              setNewStep((s) => ({ ...s, title: e.target.value }))
            }
            required
            style={input}
          />
        </div>
        <div>
          <label>Rôle</label>
          <input
            type="text"
            value={newStep.role}
            onChange={(e) =>
              setNewStep((s) => ({ ...s, role: e.target.value }))
            }
            style={input}
          />
        </div>
        <div>
          <label>Durée estimée (min)</label>
          <input
            type="number"
            min={0}
            value={newStep.estimatedDurationMinutes}
            onChange={(e) =>
              setNewStep((s) => ({
                ...s,
                estimatedDurationMinutes: Number(e.target.value),
              }))
            }
            style={input}
          />
        </div>
        <div>
          <label>Bloquant ?</label>
          <input
            type="checkbox"
            checked={newStep.blocking}
            onChange={(e) =>
              setNewStep((s) => ({ ...s, blocking: e.target.checked }))
            }
          />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label>Description</label>
          <input
            type="text"
            value={newStep.description}
            onChange={(e) =>
              setNewStep((s) => ({ ...s, description: e.target.value }))
            }
            style={input}
          />
        </div>
        <div>
          <button type="submit" disabled={addingStep} style={btn}>
            {addingStep ? "Ajout..." : "Ajouter l'étape"}
          </button>
          {stepError && (
            <div style={{ color: "red", fontSize: 12, marginTop: 2 }}>
              {stepError}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

/* === Styles === */

const table: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  marginTop: 12,
  fontSize: 14,
};

const th: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: "8px",
  backgroundColor: "#f3f4f6",
  textAlign: "left",
};

const td: React.CSSProperties = {
  border: "1px solid #eee",
  padding: "8px",
};

const btn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid #ddd",
  backgroundColor: "#fff",
  cursor: "pointer",
};

const btnActive: React.CSSProperties = {
  ...btn,
  backgroundColor: "#2563eb",
  color: "#fff",
  borderColor: "#2563eb",
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  backgroundColor: "#2563eb",
  color: "#fff",
  borderColor: "#2563eb",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 4,
  border: "1px solid #d1d5db",
  fontSize: 13,
};

export default App;

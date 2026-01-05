import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import { apiFetch } from "../utils/api";

interface AuditLogsSectionProps {
  configVersion: number;
}

type AuditLog = {
  id: string;
  apiKeyId: string | null;
  path: string;
  method: string;
  statusCode: number;
  success: boolean;
  errorCode: string | null;
  latencyMs: number | null;
  clientIp: string | null;
  userAgent: string | null;
  correlationId: string | null;
  createdAt: string;
};

type AuditLogsResponse = {
  limit: number;
  count: number;
  logs: AuditLog[];
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatLatency(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return `${value} ms`;
}

export function AuditLogsSection({ configVersion }: AuditLogsSectionProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [path, setPath] = useState("");

  const loadLogs = async (filters?: { date?: string; statusCode?: string; path?: string }) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters?.date) params.set("date", filters.date);
      if (filters?.statusCode) params.set("statusCode", filters.statusCode);
      if (filters?.path) params.set("path", filters.path);

      const query = params.toString();
      const response: AuditLogsResponse = await apiFetch(`/audit-logs${query ? `?${query}` : ""}`);
      setLogs(response.logs ?? []);
    } catch (err: any) {
      setError(err.message || "Erreur lors du chargement des journaux");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [configVersion]);

  const handleFilter = async (event: FormEvent) => {
    event.preventDefault();
    await loadLogs({
      date: date || undefined,
      statusCode: statusCode || undefined,
      path: path || undefined,
    });
  };

  const handleReset = async () => {
    setDate("");
    setStatusCode("");
    setPath("");
    await loadLogs();
  };

  const rows = useMemo(() => {
    return logs.map((log) => ({
      ...log,
      statusLabel: log.success ? "Succès" : "Erreur",
    }));
  }, [logs]);

  if (loading) return <div className="skeleton">Chargement de l'historique...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  const progressSteps = [
    logs.length > 0,
    Boolean(date || statusCode || path),
    logs.some((log) => !log.success),
  ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <section id="audit-logs" className="panel" aria-labelledby="audit-logs-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Audit</p>
          <h2 id="audit-logs-title">Historique des appels API</h2>
          <p className="muted">
            Consultez les requêtes API des dernières opérations (filtrage par date, statut ou chemin).
          </p>
        </div>
        <div className="badge subtle">ADMIN only</div>
      </div>

      <PageIntro
        title="Suivre l'audit API"
        objective="Inspecter les appels API pour tracer les erreurs, mesurer les latences et vérifier la conformité."
        steps={[
          "Appliquer des filtres ciblés",
          "Analyser les statuts et latences",
          "Exporter ou corriger les anomalies",
        ]}
        tips={[
          "Filtrez par statut pour isoler les erreurs 4xx/5xx.",
          "Utilisez l'ID de corrélation pour relier plusieurs appels.",
          "Surveillez les latences élevées pour détecter les goulots.",
        ]}
        links={[
          { label: "Filtrer les logs", href: "#audit-filters", description: "Formulaire" },
          { label: "Consulter les résultats", href: "#audit-results", description: "Table" },
          { label: "Réinitialiser", href: "#audit-filters", description: "Reset" },
        ]}
        expectedData={[
          "Date, statut HTTP ou chemin",
          "Corrélation et identifiant de clé",
          "Latence et statut de succès",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <form id="audit-filters" className="card form-grid" onSubmit={handleFilter}>
        <div className="card-header" style={{ gridColumn: "1 / -1" }}>
          <div>
            <p className="eyebrow">Filtres</p>
            <h3>Filtrer l'historique</h3>
          </div>
        </div>

        <label className="form-field">
          <span>Date (YYYY-MM-DD)</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <p className="helper">Filtre la journée complète.</p>
        </label>

        <label className="form-field">
          <span>Code HTTP</span>
          <input
            type="number"
            value={statusCode}
            onChange={(event) => setStatusCode(event.target.value)}
            placeholder="200"
            min={100}
            max={599}
          />
        </label>

        <label className="form-field">
          <span>Chemin</span>
          <input
            type="text"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/services"
          />
        </label>

        <div className="form-field" style={{ gridColumn: "1 / -1", display: "flex", gap: "0.75rem" }}>
          <button className="button primary" type="submit">
            Appliquer les filtres
          </button>
          <button className="button" type="button" onClick={handleReset}>
            Réinitialiser
          </button>
        </div>
      </form>

      <div id="audit-results" className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <div>
            <p className="eyebrow">Résultats</p>
            <h3>Derniers appels</h3>
          </div>
          <div className="badge subtle">{rows.length} entrées</div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Statut</th>
                <th>Méthode</th>
                <th>Chemin</th>
                <th>Latence</th>
                <th>API Key</th>
                <th>Corrélation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>
                    <div>
                      <span className={`badge ${log.success ? "success" : "error"}`}>
                        {log.statusCode}
                      </span>
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {log.statusLabel}
                      </div>
                    </div>
                  </td>
                  <td>{log.method}</td>
                  <td>{log.path}</td>
                  <td>{formatLatency(log.latencyMs)}</td>
                  <td>{log.apiKeyId ?? "-"}</td>
                  <td>{log.correlationId ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <div className="empty-state" style={{ marginTop: "1rem" }}>
            Aucune entrée ne correspond aux filtres sélectionnés.
          </div>
        )}
      </div>
    </section>
  );
}

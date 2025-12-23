import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { RunbookFront, ScenarioFront } from "../types";
import { apiDownload, apiFetch } from "../utils/api";

interface RunbooksSectionProps {
  configVersion: number;
}

type TemplateId = "generic" | "scenario" | "audit";

const RUNBOOK_TEMPLATES: Record<
  TemplateId,
  { label: string; summary: string; requiresScenario?: boolean; title: string }
> = {
  generic: {
    label: "Synthèse PRA multi-services",
    title: "Runbook PRA/PCA",
    summary: "Synthèse multi-services incluant dépendances, sauvegardes et recommandations PRA.",
  },
  scenario: {
    label: "Runbook ciblé sur un scénario",
    title: "Runbook scénario prioritaire",
    summary: "Plan d'actions pour un scénario critique, avec étapes et dépendances associées.",
    requiresScenario: true,
  },
  audit: {
    label: "Template audit / rapport PRA",
    title: "Rapport PRA & runbooks",
    summary: "Mettre en avant les sauvegardes, politiques et dépendances détectées pour audit.",
  },
};

export function RunbooksSection({ configVersion }: RunbooksSectionProps) {
  const [runbooks, setRunbooks] = useState<RunbookFront[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioFront[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("generic");
  const [scenarioId, setScenarioId] = useState<string>("");
  const [title, setTitle] = useState(RUNBOOK_TEMPLATES.generic.title);
  const [summary, setSummary] = useState(RUNBOOK_TEMPLATES.generic.summary);
  const [owner, setOwner] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [runbookData, scenarioData] = await Promise.all([
        apiFetch("/runbooks"),
        apiFetch("/scenarios"),
      ]);
      setRunbooks(runbookData);
      setScenarios(scenarioData);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [configVersion]);

  const scenarioMap = useMemo(() => {
    const map = new Map<string, ScenarioFront>();
    scenarios.forEach((s) => map.set(s.id, s));
    return map;
  }, [scenarios]);

  const handleTemplateChange = (templateId: TemplateId) => {
    setSelectedTemplate(templateId);
    setTitle(RUNBOOK_TEMPLATES[templateId].title);
    setSummary(RUNBOOK_TEMPLATES[templateId].summary);
  };

  const handleGenerate = async (event: FormEvent) => {
    event.preventDefault();
    setGenerating(true);
    setGenerationError(null);

    const template = RUNBOOK_TEMPLATES[selectedTemplate];
    if (template.requiresScenario && !scenarioId) {
      setGenerationError("Sélectionnez un scénario pour ce template.");
      setGenerating(false);
      return;
    }

    try {
      await apiFetch("/runbooks/generate", {
        method: "POST",
        body: JSON.stringify({
          scenarioId: scenarioId || null,
          title,
          summary,
          owner: owner || undefined,
        }),
      });
      await loadData();
    } catch (err: any) {
      setGenerationError(err.message || "Échec de la génération");
    } finally {
      setGenerating(false);
    }
  };

  const downloadRunbook = async (runbook: RunbookFront, format: "pdf" | "md") => {
    const path = format === "pdf" ? runbook.pdfPath : runbook.markdownPath;
    if (!path) {
      setGenerationError("Aucun fichier disponible pour ce runbook.");
      return;
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const extension = format === "pdf" ? "pdf" : "md";
    try {
      await apiDownload(normalizedPath, `${runbook.title}.${extension}`, "blob");
    } catch (err: any) {
      setGenerationError(err?.message || "Téléchargement impossible");
    }
  };

  const downloadReport = async (format: "text" | "json") => {
    try {
      if (format === "text") {
        await apiDownload("/analysis/report", "rapport-pra.txt", "text");
        return;
      }
      await apiDownload("/analysis/full-report-json", "rapport-pra.json", "json");
    } catch (err: any) {
      setGenerationError(err?.message || "Téléchargement du rapport impossible");
    }
  };

  if (loading) return <div className="skeleton">Chargement des runbooks...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  return (
    <section id="runbooks-panel" className="panel" aria-labelledby="runbooks-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">PRA</p>
          <h2 id="runbooks-title">Runbooks & rapports</h2>
          <p className="muted">
            Génération de runbooks, sélection de templates et téléchargement des rapports PRA (texte ou JSON).
          </p>
        </div>
        <div className="badge subtle">{runbooks.length} runbooks</div>
      </div>

      <div className="panel-grid">
        <form className="card form-grid" onSubmit={handleGenerate}>
          <div className="card-header" style={{ gridColumn: "1 / -1" }}>
            <div>
              <p className="eyebrow">Génération</p>
              <h3>Préparer un runbook</h3>
            </div>
          </div>

          <label className="form-field">
            <span>Template</span>
            <select
              value={selectedTemplate}
              onChange={(e) => handleTemplateChange(e.target.value as TemplateId)}
            >
              {Object.entries(RUNBOOK_TEMPLATES).map(([id, tpl]) => (
                <option key={id} value={id}>
                  {tpl.label}
                </option>
              ))}
            </select>
            <p className="helper">
              {RUNBOOK_TEMPLATES[selectedTemplate].requiresScenario
                ? "Ce template inclut les étapes du scénario sélectionné."
                : "Synthèse générée à partir des services, dépendances, backups et politiques détectées."}
            </p>
          </label>

          <label className="form-field">
            <span>Scénario associé (optionnel)</span>
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              <option value="">Aucun (général)</option>
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name} ({scenario.type})
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Titre</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>

          <label className="form-field">
            <span>Résumé</span>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              required
            />
          </label>

          <label className="form-field">
            <span>Propriétaire / contact</span>
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Ex: equipe.pra@example.com"
            />
          </label>

          <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
            <button className="btn primary" type="submit" disabled={generating}>
              {generating ? "Génération..." : "Générer le runbook"}
            </button>
            {generationError && <p className="helper error">{generationError}</p>}
          </div>
        </form>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Rapports</p>
              <h3>Exports PRA</h3>
            </div>
          </div>
          <div className="stack" style={{ gap: "12px" }}>
            <p className="muted">
              Téléchargez le rapport PRA consolidé ou son équivalent JSON (services, dépendances,
              backups, politiques et recommandations).
            </p>
            <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
              <button className="btn" onClick={() => downloadReport("text")}>
                Rapport texte
              </button>
              <button className="btn" onClick={() => downloadReport("json")}>
                Rapport JSON
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Historique</p>
            <h3>Runbooks générés</h3>
          </div>
        </div>
        {runbooks.length === 0 ? (
          <p className="empty-state">Aucun runbook généré pour ce tenant.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Titre</th>
                  <th>Scénario</th>
                  <th>Statut</th>
                  <th>Généré le</th>
                  <th>Téléchargements</th>
                </tr>
              </thead>
              <tbody>
                {runbooks.map((runbook) => {
                  const scenario = runbook.scenarioId ? scenarioMap.get(runbook.scenarioId) : null;
                  return (
                    <tr key={runbook.id}>
                      <td>
                        <div className="stack">
                          <span className="service-name">{runbook.title}</span>
                          {runbook.summary && <span className="muted small">{runbook.summary}</span>}
                        </div>
                      </td>
                      <td>{scenario ? scenario.name : "Général"}</td>
                      <td>
                        <span className="pill subtle">{runbook.status}</span>
                      </td>
                      <td>{runbook.generatedAt ? new Date(runbook.generatedAt).toLocaleString() : "-"}</td>
                      <td>
                        <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
                          {runbook.pdfPath && (
                            <button className="btn ghost" onClick={() => downloadRunbook(runbook, "pdf")}>
                              PDF
                            </button>
                          )}
                          {runbook.markdownPath && (
                            <button className="btn ghost" onClick={() => downloadRunbook(runbook, "md")}>
                              Markdown
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

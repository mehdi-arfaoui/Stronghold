import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import type { RunbookFront, RunbookTemplateFront, ScenarioFront } from "../types";
import { apiDownload, apiFetch, apiFetchFormData } from "../utils/api";

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
  const [templates, setTemplates] = useState<RunbookTemplateFront[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("generic");
  const [scenarioId, setScenarioId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [selectedTemplateInfo, setSelectedTemplateInfo] = useState<RunbookTemplateFront | null>(
    null
  );
  const [title, setTitle] = useState(RUNBOOK_TEMPLATES.generic.title);
  const [summary, setSummary] = useState(RUNBOOK_TEMPLATES.generic.summary);
  const [owner, setOwner] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateSuccess, setTemplateSuccess] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editTemplateDescription, setEditTemplateDescription] = useState("");
  const [updatingTemplate, setUpdatingTemplate] = useState(false);
  const [templateActionError, setTemplateActionError] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [editingRunbookId, setEditingRunbookId] = useState<string | null>(null);
  const [editRunbook, setEditRunbook] = useState({
    title: "",
    summary: "",
    status: "DRAFT",
  });
  const [updatingRunbook, setUpdatingRunbook] = useState(false);
  const [runbookActionError, setRunbookActionError] = useState<string | null>(null);
  const [deletingRunbookId, setDeletingRunbookId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [runbookData, scenarioData] = await Promise.all([
        apiFetch("/runbooks"),
        apiFetch("/scenarios"),
      ]);
      setRunbooks(runbookData);
      setScenarios(Array.isArray(scenarioData) ? scenarioData : scenarioData.items || []);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      setTemplateLoading(true);
      setTemplateError(null);
      const templateData = await apiFetch("/runbooks/templates");
      setTemplates(templateData);
      if (templateId) {
        const match = templateData.find((tpl: RunbookTemplateFront) => tpl.id === templateId);
        setSelectedTemplateInfo(match || null);
      }
    } catch (err: any) {
      setTemplateError(err.message || "Erreur de chargement des templates");
    } finally {
      setTemplateLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadTemplates();
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
    setTemplateSuccess(null);

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
          templateId: templateId || null,
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

  const downloadReport = async (format: "text" | "json" | "pdf") => {
    try {
      if (format === "text") {
        await apiDownload("/analysis/report", "rapport-pra.txt", "text");
        return;
      }
      if (format === "pdf") {
        await apiDownload("/analysis/report/pdf", "rapport-pra.pdf", "blob");
        return;
      }
      await apiDownload("/analysis/full-report-json", "rapport-pra.json", "json");
    } catch (err: any) {
      setGenerationError(err?.message || "Téléchargement du rapport impossible");
    }
  };

  const handleTemplateSelection = async (nextId: string) => {
    setTemplateId(nextId);
    if (!nextId) {
      setSelectedTemplateInfo(null);
      return;
    }
    try {
      const tpl = await apiFetch(`/runbooks/templates/${nextId}`);
      setSelectedTemplateInfo(tpl);
    } catch (err: any) {
      setSelectedTemplateInfo(null);
      setTemplateError(err.message || "Impossible de récupérer le template");
    }
  };

  const handleTemplateUpload = async (event: FormEvent) => {
    event.preventDefault();
    setTemplateError(null);
    setTemplateSuccess(null);

    if (!templateFile) {
      setTemplateError("Sélectionnez un fichier de template.");
      return;
    }

    try {
      setUploadingTemplate(true);
      const formData = new FormData();
      formData.append("file", templateFile);
      if (templateDescription.trim()) {
        formData.append("description", templateDescription.trim());
      }
      const created = await apiFetchFormData("/runbooks/templates", formData);
      setTemplateSuccess(`Template importé : ${created.originalName}`);
      setTemplateDescription("");
      setTemplateFile(null);
      await loadTemplates();
    } catch (err: any) {
      setTemplateError(err.message || "Échec de l'import du template");
    } finally {
      setUploadingTemplate(false);
    }
  };

  const downloadTemplate = async (tpl: RunbookTemplateFront) => {
    try {
      const latest = await apiFetch(`/runbooks/templates/${tpl.id}`);
      if (!latest.signedUrl) {
        setTemplateError("Lien de téléchargement indisponible.");
        return;
      }
      const link = document.createElement("a");
      link.href = latest.signedUrl;
      link.download = latest.originalName || "template";
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setTemplateError(err.message || "Téléchargement du template impossible");
    }
  };

  const startTemplateEdit = (tpl: RunbookTemplateFront) => {
    setEditingTemplateId(tpl.id);
    setEditTemplateDescription(tpl.description || "");
    setTemplateActionError(null);
  };

  const handleTemplateUpdate = async (tplId: string) => {
    setUpdatingTemplate(true);
    setTemplateActionError(null);
    try {
      await apiFetch(`/runbooks/templates/${tplId}`, {
        method: "PUT",
        body: JSON.stringify({ description: editTemplateDescription }),
      });
      await loadTemplates();
      setEditingTemplateId(null);
    } catch (err: any) {
      setTemplateActionError(err.message || "Mise à jour impossible");
    } finally {
      setUpdatingTemplate(false);
    }
  };

  const handleTemplateDelete = async (tplId: string) => {
    const confirmed = window.confirm("Supprimer ce template ?");
    if (!confirmed) return;
    setDeletingTemplateId(tplId);
    setTemplateActionError(null);
    try {
      await apiFetch(`/runbooks/templates/${tplId}`, { method: "DELETE" });
      await loadTemplates();
    } catch (err: any) {
      setTemplateActionError(err.message || "Suppression impossible");
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const startRunbookEdit = (runbook: RunbookFront) => {
    setEditingRunbookId(runbook.id);
    setEditRunbook({
      title: runbook.title,
      summary: runbook.summary || "",
      status: runbook.status,
    });
    setRunbookActionError(null);
  };

  const handleRunbookUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingRunbookId) return;
    setUpdatingRunbook(true);
    setRunbookActionError(null);
    try {
      await apiFetch(`/runbooks/${editingRunbookId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editRunbook.title,
          summary: editRunbook.summary,
          status: editRunbook.status,
        }),
      });
      await loadData();
      setEditingRunbookId(null);
    } catch (err: any) {
      setRunbookActionError(err.message || "Mise à jour impossible");
    } finally {
      setUpdatingRunbook(false);
    }
  };

  const handleRunbookDelete = async (runbookId: string) => {
    const confirmed = window.confirm("Supprimer ce runbook ?");
    if (!confirmed) return;
    setDeletingRunbookId(runbookId);
    setRunbookActionError(null);
    try {
      await apiFetch(`/runbooks/${runbookId}`, { method: "DELETE" });
      await loadData();
    } catch (err: any) {
      setRunbookActionError(err.message || "Suppression impossible");
    } finally {
      setDeletingRunbookId(null);
    }
  };

  if (loading) return <div className="skeleton">Chargement des runbooks...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  const progressSteps = [
    templates.length > 0,
    scenarios.length > 0,
    runbooks.length > 0,
  ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <section id="runbooks-panel" className="panel" aria-labelledby="runbooks-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">PRA</p>
          <h2 id="runbooks-title">Runbooks & rapports</h2>
          <p className="muted">
            Génération de runbooks, sélection de templates et téléchargement des rapports PRA (texte, PDF ou JSON).
          </p>
        </div>
        <div className="badge subtle">{runbooks.length} runbooks</div>
      </div>

      <PageIntro
        title="Générer et versionner les runbooks"
        objective="Assembler les scénarios PRA, templates et synthèses pour obtenir des runbooks prêts à diffuser."
        steps={[
          "Sélectionner un template",
          "Associer un scénario si nécessaire",
          "Exporter le runbook final",
        ]}
        tips={[
          "Choisissez un template cohérent avec vos exigences d'audit.",
          "Associez un scénario pour enrichir les étapes.",
          "Exportez le PDF pour diffusion opérationnelle.",
        ]}
        links={[
          { label: "Générer un runbook", href: "#runbooks-generate", description: "Formulaire" },
          { label: "Gérer les templates", href: "#runbooks-templates", description: "Bibliothèque" },
          { label: "Consulter les runbooks", href: "#runbooks-list", description: "Historique" },
        ]}
        expectedData={[
          "Template (générique, scénario, audit)",
          "Scénario PRA à inclure",
          "Titre, résumé et propriétaire",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <div className="panel-grid">
        <form id="runbooks-generate" className="card form-grid" onSubmit={handleGenerate}>
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
            <span>Template importé (optionnel)</span>
            <select
              value={templateId}
              onChange={(e) => handleTemplateSelection(e.target.value)}
              disabled={templateLoading}
            >
              <option value="">Aucun (template standard)</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.originalName}
                </option>
              ))}
            </select>
            <p className="helper">
              {selectedTemplateInfo
                ? `${selectedTemplateInfo.format.toUpperCase()} • ${
                    selectedTemplateInfo.description || "Sans description"
                  }`
                : "Importez un template personnalisé (DOCX, ODT, Markdown) pour l'utiliser ici."}
            </p>
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
            {templateSuccess && <p className="helper success">{templateSuccess}</p>}
          </div>
        </form>

        <div id="runbooks-templates" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Rapports</p>
              <h3>Exports PRA</h3>
            </div>
          </div>
          <div className="stack" style={{ gap: "12px" }}>
            <p className="muted">
              Téléchargez le rapport PRA consolidé (texte ou PDF) ou son équivalent JSON (services, dépendances,
              backups, politiques et recommandations).
            </p>
            <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
              <button className="btn" onClick={() => downloadReport("text")}>
                Rapport texte
              </button>
              <button className="btn" onClick={() => downloadReport("pdf")}>
                Rapport PDF
              </button>
              <button className="btn" onClick={() => downloadReport("json")}>
                Rapport JSON
              </button>
            </div>
          </div>
        </div>
      </div>

      <div id="runbooks-list" className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Templates</p>
            <h3>Bibliothèque de templates</h3>
          </div>
        </div>
        <form className="stack" onSubmit={handleTemplateUpload} style={{ gap: "12px" }}>
          <label className="form-field">
            <span>Fichier template</span>
            <input
              type="file"
              accept=".docx,.odt,.md,.markdown"
              onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
            />
          </label>
          <label className="form-field">
            <span>Description (optionnel)</span>
            <input
              type="text"
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              placeholder="Ex: format audit, version client"
            />
          </label>
          <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
            <button className="btn" type="submit" disabled={uploadingTemplate}>
              {uploadingTemplate ? "Import..." : "Importer le template"}
            </button>
            {templateError && <p className="helper error">{templateError}</p>}
            {templateSuccess && <p className="helper success">{templateSuccess}</p>}
          </div>
        </form>
        {templateLoading ? (
          <p className="skeleton" style={{ marginTop: "16px" }}>
            Chargement des templates...
          </p>
        ) : templates.length === 0 ? (
          <p className="empty-state" style={{ marginTop: "16px" }}>
            Aucun template importé pour ce tenant.
          </p>
        ) : (
          <div className="table-wrapper" style={{ marginTop: "16px" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Format</th>
                  <th>Description</th>
                  <th>Upload</th>
                  <th>Téléchargement</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tpl) => (
                  <tr key={tpl.id}>
                    <td>{tpl.originalName}</td>
                    <td>{tpl.format?.toUpperCase()}</td>
                    <td>
                      {editingTemplateId === tpl.id ? (
                        <input
                          type="text"
                          value={editTemplateDescription}
                          onChange={(e) => setEditTemplateDescription(e.target.value)}
                        />
                      ) : (
                        tpl.description || "—"
                      )}
                    </td>
                    <td>{tpl.createdAt ? new Date(tpl.createdAt).toLocaleDateString() : "-"}</td>
                    <td>
                      <button className="btn ghost" onClick={() => downloadTemplate(tpl)}>
                        Télécharger
                      </button>
                    </td>
                    <td>
                      <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
                        {editingTemplateId === tpl.id ? (
                          <>
                            <button
                              className="btn primary"
                              onClick={() => handleTemplateUpdate(tpl.id)}
                              disabled={updatingTemplate}
                            >
                              {updatingTemplate ? "Mise à jour..." : "Enregistrer"}
                            </button>
                            <button
                              className="btn"
                              onClick={() => setEditingTemplateId(null)}
                              disabled={updatingTemplate}
                            >
                              Annuler
                            </button>
                          </>
                        ) : (
                          <button className="btn ghost" onClick={() => startTemplateEdit(tpl)}>
                            Modifier
                          </button>
                        )}
                        <button
                          className="btn"
                          onClick={() => handleTemplateDelete(tpl.id)}
                          disabled={deletingTemplateId === tpl.id}
                        >
                          {deletingTemplateId === tpl.id ? "Suppression..." : "Supprimer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {templateActionError && <p className="helper error">{templateActionError}</p>}
          </div>
        )}
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
                  <th>Actions</th>
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
                      <td>
                        <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
                          <button className="btn ghost" onClick={() => startRunbookEdit(runbook)}>
                            Modifier
                          </button>
                          <button
                            className="btn"
                            onClick={() => handleRunbookDelete(runbook.id)}
                            disabled={deletingRunbookId === runbook.id}
                          >
                            {deletingRunbookId === runbook.id ? "Suppression..." : "Supprimer"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {runbookActionError && <p className="helper error">{runbookActionError}</p>}
        {editingRunbookId && (
          <form className="card form-grid" onSubmit={handleRunbookUpdate} style={{ marginTop: "16px" }}>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <label className="form-field">
                <span>Titre</span>
                <input
                  type="text"
                  value={editRunbook.title}
                  onChange={(e) => setEditRunbook((s) => ({ ...s, title: e.target.value }))}
                  required
                />
              </label>
              <label className="form-field">
                <span>Statut</span>
                <input
                  type="text"
                  value={editRunbook.status}
                  onChange={(e) => setEditRunbook((s) => ({ ...s, status: e.target.value }))}
                />
              </label>
              <label className="form-field" style={{ gridColumn: "span 3" }}>
                <span>Résumé</span>
                <textarea
                  value={editRunbook.summary}
                  onChange={(e) => setEditRunbook((s) => ({ ...s, summary: e.target.value }))}
                  rows={3}
                />
              </label>
            </div>
            <div className="form-actions">
              <div className="stack horizontal" style={{ gap: "8px", alignItems: "center" }}>
                <button className="btn primary" type="submit" disabled={updatingRunbook}>
                  {updatingRunbook ? "Mise à jour..." : "Enregistrer"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setEditingRunbookId(null)}
                  disabled={updatingRunbook}
                >
                  Annuler
                </button>
              </div>
              {runbookActionError && <p className="helper error">{runbookActionError}</p>}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

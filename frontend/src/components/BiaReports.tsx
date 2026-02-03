import { useState, useCallback } from "react";
import { apiFetch } from "../utils/api";

interface BiaReportsProps {
  processCount: number;
}

type ReportType = "full" | "summary" | "scenario";
type ReportFormat = "markdown" | "html" | "json";
type ScenarioType = "site_disaster" | "cyberattack" | "infrastructure_failure";

type GeneratedReport = {
  title: string;
  type: ReportType;
  format: ReportFormat;
  generatedAt: string;
  content: string;
  metadata: {
    tenantId: string;
    processCount: number;
    criticalCount: number;
    avgCriticality: number;
  };
};

type ReportHistory = {
  id: string;
  title: string;
  type: ReportType;
  format: ReportFormat;
  generatedAt: string;
};

const REPORT_TYPES: Array<{ value: ReportType; label: string; description: string }> = [
  {
    value: "full",
    label: "Rapport BIA complet",
    description: "Document détaillé avec tous les processus, impacts et recommandations.",
  },
  {
    value: "summary",
    label: "Rapport synthétique",
    description: "Résumé pour la direction avec les processus critiques et investissements.",
  },
  {
    value: "scenario",
    label: "Comparaison de scénarios",
    description: "Analyse d'impact selon différents scénarios d'interruption.",
  },
];

const REPORT_FORMATS: Array<{ value: ReportFormat; label: string; extension: string }> = [
  { value: "markdown", label: "Markdown (.md)", extension: "md" },
  { value: "html", label: "HTML (.html)", extension: "html" },
  { value: "json", label: "JSON (.json)", extension: "json" },
];

const SCENARIO_TYPES: Array<{ value: ScenarioType; label: string }> = [
  { value: "site_disaster", label: "Sinistre site principal" },
  { value: "cyberattack", label: "Cyberattaque majeure" },
  { value: "infrastructure_failure", label: "Panne infrastructure" },
];

export function BiaReports({ processCount }: BiaReportsProps) {
  const [reportType, setReportType] = useState<ReportType>("full");
  const [reportFormat, setReportFormat] = useState<ReportFormat>("markdown");
  const [scenarioType, setScenarioType] = useState<ScenarioType>("site_disaster");
  const [includeRecommendations, setIncludeRecommendations] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null);
  const [reportHistory, setReportHistory] = useState<ReportHistory[]>([]);

  const generateReport = useCallback(async () => {
    if (processCount === 0) {
      setError("Aucun processus BIA à inclure dans le rapport.");
      return;
    }

    setGenerating(true);
    setError(null);
    setGeneratedReport(null);

    try {
      const report = await apiFetch("/bia/reports/generate", {
        method: "POST",
        body: JSON.stringify({
          type: reportType,
          format: reportFormat,
          includeRecommendations,
          scenarioType: reportType === "scenario" ? scenarioType : undefined,
        }),
      });

      setGeneratedReport(report);

      // Add to history
      const historyEntry: ReportHistory = {
        id: `report-${Date.now()}`,
        title: report.title,
        type: report.type,
        format: report.format,
        generatedAt: report.generatedAt,
      };
      setReportHistory((prev) => [historyEntry, ...prev].slice(0, 10));
    } catch (err: any) {
      setError(err.message || "Erreur lors de la génération du rapport");
    } finally {
      setGenerating(false);
    }
  }, [reportType, reportFormat, scenarioType, includeRecommendations, processCount]);

  const downloadReport = useCallback(() => {
    if (!generatedReport) return;

    const format = REPORT_FORMATS.find((f) => f.value === generatedReport.format);
    const extension = format?.extension || "txt";
    const mimeType =
      generatedReport.format === "json"
        ? "application/json"
        : generatedReport.format === "html"
        ? "text/html"
        : "text/markdown";

    const blob = new Blob([generatedReport.content], { type: `${mimeType};charset=utf-8` });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bia-report-${generatedReport.type}-${new Date().toISOString().split("T")[0]}.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [generatedReport]);

  const copyToClipboard = useCallback(async () => {
    if (!generatedReport) return;

    try {
      await navigator.clipboard.writeText(generatedReport.content);
      // Could add a toast notification here
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = generatedReport.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }, [generatedReport]);

  return (
    <div className="bia-reports">
      <div className="reports-grid">
        {/* Configuration Panel */}
        <div className="card config-panel">
          <div className="card-header">
            <div>
              <p className="eyebrow">Configuration</p>
              <h3>Paramètres du rapport</h3>
            </div>
          </div>

          <div className="config-content">
            {/* Report Type Selection */}
            <div className="config-section">
              <h4>Type de rapport</h4>
              <div className="report-type-options">
                {REPORT_TYPES.map((type) => (
                  <label
                    key={type.value}
                    className={`report-type-option ${reportType === type.value ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="reportType"
                      value={type.value}
                      checked={reportType === type.value}
                      onChange={(e) => setReportType(e.target.value as ReportType)}
                    />
                    <div className="option-content">
                      <span className="option-label">{type.label}</span>
                      <span className="option-description muted small">{type.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Scenario Type (conditional) */}
            {reportType === "scenario" && (
              <div className="config-section">
                <h4>Type de scénario</h4>
                <select
                  value={scenarioType}
                  onChange={(e) => setScenarioType(e.target.value as ScenarioType)}
                  className="scenario-select"
                >
                  {SCENARIO_TYPES.map((scenario) => (
                    <option key={scenario.value} value={scenario.value}>
                      {scenario.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Format Selection */}
            <div className="config-section">
              <h4>Format de sortie</h4>
              <div className="format-options">
                {REPORT_FORMATS.map((format) => (
                  <label
                    key={format.value}
                    className={`format-option ${reportFormat === format.value ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="reportFormat"
                      value={format.value}
                      checked={reportFormat === format.value}
                      onChange={(e) => setReportFormat(e.target.value as ReportFormat)}
                    />
                    <span>{format.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Options */}
            <div className="config-section">
              <h4>Options</h4>
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={includeRecommendations}
                  onChange={(e) => setIncludeRecommendations(e.target.checked)}
                />
                <span>Inclure les recommandations</span>
              </label>
            </div>

            {/* Generate Button */}
            <div className="config-actions">
              <button
                className="button primary"
                onClick={generateReport}
                disabled={generating || processCount === 0}
              >
                {generating ? "Génération en cours..." : "Générer le rapport"}
              </button>
              {processCount === 0 && (
                <p className="muted small">Créez d'abord des processus BIA pour générer un rapport.</p>
              )}
            </div>
          </div>
        </div>

        {/* Preview / Result Panel */}
        <div className="card preview-panel">
          <div className="card-header">
            <div>
              <p className="eyebrow">Aperçu</p>
              <h3>Rapport généré</h3>
            </div>
            {generatedReport && (
              <div className="preview-actions">
                <button className="button small" onClick={copyToClipboard}>
                  Copier
                </button>
                <button className="button small primary" onClick={downloadReport}>
                  Télécharger
                </button>
              </div>
            )}
          </div>

          <div className="preview-content">
            {error && <div className="alert error">{error}</div>}

            {generating && (
              <div className="generating-state">
                <div className="spinner" />
                <p>Génération du rapport en cours...</p>
              </div>
            )}

            {!generating && !generatedReport && !error && (
              <div className="empty-state">
                <p className="muted">Configurez les paramètres et cliquez sur "Générer le rapport".</p>
              </div>
            )}

            {generatedReport && !generating && (
              <>
                <div className="report-meta">
                  <span className="pill subtle">{generatedReport.type}</span>
                  <span className="pill subtle">{generatedReport.format}</span>
                  <span className="muted small">
                    {generatedReport.metadata.processCount} processus |{" "}
                    {generatedReport.metadata.criticalCount} critiques
                  </span>
                </div>
                <div className="report-preview">
                  {generatedReport.format === "html" ? (
                    <iframe
                      srcDoc={generatedReport.content}
                      title="Aperçu du rapport"
                      className="html-preview"
                    />
                  ) : (
                    <pre className="content-preview">{generatedReport.content}</pre>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Report History */}
      {reportHistory.length > 0 && (
        <div className="card history-panel" style={{ marginTop: "1rem" }}>
          <div className="card-header">
            <div>
              <p className="eyebrow">Historique</p>
              <h3>Rapports récents</h3>
            </div>
          </div>
          <div className="history-list">
            {reportHistory.map((report) => (
              <div key={report.id} className="history-item">
                <div className="history-info">
                  <span className="history-title">{report.title}</span>
                  <span className="muted small">
                    {new Date(report.generatedAt).toLocaleString("fr-FR")}
                  </span>
                </div>
                <div className="history-badges">
                  <span className="pill subtle small">{report.type}</span>
                  <span className="pill subtle small">{report.format}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Styles
export const biaReportsStyles = `
.bia-reports {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.reports-grid {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 1rem;
}

@media (max-width: 900px) {
  .reports-grid {
    grid-template-columns: 1fr;
  }
}

.config-panel {
  height: fit-content;
}

.config-content {
  padding: 1rem;
}

.config-section {
  margin-bottom: 1.5rem;
}

.config-section h4 {
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.report-type-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.report-type-option {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.report-type-option:hover {
  border-color: var(--color-primary);
}

.report-type-option.selected {
  border-color: var(--color-primary);
  background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.05);
}

.report-type-option input {
  margin-top: 2px;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option-label {
  font-weight: 500;
}

.scenario-select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
}

.format-options {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.format-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.format-option:hover {
  border-color: var(--color-primary);
}

.format-option.selected {
  border-color: var(--color-primary);
  background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
}

.checkbox-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.config-actions {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.config-actions .button {
  width: 100%;
}

.preview-panel {
  display: flex;
  flex-direction: column;
}

.preview-panel .card-header {
  border-bottom: 1px solid var(--color-border);
}

.preview-actions {
  display: flex;
  gap: 0.5rem;
}

.preview-content {
  flex: 1;
  padding: 1rem;
  min-height: 400px;
  display: flex;
  flex-direction: column;
}

.generating-state,
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.report-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.report-preview {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.content-preview {
  margin: 0;
  padding: 1rem;
  font-size: 0.8125rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 500px;
  overflow-y: auto;
  background: var(--color-surface-secondary);
}

.html-preview {
  width: 100%;
  min-height: 500px;
  border: none;
  background: white;
}

.history-panel .card-header {
  border-bottom: 1px solid var(--color-border);
}

.history-list {
  padding: 0.5rem;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.history-item:last-child {
  border-bottom: none;
}

.history-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-title {
  font-weight: 500;
}

.history-badges {
  display: flex;
  gap: 0.25rem;
}
`;

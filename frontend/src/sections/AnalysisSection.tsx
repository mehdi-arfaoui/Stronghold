import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { PageIntro } from "../components/PageIntro";
import type {
  AppWarning,
  InfraFinding,
  MaturityScore,
  PraDashboard,
  PraRagReport,
  RiskHeatmap,
} from "../types";
import { apiFetch } from "../utils/api";

interface AnalysisSectionProps {
  configVersion: number;
}

function MatchBadge({ level }: { level: "strong" | "medium" | "weak" }) {
  const palette: Record<typeof level, string> = {
    strong: "success",
    medium: "warning",
    weak: "error",
  };
  return <span className={`pill ${palette[level]}`}>{level}</span>;
}

function MaturityBadge({ level }: { level: "low" | "medium" | "high" }) {
  const palette: Record<typeof level, string> = {
    high: "success",
    medium: "warning",
    low: "error",
  };
  const labels: Record<typeof level, string> = {
    high: "Élevée",
    medium: "Moyenne",
    low: "Faible",
  };
  return <span className={`pill ${palette[level]}`}>{labels[level]}</span>;
}

export function AnalysisSection({ configVersion }: AnalysisSectionProps) {
  const [dashboard, setDashboard] = useState<PraDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heatmap, setHeatmap] = useState<RiskHeatmap | null>(null);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);
  const [maturity, setMaturity] = useState<MaturityScore | null>(null);
  const [maturityError, setMaturityError] = useState<string | null>(null);

  const [question, setQuestion] = useState("Quels scénarios PRA recommander pour mes services critiques ?");
  const [docTypes, setDocTypes] = useState<string>("BACKUP_POLICY,ARCHI");
  const [serviceFilter, setServiceFilter] = useState("");
  const [ragResult, setRagResult] = useState<PraRagReport | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);
  const [runbookDraft, setRunbookDraft] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        setLoading(true);
        setError(null);
        setHeatmapError(null);
        setMaturityError(null);
        const [dashboardResult, maturityResult] = await Promise.allSettled([
          apiFetch("/analysis/pra-dashboard"),
          apiFetch("/analysis/maturity-score"),
        ]);

        if (dashboardResult.status === "fulfilled") {
          setDashboard(dashboardResult.value);
          setRagResult(dashboardResult.value.rag);
          try {
            const heatmapData = await apiFetch("/analysis/risk-heatmap");
            setHeatmap(heatmapData);
          } catch (err: any) {
            setHeatmapError(err.message || "Impossible de charger la heatmap");
          }
        } else {
          setError(dashboardResult.reason?.message || "Erreur inconnue");
        }

        if (maturityResult.status === "fulfilled") {
          setMaturity(maturityResult.value);
        } else {
          setMaturityError(maturityResult.reason?.message || "Impossible de calculer la maturité");
        }
      } catch (err: any) {
        setError(err.message || "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, [configVersion]);

  const filteredDocTypes = useMemo(
    () =>
      docTypes
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t.length > 0),
    [docTypes]
  );

  const heatmapOptions = useMemo(() => {
    if (!heatmap) return null;
    const metricLabels = heatmap.metrics.map((metric) => metric.label);
    const serviceLabels = heatmap.services.map((service) => service.name);
    const metricIndex = new Map(heatmap.metrics.map((metric, index) => [metric.key, index]));
    const serviceIndex = new Map(heatmap.services.map((service, index) => [service.id, index]));
    const cellLookup = new Map<string, RiskHeatmap["data"][number]>();

    const data = heatmap.data.map((cell) => {
      const x = metricIndex.get(cell.metric) ?? 0;
      const y = serviceIndex.get(cell.serviceId) ?? 0;
      cellLookup.set(`${x}:${y}`, cell);
      return [x, y, cell.score];
    });

    const maxScore = data.reduce((acc, value) => Math.max(acc, value[2] ?? 0), 0) || 1;

    return {
      tooltip: {
        formatter: (params: any) => {
          const cell = cellLookup.get(`${params.data[0]}:${params.data[1]}`);
          if (!cell) return "";
          const metric = heatmap.metrics.find((item) => item.key === cell.metric);
          const gapValue =
            cell.gap == null
              ? "N/A"
              : cell.metric === "rto"
              ? `${cell.gap}h`
              : `${cell.gap} min`;
          const gapRisk =
            cell.gapRisk == null
              ? "N/A"
              : cell.metric === "rto"
              ? `${cell.gapRisk}h`
              : `${cell.gapRisk} min`;

          return `
            <strong>${cell.serviceName}</strong><br/>
            Criticité: ${cell.criticality.toUpperCase()}<br/>
            ${metric?.label}: ${gapValue}<br/>
            Gap retenu: ${gapRisk}
          `;
        },
      },
      grid: {
        left: 120,
        right: 24,
        top: 40,
        bottom: 20,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: metricLabels,
        splitArea: { show: true },
      },
      yAxis: {
        type: "category",
        data: serviceLabels,
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: maxScore,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
      },
      series: [
        {
          name: "Risque",
          type: "heatmap",
          data,
          label: { show: false },
          emphasis: {
            itemStyle: {
              borderColor: "#ffffff",
              borderWidth: 1,
            },
          },
        },
      ],
    };
  }, [heatmap]);

  const submitRag = async () => {
    if (!question || question.trim().length < 4) {
      setRagError("Question trop courte.");
      return;
    }
    setRagLoading(true);
    setRagError(null);
    try {
      const result = await apiFetch("/analysis/pra-rag-report", {
        method: "POST",
        body: JSON.stringify({
          question,
          documentTypes: filteredDocTypes,
          serviceFilter: serviceFilter || null,
        }),
      });
      setRagResult(result);
    } catch (err: any) {
      setRagError(err.message || "Impossible d'interroger l'IA PRA");
    } finally {
      setRagLoading(false);
    }
  };

  const submitRunbook = async () => {
    setRagError(null);
    setRagLoading(true);
    try {
      const result = await apiFetch("/analysis/runbook-draft", {
        method: "POST",
        body: JSON.stringify({
          question,
          documentTypes: filteredDocTypes,
          serviceFilter: serviceFilter || null,
        }),
      });
      setRunbookDraft(result.draftRunbook);
    } catch (err: any) {
      setRagError(err.message || "Impossible de générer le runbook");
    } finally {
      setRagLoading(false);
    }
  };

  if (loading) return <div className="skeleton">Analyse en cours...</div>;
  if (error) return <div className="alert error">Erreur lors du chargement : {error}</div>;
  if (!dashboard) return null;

  const appWarnings: AppWarning[] = dashboard.warnings;
  const infraFindings: InfraFinding[] = dashboard.infraFindings;
  const progressSteps = [Boolean(dashboard), Boolean(ragResult), Boolean(runbookDraft)];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <section id="analysis-panel" className="panel" aria-labelledby="analysis-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Contrôles</p>
          <h2 id="analysis-title">Analyse PRA</h2>
          <p className="muted">
            Synthèse des incohérences RTO/RPO/criticité, recommandations DR et interrogation IA contextualisée.
          </p>
        </div>
        <div className="badge subtle">
          Cible : RTO {dashboard.meta.targetRtoHours}h / RPO {dashboard.meta.targetRpoMinutes} min •{" "}
          {dashboard.meta.globalCriticality.toUpperCase()}
        </div>
      </div>

      <PageIntro
        title="Qualifier la posture PRA"
        objective="Identifier les écarts RTO/RPO, prioriser les recommandations DR et interroger l'IA avec votre contexte."
        steps={[
          "Analyser les incohérences applicatives",
          "Évaluer les écarts RTO/RPO",
          "Comparer les scénarios DR",
          "Lancer un diagnostic IA contextualisé",
        ]}
        links={[
          { label: "Voir les alertes", href: "#analysis-dashboard", description: "Anomalies" },
          { label: "Heatmap de risques", href: "#analysis-heatmap", description: "RTO/RPO" },
          { label: "Comparer les scénarios", href: "#analysis-dr", description: "Recommandations" },
          { label: "Interroger l'IA", href: "#analysis-ai", description: "RAG PRA" },
        ]}
        expectedData={[
          "Services + objectifs RTO/RPO",
          "Dépendances et criticités",
          "Documents indexés pour le RAG",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <div className="panel-grid">
        <div id="analysis-maturity" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Maturité PRA</p>
              <h3>Maturité PRA</h3>
            </div>
            {maturity && (
              <span className="pill subtle">
                Score {maturity.score}/{maturity.maxScore}
              </span>
            )}
          </div>
          {maturityError && <p className="helper error">{maturityError}</p>}
          {!maturity && !maturityError && (
            <p className="empty-state">Indicateur de maturité indisponible pour le moment.</p>
          )}
          {maturity && (
            <div className="stack" style={{ gap: "12px" }}>
              <div className="stack horizontal" style={{ gap: "12px", alignItems: "center" }}>
                <div>
                  <p className="muted small">Score global</p>
                  <strong style={{ fontSize: "28px" }}>{maturity.score}</strong>
                  <span className="muted small">/{maturity.maxScore}</span>
                </div>
                <MaturityBadge level={maturity.level} />
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Levier</th>
                      <th>Couverture</th>
                      <th>Score</th>
                      <th>Détail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maturity.breakdown.map((item) => (
                      <tr key={item.key}>
                        <td>{item.label}</td>
                        <td>{Math.round(item.coverage * 100)}%</td>
                        <td>
                          {item.score}/{item.maxScore}
                        </td>
                        <td className="muted small">{item.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="muted small">Recommandations concrètes</p>
                <ul className="muted small">
                  {maturity.recommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel-grid">
        <div id="analysis-dashboard" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Applicatif</p>
              <h3>Analyse applicative</h3>
            </div>
            <span className="pill subtle">{appWarnings.length}</span>
          </div>
          {appWarnings.length === 0 ? (
            <p className="empty-state">Aucune incohérence applicative détectée.</p>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Service</th>
                    <th>Dépend de</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {appWarnings.map((warning, idx) => (
                    <tr key={idx}>
                      <td>{warning.type}</td>
                      <td>{warning.service}</td>
                      <td>{warning.dependsOn}</td>
                      <td>{warning.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div id="analysis-dr" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Infrastructure</p>
              <h3>Landing Zone</h3>
            </div>
            <span className="pill subtle">{infraFindings.length}</span>
          </div>
          {infraFindings.length === 0 ? (
            <p className="empty-state">Aucun point particulier détecté sur l'infra.</p>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Composant</th>
                    <th>Type LZ</th>
                    <th>Localisation</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {infraFindings.map((finding, idx) => (
                    <tr key={idx}>
                      <td>{finding.type}</td>
                      <td>{finding.infra}</td>
                      <td>{finding.infraType}</td>
                      <td>{finding.location ?? "-"}</td>
                      <td>{finding.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="panel-grid">
        <div id="analysis-heatmap" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Risque</p>
              <h3>Heatmap des écarts RTO/RPO</h3>
            </div>
            <span className="pill subtle">{heatmap?.services.length ?? 0}</span>
          </div>
          {heatmapError && <p className="helper error">{heatmapError}</p>}
          {!heatmap && !heatmapError && (
            <p className="empty-state">Heatmap non disponible pour le moment.</p>
          )}
          {heatmap && heatmapOptions && (
            <>
              <p className="muted small">
                Les scores sont pondérés par la criticité pour souligner les services les plus sensibles.
              </p>
              <ReactECharts option={heatmapOptions as any} style={{ height: 420 }} />
            </>
          )}
        </div>
      </div>

      <div className="panel-grid">
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Stratégies DR</p>
              <h3>Recommandations automatisées</h3>
            </div>
            <span className="pill subtle">{dashboard.dr.recommendations.length}</span>
          </div>
          <div className="stack" style={{ gap: "12px" }}>
            {dashboard.dr.recommendations.map((rec) => (
              <div key={rec.scenario.id} className="stack" style={{ gap: "6px" }}>
                <div className="stack horizontal" style={{ gap: "8px", alignItems: "center" }}>
                  <strong className="service-name">{rec.scenario.label}</strong>
                  <MatchBadge level={rec.matchLevel} />
                  <span className="pill subtle">
                    RTO {rec.scenario.rtoRangeHours[0]}-{rec.scenario.rtoRangeHours[1]}h
                  </span>
                  <span className="pill subtle">
                    RPO {rec.scenario.rpoRangeMinutes[0]}-{rec.scenario.rpoRangeMinutes[1]} min
                  </span>
                  <span className="pill subtle">Coût: {rec.scenario.cost}</span>
                  <span className="pill subtle">Cx: {rec.scenario.complexity}</span>
                </div>
                <p className="muted small">{rec.justification}</p>
                <details>
                  <summary>Raisons détaillées</summary>
                  <ul className="muted small">
                    {rec.rationale.map((r, idx) => (
                      <li key={idx}>{r}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Comparatif</p>
              <h3>Tableau RTO / RPO / Coût</h3>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Scénario</th>
                  <th>RTO estimé</th>
                  <th>RPO estimé</th>
                  <th>Coût</th>
                  <th>Complexité</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.dr.comparison.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{row.rto}</td>
                    <td>{row.rpo}</td>
                    <td>{row.cost}</td>
                    <td>{row.complexity}</td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="analysis-ai" className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">IA</p>
            <h3>Analyse PRA et runbook (RAG)</h3>
          </div>
          {ragResult && <span className="pill subtle">{ragResult.context.chunks.length} extraits</span>}
        </div>

        <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Question à l'IA</span>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} />
          </label>
          <label className="form-field">
            <span>Filtrer par type de document</span>
            <input
              type="text"
              value={docTypes}
              onChange={(e) => setDocTypes(e.target.value)}
              placeholder="BACKUP_POLICY,ARCHI"
            />
          </label>
          <label className="form-field">
            <span>Service ciblé (optionnel)</span>
            <input
              type="text"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              placeholder="Nom de service"
            />
          </label>
        </div>

        <div className="form-actions" style={{ justifyContent: "flex-start" }}>
          <button className="btn primary" type="button" disabled={ragLoading} onClick={submitRag}>
            {ragLoading ? "Analyse..." : "Interroger l'IA PRA"}
          </button>
          <button className="btn" type="button" disabled={ragLoading} onClick={submitRunbook}>
            {ragLoading ? "Génération..." : "Générer un runbook"}
          </button>
          {ragError && <p className="helper error">{ragError}</p>}
        </div>

        {ragResult && (
          <div className="stack" style={{ gap: "12px" }}>
            <div className="alert success">
              <strong>Réponse suggérée :</strong>
              <div className="muted">{ragResult.draftAnswer}</div>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Scénario</th>
                    <th>Score</th>
                    <th>Raison</th>
                  </tr>
                </thead>
                <tbody>
                  {ragResult.scenarioRecommendations.map((rec) => (
                    <tr key={rec.scenarioId}>
                      <td>{rec.name}</td>
                      <td className="numeric">{rec.score.toFixed(3)}</td>
                      <td className="muted small">{rec.reason.join(" • ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>Prompt complet ({ragResult.promptSize} caractères)</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{ragResult.prompt}</pre>
            </details>
          </div>
        )}

        {runbookDraft && (
          <details open>
            <summary>Runbook généré (brouillon)</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{runbookDraft}</pre>
          </details>
        )}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import type { AppWarning, InfraFinding } from "../types";
import { apiFetch } from "../utils/api";

interface AnalysisSectionProps {
  configVersion: number;
}

export function AnalysisSection({ configVersion }: AnalysisSectionProps) {
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
  }, [configVersion]);

  if (loading) return <div className="skeleton">Analyse en cours...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  return (
    <section id="analysis-panel" className="panel" aria-labelledby="analysis-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Contrôles</p>
          <h2 id="analysis-title">Analyse PRA</h2>
          <p className="muted">
            Synthèse des incohérences RTO/RPO/criticité et des points de risque Landing Zone.
          </p>
        </div>
      </div>

      <div className="panel-grid">
        <div className="card">
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

        <div className="card">
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
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { PageIntro } from "../components/PageIntro";
import type { ComplianceItem, ComplianceReport, ComplianceStatus } from "../types";
import { apiFetch } from "../utils/api";

interface ComplianceSectionProps {
  configVersion: number;
}

const STATUS_LABELS: Record<ComplianceStatus, { label: string; className: string }> = {
  ok: { label: "OK", className: "success" },
  partial: { label: "Partiel", className: "warning" },
  missing: { label: "Manquant", className: "error" },
};

const escapeCsvValue = (value: string) => {
  const escaped = value.replace(/"/g, "\"\"");
  return `"${escaped}"`;
};

export function ComplianceSection({ configVersion }: ComplianceSectionProps) {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const reportData = (await apiFetch("/analysis/compliance-report")) as ComplianceReport;
        setReport(reportData);
      } catch (err: any) {
        setError(err.message || "Impossible de charger les données de conformité");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [configVersion]);

  const compliance = useMemo(() => report, [report]);

  const scorePercent = compliance ? Math.round(compliance.overallScore * 100) : 0;
  const totalItems = compliance ? compliance.counts.total : 0;
  const gapPreview = compliance ? compliance.gaps.slice(0, 20) : [];

  const renderStatusBadge = (status: ComplianceStatus) => {
    const meta = STATUS_LABELS[status];
    return <span className={`pill ${meta.className}`}>{meta.label}</span>;
  };

  const handleExportExcel = () => {
    setExportError(null);
    if (!compliance) return;
    const rows: string[][] = [
      ["Standard", "Référence", "Exigence / Critère", "Domaine", "Statut", "Recommandation"],
    ];

    compliance.standards.iso22301.clauses.forEach((clause) => {
      rows.push([
        compliance.standards.iso22301.standard,
        clause.id,
        clause.label,
        clause.domain ?? "",
        STATUS_LABELS[clause.status].label,
        clause.recommendation,
      ]);
    });

    compliance.standards.secNumCloud.criteria.forEach((criterion) => {
      rows.push([
        compliance.standards.secNumCloud.standard,
        criterion.id,
        criterion.label,
        criterion.domain ?? "",
        STATUS_LABELS[criterion.status].label,
        criterion.recommendation,
      ]);
    });

    const csvContent = rows
      .map((row) => row.map((value) => escapeCsvValue(value)).join(";"))
      .join("\n");

    const blob = new Blob([`\uFEFF${csvContent}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rapport-conformite-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    setExportError(null);
    if (!compliance) return;
    const reportWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!reportWindow) {
      setExportError("Impossible d'ouvrir la fenêtre d'impression. Autorisez les popups.");
      return;
    }

    const renderRows = (items: ComplianceItem[], standard: string) =>
      items
        .map(
          (item) => `
          <tr>
            <td>${standard}</td>
            <td>${item.id}</td>
            <td>${item.label}</td>
            <td>${item.domain ?? ""}</td>
            <td>${STATUS_LABELS[item.status].label}</td>
            <td>${item.recommendation}</td>
          </tr>
        `
        )
        .join("");

    const isoRows = renderRows(
      compliance.standards.iso22301.clauses,
      compliance.standards.iso22301.standard
    );
    const secRows = renderRows(
      compliance.standards.secNumCloud.criteria,
      compliance.standards.secNumCloud.standard
    );

    reportWindow.document.write(`
      <html>
        <head>
          <title>Rapport de conformité</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { margin-bottom: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #ccc; padding: 8px; font-size: 12px; }
            th { background: #f5f5f5; text-align: left; }
            .summary { margin: 16px 0; }
          </style>
        </head>
        <body>
          <h1>Rapport de conformité</h1>
          <p class="summary">Score global : ${scorePercent}% (${totalItems} exigences)</p>
          <h2>ISO 22301</h2>
          <table>
            <thead>
              <tr>
                <th>Standard</th>
                <th>Référence</th>
                <th>Exigence</th>
                <th>Domaine</th>
                <th>Statut</th>
                <th>Recommandation</th>
              </tr>
            </thead>
            <tbody>
              ${isoRows}
            </tbody>
          </table>
          <h2>SecNumCloud</h2>
          <table>
            <thead>
              <tr>
                <th>Standard</th>
                <th>Référence</th>
                <th>Critère</th>
                <th>Domaine</th>
                <th>Statut</th>
                <th>Recommandation</th>
              </tr>
            </thead>
            <tbody>
              ${secRows}
            </tbody>
          </table>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
  };

  if (loading) {
    return <div className="skeleton">Chargement du référentiel de conformité...</div>;
  }

  if (!compliance) {
    return <p className="helper error">Aucune donnée de conformité disponible.</p>;
  }

  return (
    <section id="compliance-panel" className="panel" aria-labelledby="compliance-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Conformité</p>
          <h2 id="compliance-title">Conformité dynamique</h2>
          <p className="muted">
            Mesurez l'alignement ISO 22301 et SecNumCloud à partir des données BIA, risques,
            runbooks et exercices.
          </p>
        </div>
        <div className="stack horizontal" style={{ gap: "12px", flexWrap: "wrap" }}>
          <button type="button" className="btn subtle" onClick={handleExportPdf}>
            Export PDF
          </button>
          <button type="button" className="btn" onClick={handleExportExcel}>
            Export Excel
          </button>
        </div>
      </div>

      {error && <p className="helper error">{error}</p>}
      {exportError && <p className="helper error">{exportError}</p>}

      <PageIntro
        title="Piloter la conformité et les audits"
        objective="Synthétiser les exigences ISO 22301 et SecNumCloud avec un scoring dynamique."
        steps={[
          "Vérifier la couverture BIA, risques, runbooks et exercices.",
          "Analyser les écarts par standard.",
          "Exporter un rapport d'audit prêt à partager.",
        ]}
        links={[
          { label: "Voir les checklists", href: "#compliance-checklists", description: "Standards" },
          { label: "Écarts", href: "#compliance-gaps", description: "Manquements" },
          { label: "Actions", href: "#compliance-actions", description: "Recommandations" },
          { label: "Exports", href: "#compliance-exports", description: "PDF & Excel" },
        ]}
        expectedData={[
          "Processus BIA et impacts",
          "Registre des risques",
          "Runbooks générés",
          "Exercices PRA réalisés",
        ]}
        tips={[
          "Augmentez la fréquence des exercices pour améliorer la maturité.",
          "Centralisez les preuves dans les runbooks pour faciliter l'audit.",
        ]}
        progress={{
          value: scorePercent,
          label: `${totalItems} exigences suivies`,
        }}
      />

      <div className="panel-grid">
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Score global</p>
              <h3>Couverture consolidée</h3>
            </div>
            <span className="pill subtle">{scorePercent}%</span>
          </div>
          <div className="stack" style={{ gap: "12px" }}>
            <div className="stack horizontal" style={{ gap: "12px", flexWrap: "wrap" }}>
              <span className="pill success">{compliance.counts.ok} OK</span>
              <span className="pill warning">{compliance.counts.partial} Partiels</span>
              <span className="pill error">{compliance.counts.missing} Manquants</span>
              <span className="pill subtle">{totalItems} total</span>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Statut</th>
                    <th>Couverture</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>BIA</td>
                    <td>{renderStatusBadge(compliance.evidenceStatus.bia)}</td>
                    <td>{compliance.totals.processes} processus</td>
                  </tr>
                  <tr>
                    <td>Risques</td>
                    <td>{renderStatusBadge(compliance.evidenceStatus.risks)}</td>
                    <td>{compliance.totals.risks} risques</td>
                  </tr>
                  <tr>
                    <td>Incidents</td>
                    <td>{renderStatusBadge(compliance.evidenceStatus.incidents)}</td>
                    <td>{compliance.totals.incidents} incidents</td>
                  </tr>
                  <tr>
                    <td>Runbooks</td>
                    <td>{renderStatusBadge(compliance.evidenceStatus.runbooks)}</td>
                    <td>{compliance.totals.runbooks} runbooks</td>
                  </tr>
                  <tr>
                    <td>Exercices</td>
                    <td>{renderStatusBadge(compliance.evidenceStatus.exercises)}</td>
                    <td>{compliance.totals.exercises} exercices</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="compliance-actions" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Actions recommandées</p>
              <h3>Priorités immédiates</h3>
            </div>
            <span className="pill subtle">{compliance.correctiveActions.length}</span>
          </div>
          {compliance.correctiveActions.length === 0 ? (
            <p className="empty-state">Toutes les exigences critiques sont couvertes.</p>
          ) : (
            <ul className="checklist">
              {compliance.correctiveActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div id="compliance-checklists" className="panel-grid" style={{ marginTop: "1.5rem" }}>
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Checklist</p>
              <h3>{compliance.standards.iso22301.standard}</h3>
            </div>
            <span className="pill subtle">{compliance.standards.iso22301.clauses.length}</span>
          </div>
          <div className="stack" style={{ gap: "12px" }}>
            <ul className="checklist">
              {compliance.standards.iso22301.clauses.map((clause) => (
                <li key={clause.id}>
                  <div className="stack horizontal" style={{ gap: "12px", alignItems: "center" }}>
                    {renderStatusBadge(clause.status)}
                    <span>
                      {clause.id} — {clause.label}
                    </span>
                  </div>
                  <p className="muted small">{clause.recommendation}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Checklist</p>
              <h3>{compliance.standards.secNumCloud.standard}</h3>
            </div>
            <span className="pill subtle">{compliance.standards.secNumCloud.criteria.length}</span>
          </div>
          <p className="muted small">
            Les critères SecNumCloud sont classés par domaine et alimentés par les données opérationnelles.
          </p>
          <details style={{ marginTop: "12px" }}>
            <summary className="muted">
              Voir les {compliance.standards.secNumCloud.criteria.length} critères
            </summary>
            <div className="table-wrapper" style={{ marginTop: "12px" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Critère</th>
                    <th>Domaine</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {compliance.standards.secNumCloud.criteria.map((criterion) => (
                    <tr key={criterion.id}>
                      <td>{criterion.label}</td>
                      <td>{criterion.domain}</td>
                      <td>{renderStatusBadge(criterion.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>

      <div id="compliance-gaps" className="panel-grid" style={{ marginTop: "1.5rem" }}>
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Écarts</p>
              <h3>Points de vigilance</h3>
            </div>
            <span className="pill subtle">{compliance.gaps.length}</span>
          </div>
          {compliance.gaps.length === 0 ? (
            <p className="empty-state">Aucun écart détecté.</p>
          ) : (
            <>
              <ul className="checklist">
                {gapPreview.map((gap) => (
                  <li key={`${gap.standard}-${gap.id}`}>
                    <div className="stack" style={{ gap: "8px" }}>
                      <div className="stack horizontal" style={{ gap: "12px", alignItems: "center" }}>
                        {renderStatusBadge(gap.status)}
                        <strong>{gap.standard}</strong>
                      </div>
                      <span className="muted small">
                        {gap.id} — {gap.label}
                      </span>
                      <span className="muted small">{gap.recommendation}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {compliance.gaps.length > gapPreview.length && (
                <details style={{ marginTop: "12px" }}>
                  <summary className="muted">Voir tous les écarts</summary>
                  <div className="table-wrapper" style={{ marginTop: "12px" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Standard</th>
                          <th>Référence</th>
                          <th>Exigence</th>
                          <th>Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compliance.gaps.map((gap) => (
                          <tr key={`${gap.standard}-${gap.id}-full`}>
                            <td>{gap.standard}</td>
                            <td>{gap.id}</td>
                            <td>{gap.label}</td>
                            <td>{STATUS_LABELS[gap.status].label}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        <div id="compliance-exports" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Exports</p>
              <h3>Rapport d'audit</h3>
            </div>
          </div>
          <p className="muted">
            Exportez un rapport consolidé pour vos audits ISO 22301 et SecNumCloud.
          </p>
          <div className="stack horizontal" style={{ gap: "12px", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={handleExportPdf}>
              Export PDF
            </button>
            <button type="button" className="btn subtle" onClick={handleExportExcel}>
              Export Excel
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { SectionLayout } from "../components/ui/SectionLayout";
import type {
  FinancialComparisonResponse,
  FinancialProviderEstimate,
  FinancialScenarioEstimate,
  FinancialScenarioId,
} from "../types";
import { apiFetch } from "../utils/api";

interface FinancialSectionProps {
  configVersion: number;
}

const MONTHS = Array.from({ length: 37 }, (_, index) => index);

const PROVIDER_LABELS: Record<FinancialProviderEstimate["provider"], string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
};

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function buildOptimizations(estimate: FinancialProviderEstimate): string[] {
  const totalOpex = estimate.opexMonthly || 1;
  const computeShare = estimate.breakdown.compute / totalOpex;
  const storageShare = estimate.breakdown.storage / totalOpex;
  const suggestions: string[] = [];

  if (computeShare >= 0.45) {
    suggestions.push("RightSizing des instances et consolidation des charges.");
  }
  if (estimate.opexMonthly >= 5000) {
    suggestions.push("Réservations ou Savings Plans pour lisser l'OPEX mensuel.");
  }
  if (storageShare >= 0.4) {
    suggestions.push("Tiering et compression pour réduire le stockage chaud.");
  }
  if (estimate.breakdown.dataTransfer > estimate.breakdown.storage) {
    suggestions.push("Optimiser la réplication et le data transfer inter-région.");
  }

  if (suggestions.length === 0) {
    suggestions.push("Les coûts sont équilibrés : surveiller la croissance et revoir chaque trimestre.");
  }

  return suggestions;
}

function cumulativeCost(estimate: FinancialProviderEstimate, month: number) {
  return estimate.capex + estimate.opexMonthly * month;
}

export function FinancialSection({ configVersion }: FinancialSectionProps) {
  const [comparison, setComparison] = useState<FinancialComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instanceType, setInstanceType] = useState("m5.large");
  const [instanceCount, setInstanceCount] = useState(4);
  const [storageGb, setStorageGb] = useState(1200);
  const [dataTransferGb, setDataTransferGb] = useState(800);
  const [snapshotFrequencyPerDay, setSnapshotFrequencyPerDay] = useState(2);
  const [currency, setCurrency] = useState("EUR");
  const [awsRegion, setAwsRegion] = useState("eu-west-1");
  const [azureRegion, setAzureRegion] = useState("westeurope");
  const [gcpRegion, setGcpRegion] = useState("europe-west1");
  const [selectedScenario, setSelectedScenario] = useState<FinancialScenarioId | "">("");

  const fetchComparison = async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = {
        instanceType,
        instanceCount,
        storageGb,
        dataTransferGb,
        snapshotFrequencyPerDay,
        currency,
        awsRegion,
        azureRegion,
        gcpRegion,
      };
      const response = await apiFetch("/pricing/scenario-estimates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setComparison(response);
      if (response?.scenarios?.length && !selectedScenario) {
        setSelectedScenario(response.scenarios[0].scenarioId);
      }
    } catch (err: any) {
      setError(err.message || "Impossible de charger les estimations financières.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComparison();
  }, [configVersion]);

  const scenarios = comparison?.scenarios ?? [];
  const activeScenario: FinancialScenarioEstimate | undefined = scenarios.find(
    (scenario) => scenario.scenarioId === selectedScenario
  );

  const comparisonRows = useMemo(() => {
    if (!comparison) return [];
    return comparison.scenarios.flatMap((scenario) =>
      scenario.providers.map((provider) => ({
        scenario,
        provider,
      }))
    );
  }, [comparison]);

  const cumulativeChartOption = useMemo(() => {
    if (!activeScenario) return undefined;
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: number) => formatCurrency(value, activeScenario.providers[0]?.currency || "EUR"),
      },
      legend: {
        data: activeScenario.providers.map((provider) => PROVIDER_LABELS[provider.provider]),
      },
      xAxis: {
        type: "category",
        data: MONTHS.map((month) => `${month}m`),
      },
      yAxis: {
        type: "value",
      },
      series: activeScenario.providers.map((provider) => ({
        name: PROVIDER_LABELS[provider.provider],
        type: "line",
        smooth: true,
        data: MONTHS.map((month) => Math.round(cumulativeCost(provider, month))),
      })),
    };
  }, [activeScenario]);

  const suggestions = useMemo(() => {
    if (!activeScenario) return [];
    return activeScenario.providers.map((provider) => ({
      provider,
      tips: buildOptimizations(provider),
    }));
  }, [activeScenario]);

  return (
    <SectionLayout
      id="financial"
      title="Coûts"
      description="Comparez les coûts CAPEX/OPEX multi-cloud par scénario de reprise."
      badge={`${scenarios.length} scénarios`}
      progress={{ value: 40, label: "Modélisation en cours" }}
      whyThisStep="L'analyse financière permet de valider l'impact budgétaire des scénarios PRA et d'identifier les optimisations."
      quickLinks={[
        { label: "Paramètres", href: "#financial-params" },
        { label: "Comparatif", href: "#financial-comparison" },
      ]}
      tips={[
        "Ajustez les régions pour comparer les coûts inter-zones.",
        "Utilisez les suggestions d'optimisation pour réduire l'OPEX.",
      ]}
    >
      <div className="card" id="financial-params">
        <h3>Paramètres de calcul</h3>
        <p className="muted small">
          Ajustez la taille des instances, les volumes et la fréquence de snapshot. Utilisez des
          SKU compatibles selon le fournisseur.
        </p>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            fetchComparison();
          }}
        >
          <label className="form-field">
            <span>Instance type</span>
            <input value={instanceType} onChange={(e) => setInstanceType(e.target.value)} />
          </label>
          <label className="form-field">
            <span>Nombre d'instances</span>
            <input
              type="number"
              min={1}
              value={instanceCount}
              onChange={(e) => setInstanceCount(Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            <span>Stockage (Go)</span>
            <input
              type="number"
              min={0}
              value={storageGb}
              onChange={(e) => setStorageGb(Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            <span>Data transfer (Go)</span>
            <input
              type="number"
              min={0}
              value={dataTransferGb}
              onChange={(e) => setDataTransferGb(Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            <span>Snapshots / jour</span>
            <input
              type="number"
              min={0}
              value={snapshotFrequencyPerDay}
              onChange={(e) => setSnapshotFrequencyPerDay(Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            <span>Devise d'affichage</span>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </label>
          <label className="form-field">
            <span>Région AWS</span>
            <input value={awsRegion} onChange={(e) => setAwsRegion(e.target.value)} />
          </label>
          <label className="form-field">
            <span>Région Azure</span>
            <input value={azureRegion} onChange={(e) => setAzureRegion(e.target.value)} />
          </label>
          <label className="form-field">
            <span>Région GCP</span>
            <input value={gcpRegion} onChange={(e) => setGcpRegion(e.target.value)} />
          </label>
          <div className="form-field" style={{ alignSelf: "flex-end" }}>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Calcul en cours..." : "Actualiser"}
            </button>
          </div>
        </form>
        {error && <p className="helper error">{error}</p>}
      </div>

      <div className="card">
        <h3>Tableau comparatif CAPEX/OPEX</h3>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Scénario</th>
                <th>Fournisseur</th>
                <th className="numeric">CAPEX</th>
                <th className="numeric">OPEX mensuel</th>
                <th className="numeric">Coût 36 mois</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    Aucun résultat disponible.
                  </td>
                </tr>
              ) : (
                comparisonRows.map(({ scenario, provider }) => (
                  <tr key={`${scenario.scenarioId}-${provider.provider}`}>
                    <td>
                      <div className="stack">
                        <span className="service-name">{scenario.scenarioLabel}</span>
                        <span className="muted small">{scenario.scenarioDescription}</span>
                      </div>
                    </td>
                    <td>{PROVIDER_LABELS[provider.provider]}</td>
                    <td className="numeric">{formatCurrency(provider.capex, provider.currency)}</td>
                    <td className="numeric">
                      {formatCurrency(provider.opexMonthly, provider.currency)}
                    </td>
                    <td className="numeric">
                      {formatCurrency(cumulativeCost(provider, 36), provider.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="stack horizontal" style={{ justifyContent: "space-between", gap: "16px" }}>
          <div>
            <h3>Coût cumulatif</h3>
            <p className="muted small">Projection sur 36 mois (CAPEX + OPEX mensuel).</p>
          </div>
          <label className="form-field" style={{ minWidth: "240px" }}>
            <span>Scénario analysé</span>
            <select
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value as FinancialScenarioId)}
            >
              {scenarios.map((scenario) => (
                <option key={scenario.scenarioId} value={scenario.scenarioId}>
                  {scenario.scenarioLabel}
                </option>
              ))}
            </select>
          </label>
        </div>
        {cumulativeChartOption ? (
          <ReactECharts option={cumulativeChartOption} style={{ height: 320 }} />
        ) : (
          <p className="muted">Aucune donnée disponible pour le graphique.</p>
        )}
      </div>

      <div className="card">
        <h3>Suggestions d'optimisation</h3>
        <div className="stack">
          {suggestions.length === 0 ? (
            <p className="muted">Aucune suggestion disponible.</p>
          ) : (
            suggestions.map(({ provider, tips }) => (
              <div key={provider.provider} className="card" style={{ margin: 0 }}>
                <h4>{PROVIDER_LABELS[provider.provider]}</h4>
                <ul>
                  {tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </SectionLayout>
  );
}

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ScenarioFront, Service } from "../types";
import { apiFetch } from "../utils/api";

interface ScenariosSectionProps {
  configVersion: number;
}

const defaultScenarioPayload = {
  name: "",
  type: "REGION_LOSS",
  impactLevel: "high",
  rtoTargetHours: 24,
  selectedServiceIds: [] as string[],
};

export function ScenariosSection({ configVersion }: ScenariosSectionProps) {
  const [scenarios, setScenarios] = useState<ScenarioFront[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newScenario, setNewScenario] = useState({ ...defaultScenarioPayload });

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
  }, [configVersion]);

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

  const handleCreate = async (e: FormEvent) => {
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
      setNewScenario({ ...defaultScenarioPayload });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="skeleton">Chargement des scénarios...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  return (
    <section id="scenarios-panel" className="panel" aria-labelledby="scenarios-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Runbooks</p>
          <h2 id="scenarios-title">Scénarios PRA &amp; runbooks</h2>
          <p className="muted">
            Modélisation des scénarios de sinistre (perte AZ, région, corruption DB, perte AD...) et des étapes de reprise.
          </p>
        </div>
        <div className="badge subtle">{scenarios.length} scénarios</div>
      </div>

      <form className="card form-grid" onSubmit={handleCreate}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Nom du scénario</span>
            <input
              type="text"
              value={newScenario.name}
              onChange={(e) => setNewScenario((s) => ({ ...s, name: e.target.value }))}
              required
            />
          </label>
          <label className="form-field">
            <span>Type</span>
            <select
              value={newScenario.type}
              onChange={(e) => setNewScenario((s) => ({ ...s, type: e.target.value }))}
            >
              <option value="REGION_LOSS">Perte région</option>
              <option value="AZ_LOSS">Perte AZ</option>
              <option value="DC_LOSS">Perte DC on-prem</option>
              <option value="DB_CORRUPTION">Corruption base de données</option>
              <option value="RANSOMWARE">Ransomware</option>
              <option value="AD_FAILURE">Perte Active Directory</option>
            </select>
          </label>
          <label className="form-field">
            <span>Impact</span>
            <select
              value={newScenario.impactLevel}
              onChange={(e) => setNewScenario((s) => ({ ...s, impactLevel: e.target.value }))}
            >
              <option value="low">Faible</option>
              <option value="medium">Moyen</option>
              <option value="high">Fort</option>
            </select>
          </label>
          <label className="form-field">
            <span>RTO cible global (h)</span>
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
            />
          </label>
          <div className="form-field" style={{ gridColumn: "span 2" }}>
            <span>Services impactés</span>
            <div className="service-selector">
              {services.length === 0 ? (
                <div className="empty-state">Aucun service défini pour ce tenant.</div>
              ) : (
                services.map((service) => (
                  <label key={service.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={newScenario.selectedServiceIds.includes(service.id)}
                      onChange={() => toggleServiceSelection(service.id)}
                    />
                    <span>
                      {service.name} <span className="muted">({service.type}, {service.criticality})</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={creating}>
            {creating ? "Création..." : "Créer le scénario"}
          </button>
          {createError && <p className="helper error">{createError}</p>}
        </div>
      </form>

      {scenarios.length === 0 ? (
        <p className="empty-state">Aucun scénario défini pour le moment.</p>
      ) : (
        <div className="stack" style={{ gap: "16px" }}>
          {scenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} onUpdated={loadData} />
          ))}
        </div>
      )}
    </section>
  );
}

interface ScenarioCardProps {
  scenario: ScenarioFront;
  onUpdated: () => void;
}

function ScenarioCard({ scenario, onUpdated }: ScenarioCardProps) {
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
    (sum, step) => sum + (step.estimatedDurationMinutes ?? 0),
    0
  );

  const handleAddStep = async (e: FormEvent) => {
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

  const impactColorClass = `impact-${scenario.impactLevel ?? "unknown"}`;

  return (
    <article className="card scenario-card">
      <header className="scenario-header">
        <div>
          <h3>{scenario.name}</h3>
          <p className="muted">
            Type : {scenario.type} • Impact : <span className={`pill pill-inline ${impactColorClass}`}>{impactLabel}</span>{" "}
            {scenario.rtoTargetHours != null && <>• RTO cible : {scenario.rtoTargetHours} h</>}
          </p>
          <p className="muted small">
            Services impactés :
            {scenario.services.length === 0
              ? " aucun"
              : ` ${scenario.services
                  .map((service) => `${service.service.name} (${service.service.criticality})`)
                  .join(", ")}`}
          </p>
        </div>
        <div className="scenario-meta">
          <span className="pill subtle">Étapes : {scenario.steps.length}</span>
          <span className="pill subtle">Durée estimée : ~{totalDuration} min</span>
        </div>
      </header>

      <div className="table-wrapper">
        {scenario.steps.length === 0 ? (
          <div className="empty-state">Aucune étape définie pour ce scénario.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Ordre</th>
                <th>Étape</th>
                <th>Rôle</th>
                <th>Durée (min)</th>
                <th>Bloquant</th>
              </tr>
            </thead>
            <tbody>
              {scenario.steps.map((step) => (
                <tr key={step.id}>
                  <td className="numeric">{step.order}</td>
                  <td>
                    <div className="stack">
                      <span className="service-name">{step.title}</span>
                      {step.description && <span className="muted small">{step.description}</span>}
                    </div>
                  </td>
                  <td>{step.role ?? "-"}</td>
                  <td className="numeric">{step.estimatedDurationMinutes ?? "-"}</td>
                  <td>{step.blocking ? "Oui" : "Non"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="form-grid" onSubmit={handleAddStep}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Ordre</span>
            <input
              type="number"
              min={1}
              value={newStep.order}
              onChange={(e) => setNewStep((s) => ({ ...s, order: Number(e.target.value) }))}
            />
          </label>
          <label className="form-field">
            <span>Titre de l'étape</span>
            <input
              type="text"
              value={newStep.title}
              onChange={(e) => setNewStep((s) => ({ ...s, title: e.target.value }))}
              required
            />
          </label>
          <label className="form-field">
            <span>Rôle</span>
            <input
              type="text"
              value={newStep.role}
              onChange={(e) => setNewStep((s) => ({ ...s, role: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Durée estimée (min)</span>
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
            />
          </label>
          <label className="form-field checkbox">
            <span>Bloquant ?</span>
            <input
              type="checkbox"
              checked={newStep.blocking}
              onChange={(e) => setNewStep((s) => ({ ...s, blocking: e.target.checked }))}
            />
          </label>
          <label className="form-field" style={{ gridColumn: "span 2" }}>
            <span>Description</span>
            <input
              type="text"
              value={newStep.description}
              onChange={(e) => setNewStep((s) => ({ ...s, description: e.target.value }))}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit" disabled={addingStep}>
            {addingStep ? "Ajout..." : "Ajouter l'étape"}
          </button>
          {stepError && <p className="helper error">{stepError}</p>}
        </div>
      </form>
    </article>
  );
}

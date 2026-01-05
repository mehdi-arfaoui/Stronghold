import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
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

  const progressSteps = [
    scenarios.length > 0,
    scenarios.some((scenario) => scenario.services.length > 0),
    scenarios.some((scenario) => scenario.steps.length > 0),
  ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

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

      <PageIntro
        title="Construire les scénarios PRA"
        objective="Structurer les scénarios de sinistre pour guider la génération de runbooks et la priorisation."
        steps={[
          "Créer un scénario et définir l'impact",
          "Associer les services concernés",
          "Décrire les étapes de reprise",
        ]}
        tips={[
          "Indiquez la cible RTO pour prioriser les scénarios.",
          "Ajoutez les services critiques dès la création.",
          "Ordonnez les étapes pour guider la génération des runbooks.",
        ]}
        links={[
          { label: "Créer un scénario", href: "#scenarios-create", description: "Formulaire" },
          { label: "Sélectionner les services", href: "#scenarios-services", description: "Checklist" },
          { label: "Consulter les scénarios", href: "#scenarios-list", description: "Historique" },
        ]}
        expectedData={[
          "Nom + type de scénario",
          "Services impactés et cible RTO",
          "Étapes de runbook associées",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <form id="scenarios-create" className="card form-grid" onSubmit={handleCreate}>
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
          <div id="scenarios-services" className="form-field" style={{ gridColumn: "span 2" }}>
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
        <div id="scenarios-list" className="stack" style={{ gap: "16px" }}>
          {scenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              services={services}
              onUpdated={loadData}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface ScenarioCardProps {
  scenario: ScenarioFront;
  services: Service[];
  onUpdated: () => void;
}

function ScenarioCard({ scenario, services, onUpdated }: ScenarioCardProps) {
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
  const [editingScenario, setEditingScenario] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [updatingScenario, setUpdatingScenario] = useState(false);
  const [editScenario, setEditScenario] = useState({
    name: scenario.name,
    type: scenario.type,
    impactLevel: scenario.impactLevel ?? "medium",
    rtoTargetHours: scenario.rtoTargetHours ?? 0,
    selectedServiceIds: scenario.services.map((s) => s.service.id),
  });
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editStep, setEditStep] = useState({
    order: 1,
    title: "",
    estimatedDurationMinutes: 30,
    role: "",
    blocking: false,
    description: "",
  });
  const [updatingStep, setUpdatingStep] = useState(false);

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

  const handleScenarioEdit = () => {
    setEditingScenario(true);
    setScenarioError(null);
    setEditScenario({
      name: scenario.name,
      type: scenario.type,
      impactLevel: scenario.impactLevel ?? "medium",
      rtoTargetHours: scenario.rtoTargetHours ?? 0,
      selectedServiceIds: scenario.services.map((s) => s.service.id),
    });
  };

  const toggleScenarioService = (id: string) => {
    setEditScenario((prev) => {
      const exists = prev.selectedServiceIds.includes(id);
      return {
        ...prev,
        selectedServiceIds: exists
          ? prev.selectedServiceIds.filter((s) => s !== id)
          : [...prev.selectedServiceIds, id],
      };
    });
  };

  const handleScenarioUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setUpdatingScenario(true);
    setScenarioError(null);
    try {
      await apiFetch(`/scenarios/${scenario.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editScenario.name,
          type: editScenario.type,
          impactLevel: editScenario.impactLevel,
          rtoTargetHours: editScenario.rtoTargetHours,
          serviceIds: editScenario.selectedServiceIds,
        }),
      });
      await onUpdated();
      setEditingScenario(false);
    } catch (err: any) {
      setScenarioError(err.message || "Erreur lors de la mise à jour");
    } finally {
      setUpdatingScenario(false);
    }
  };

  const handleScenarioDelete = async () => {
    const confirmed = window.confirm("Supprimer ce scénario ?");
    if (!confirmed) return;
    setScenarioError(null);
    try {
      await apiFetch(`/scenarios/${scenario.id}`, { method: "DELETE" });
      await onUpdated();
    } catch (err: any) {
      setScenarioError(err.message || "Erreur lors de la suppression");
    }
  };

  const startEditStep = (stepId: string) => {
    const step = scenario.steps.find((s) => s.id === stepId);
    if (!step) return;
    setEditingStepId(stepId);
    setEditStep({
      order: step.order,
      title: step.title,
      estimatedDurationMinutes: step.estimatedDurationMinutes ?? 0,
      role: step.role ?? "",
      blocking: step.blocking,
      description: step.description ?? "",
    });
    setStepError(null);
  };

  const handleStepUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingStepId) return;
    setUpdatingStep(true);
    setStepError(null);
    try {
      await apiFetch(`/scenarios/${scenario.id}/steps/${editingStepId}`, {
        method: "PUT",
        body: JSON.stringify({
          order: editStep.order,
          title: editStep.title,
          estimatedDurationMinutes: editStep.estimatedDurationMinutes,
          role: editStep.role,
          blocking: editStep.blocking,
          description: editStep.description,
        }),
      });
      await onUpdated();
      setEditingStepId(null);
    } catch (err: any) {
      setStepError(err.message || "Erreur lors de la mise à jour");
    } finally {
      setUpdatingStep(false);
    }
  };

  const handleStepDelete = async (stepId: string) => {
    const confirmed = window.confirm("Supprimer cette étape ?");
    if (!confirmed) return;
    setStepError(null);
    try {
      await apiFetch(`/scenarios/${scenario.id}/steps/${stepId}`, { method: "DELETE" });
      await onUpdated();
    } catch (err: any) {
      setStepError(err.message || "Erreur lors de la suppression");
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
          <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
            <button className="btn ghost" onClick={handleScenarioEdit}>
              Modifier
            </button>
            <button className="btn" onClick={handleScenarioDelete}>
              Supprimer
            </button>
          </div>
        </div>
      </header>
      {scenarioError && <p className="helper error">{scenarioError}</p>}

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
                <th>Actions</th>
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
                  <td>
                    <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
                      <button className="btn ghost" onClick={() => startEditStep(step.id)}>
                        Modifier
                      </button>
                      <button className="btn" onClick={() => handleStepDelete(step.id)}>
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingScenario && (
        <form className="form-grid" onSubmit={handleScenarioUpdate}>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <label className="form-field">
              <span>Nom du scénario</span>
              <input
                type="text"
                value={editScenario.name}
                onChange={(e) => setEditScenario((s) => ({ ...s, name: e.target.value }))}
                required
              />
            </label>
            <label className="form-field">
              <span>Type</span>
              <select
                value={editScenario.type}
                onChange={(e) => setEditScenario((s) => ({ ...s, type: e.target.value }))}
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
                value={editScenario.impactLevel}
                onChange={(e) =>
                  setEditScenario((s) => ({ ...s, impactLevel: e.target.value }))
                }
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
                value={editScenario.rtoTargetHours}
                onChange={(e) =>
                  setEditScenario((s) => ({
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
                        checked={editScenario.selectedServiceIds.includes(service.id)}
                        onChange={() => toggleScenarioService(service.id)}
                      />
                      <span>
                        {service.name}{" "}
                        <span className="muted">
                          ({service.type}, {service.criticality})
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="form-actions">
            <div className="stack horizontal" style={{ gap: "8px", alignItems: "center" }}>
              <button className="btn primary" type="submit" disabled={updatingScenario}>
                {updatingScenario ? "Mise à jour..." : "Enregistrer"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setEditingScenario(false)}
                disabled={updatingScenario}
              >
                Annuler
              </button>
            </div>
            {scenarioError && <p className="helper error">{scenarioError}</p>}
          </div>
        </form>
      )}

      {editingStepId && (
        <form className="form-grid" onSubmit={handleStepUpdate}>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <label className="form-field">
              <span>Ordre</span>
              <input
                type="number"
                min={1}
                value={editStep.order}
                onChange={(e) => setEditStep((s) => ({ ...s, order: Number(e.target.value) }))}
              />
            </label>
            <label className="form-field">
              <span>Titre de l'étape</span>
              <input
                type="text"
                value={editStep.title}
                onChange={(e) => setEditStep((s) => ({ ...s, title: e.target.value }))}
                required
              />
            </label>
            <label className="form-field">
              <span>Rôle</span>
              <input
                type="text"
                value={editStep.role}
                onChange={(e) => setEditStep((s) => ({ ...s, role: e.target.value }))}
              />
            </label>
            <label className="form-field">
              <span>Durée estimée (min)</span>
              <input
                type="number"
                min={0}
                value={editStep.estimatedDurationMinutes}
                onChange={(e) =>
                  setEditStep((s) => ({
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
                checked={editStep.blocking}
                onChange={(e) => setEditStep((s) => ({ ...s, blocking: e.target.checked }))}
              />
            </label>
            <label className="form-field" style={{ gridColumn: "span 2" }}>
              <span>Description</span>
              <input
                type="text"
                value={editStep.description}
                onChange={(e) => setEditStep((s) => ({ ...s, description: e.target.value }))}
              />
            </label>
          </div>
          <div className="form-actions">
            <div className="stack horizontal" style={{ gap: "8px", alignItems: "center" }}>
              <button className="btn" type="submit" disabled={updatingStep}>
                {updatingStep ? "Mise à jour..." : "Enregistrer l'étape"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setEditingStepId(null)}
                disabled={updatingStep}
              >
                Annuler
              </button>
            </div>
            {stepError && <p className="helper error">{stepError}</p>}
          </div>
        </form>
      )}

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

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import type { PaginatedResponse, Risk, RiskMatrixResponse, Service } from "../types";
import { apiFetch } from "../utils/api";

interface RisksSectionProps {
  configVersion: number;
}

const THREAT_TYPES = [
  { value: "cyber", label: "Cyber" },
  { value: "physical", label: "Physique" },
  { value: "supplier", label: "Fournisseur" },
  { value: "human", label: "Humaine" },
  { value: "operational", label: "Opérationnelle" },
  { value: "environmental", label: "Environnement" },
  { value: "compliance", label: "Conformité" },
];

const STATUS_VALUES = [
  { value: "open", label: "Ouvert" },
  { value: "mitigating", label: "En mitigation" },
  { value: "accepted", label: "Accepté" },
  { value: "closed", label: "Clos" },
];

const PAGE_SIZE = 20;

const defaultRiskDraft = {
  title: "",
  threatType: "cyber",
  probability: 3,
  impact: 3,
  status: "open",
  owner: "",
  description: "",
  serviceId: "",
  processName: "",
  mitigationsText: "",
};

export function RisksSection({ configVersion }: RisksSectionProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [totalRisks, setTotalRisks] = useState(0);
  const [matrix, setMatrix] = useState<RiskMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...defaultRiskDraft });
  const [mitigationDrafts, setMitigationDrafts] = useState<Record<string, string>>({});
  const [mitigationError, setMitigationError] = useState<string | null>(null);

  const loadRisks = async (offset = 0, append = false) => {
    const data = (await apiFetch(
      `/risks?limit=${PAGE_SIZE}&offset=${offset}`
    )) as PaginatedResponse<Risk> | Risk[];
    const items = Array.isArray(data) ? data : data.items;
    const total = Array.isArray(data) ? data.length : data.total;
    setRisks((current) => (append ? [...current, ...items] : items));
    setTotalRisks(total);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      setLoadMoreError(null);
      const [servicesData, matrixData] = await Promise.all([
        apiFetch("/services"),
        apiFetch("/risks/matrix"),
      ]);
      setServices(servicesData);
      setMatrix(matrixData);
      await loadRisks(0, false);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [configVersion]);

  useEffect(() => {
    setDraft((current) => {
      if (!current.serviceId && services.length > 0) {
        return { ...current, serviceId: services[0].id };
      }
      return current;
    });
  }, [services]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const mitigations = draft.mitigationsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((description) => ({ description }));

      await apiFetch("/risks", {
        method: "POST",
        body: JSON.stringify({
          title: draft.title,
          threatType: draft.threatType,
          probability: draft.probability,
          impact: draft.impact,
          status: draft.status,
          owner: draft.owner || null,
          description: draft.description || null,
          serviceId: draft.serviceId || null,
          processName: draft.processName || null,
          mitigations: mitigations.length > 0 ? mitigations : undefined,
        }),
      });
      await loadData();
      setDraft({ ...defaultRiskDraft, serviceId: services[0]?.id ?? "" });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  const handleMitigationSubmit = async (riskId: string, event: FormEvent) => {
    event.preventDefault();
    setMitigationError(null);
    const description = mitigationDrafts[riskId]?.trim();
    if (!description) {
      setMitigationError("La mesure de mitigation ne peut pas être vide.");
      return;
    }
    try {
      await apiFetch(`/risks/${riskId}/mitigations`, {
        method: "POST",
        body: JSON.stringify({ description }),
      });
      setMitigationDrafts((current) => ({ ...current, [riskId]: "" }));
      await loadData();
    } catch (err: any) {
      setMitigationError(err.message || "Erreur lors de l'ajout de mitigation");
    }
  };

  const matrixLookup = useMemo(() => {
    if (!matrix) return new Map<string, RiskMatrixResponse["cells"][number]>();
    return new Map(matrix.cells.map((cell) => [`${cell.probability}:${cell.impact}`, cell]));
  }, [matrix]);

  const groupedRisks = useMemo(() => {
    const groups = new Map<string, Risk[]>();
    risks.forEach((risk) => {
      const key =
        risk.service?.name || risk.processName || "Sans service / processus";
      const group = groups.get(key) || [];
      group.push(risk);
      groups.set(key, group);
    });
    return Array.from(groups.entries());
  }, [risks]);

  const progressValue = Math.min(100, totalRisks * 10);

  if (loading) {
    return <div className="panel">Chargement des risques...</div>;
  }

  if (error) {
    return <div className="panel alert error">{error}</div>;
  }

  return (
    <>
      <PageIntro
        title="Évaluation et gestion des risques"
        objective="Structurer les menaces, calculer un score (probabilité × impact) et suivre les mesures de mitigation par service ou processus."
        steps={[
          "Décrire la menace et le périmètre",
          "Attribuer une probabilité et un impact",
          "Évaluer la matrice et prioriser",
          "Suivre les mitigations associées",
        ]}
        tips={[
          "Utilisez une probabilité réaliste basée sur l'historique d'incidents.",
          "Assignez un owner pour chaque risque critique.",
          "Consignez les mitigations dès la création du risque.",
        ]}
        links={[
          { label: "Catalogue des services", href: "#services-panel" },
          { label: "Analyse PRA", href: "#analysis-panel" },
        ]}
        expectedData={[
          "Menaces classées par type",
          "Probabilité & impact (1-5)",
          "Mesures de mitigation suivies",
          "Matrice des risques consolidée",
        ]}
        progress={{
          value: progressValue,
          label: `${totalRisks} risques recensés`,
        }}
      />

      <section className="panel" id="risk-form">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Saisie</p>
            <h3 className="section-title">Ajouter un risque</h3>
            <p className="muted">Documentez la menace, le score et les premières mitigations.</p>
          </div>
        </div>
        <form className="form-grid" onSubmit={handleCreate}>
          <label className="form-field">
            <span>Titre du risque</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Ex: attaque ransomware sur l'ERP"
              required
            />
          </label>
          <label className="form-field">
            <span>Type de menace</span>
            <select
              value={draft.threatType}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, threatType: event.target.value }))
              }
            >
              {THREAT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Service associé</span>
            <select
              value={draft.serviceId}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, serviceId: event.target.value }))
              }
            >
              <option value="">Aucun</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Processus</span>
            <input
              value={draft.processName}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, processName: event.target.value }))
              }
              placeholder="Ex: facturation mensuelle"
            />
          </label>
          <label className="form-field">
            <span>Probabilité (1-5)</span>
            <input
              type="number"
              min={1}
              max={5}
              value={draft.probability}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, probability: Number(event.target.value) }))
              }
              required
            />
          </label>
          <label className="form-field">
            <span>Impact (1-5)</span>
            <input
              type="number"
              min={1}
              max={5}
              value={draft.impact}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, impact: Number(event.target.value) }))
              }
              required
            />
          </label>
          <label className="form-field">
            <span>Statut</span>
            <select
              value={draft.status}
              onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
            >
              {STATUS_VALUES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Responsable</span>
            <input
              value={draft.owner}
              onChange={(event) => setDraft((prev) => ({ ...prev, owner: event.target.value }))}
              placeholder="Equipe sécurité"
            />
          </label>
          <label className="form-field">
            <span>Description</span>
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="Contexte, sources, hypothèses"
              rows={3}
            />
          </label>
          <label className="form-field">
            <span>Mesures de mitigation (une par ligne)</span>
            <textarea
              value={draft.mitigationsText}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, mitigationsText: event.target.value }))
              }
              placeholder="Ex: Activer MFA obligatoire\nMettre en place un PRA secondaire"
              rows={3}
            />
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={creating}>
              {creating ? "Création..." : "Créer le risque"}
            </button>
            {createError && <span className="form-error">{createError}</span>}
          </div>
        </form>
      </section>

      <section className="panel" id="risk-matrix">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Scoring</p>
            <h3 className="section-title">Matrice des risques</h3>
            <p className="muted">Score = Probabilité × Impact</p>
          </div>
          <span className="pill subtle">{matrix?.totalRisks ?? 0} risques</span>
        </div>
        {matrix ? (
          <div className="table-wrapper">
            <table className="risk-matrix">
              <thead>
                <tr>
                  <th>Probabilité \ Impact</th>
                  {matrix.scale.impact.map((impact) => (
                    <th key={`impact-${impact}`}>I{impact}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...matrix.scale.probability].reverse().map((probability) => (
                  <tr key={`prob-${probability}`}>
                    <th>P{probability}</th>
                    {matrix.scale.impact.map((impact) => {
                      const cell = matrixLookup.get(`${probability}:${impact}`);
                      const count = cell?.count ?? 0;
                      const score = cell?.score ?? probability * impact;
                      return (
                        <td
                          key={`cell-${probability}-${impact}`}
                          className={`risk-cell ${cell?.level || "low"}`}
                        >
                          <div className="risk-cell-score">{score}</div>
                          <div className="risk-cell-count">{count} risque(s)</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Aucune donnée de matrice disponible.</p>
        )}
      </section>

      <section className="panel" id="risk-list">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Suivi</p>
            <h3 className="section-title">Risques par service / processus</h3>
            <p className="muted">Retrouvez chaque risque, son score et les mitigations associées.</p>
          </div>
        </div>
        {mitigationError && <div className="alert error">{mitigationError}</div>}
        {groupedRisks.length === 0 ? (
          <p className="muted">Aucun risque enregistré.</p>
        ) : (
          <>
            {groupedRisks.map(([groupLabel, groupRisks]) => (
              <div key={groupLabel} className="risk-group">
                <h4>{groupLabel}</h4>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Risque</th>
                        <th>Type</th>
                        <th>Score</th>
                        <th>Statut</th>
                        <th>Mitigations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRisks.map((risk) => (
                        <tr key={risk.id}>
                          <td>
                            <div className="risk-title">{risk.title}</div>
                            {risk.description && (
                              <div className="muted small">{risk.description}</div>
                            )}
                          </td>
                          <td>{risk.threatType}</td>
                          <td>
                            <span className={`pill ${risk.level}`}>{risk.score}</span>
                          </td>
                          <td>{risk.status || "--"}</td>
                          <td>
                            {risk.mitigations.length > 0 ? (
                              <ul className="risk-mitigations">
                                {risk.mitigations.map((mitigation) => (
                                  <li key={mitigation.id}>{mitigation.description}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="muted">Aucune mitigation</span>
                            )}
                            <form
                              className="risk-mitigation-form"
                              onSubmit={(event) => handleMitigationSubmit(risk.id, event)}
                            >
                              <input
                                value={mitigationDrafts[risk.id] || ""}
                                onChange={(event) =>
                                  setMitigationDrafts((current) => ({
                                    ...current,
                                    [risk.id]: event.target.value,
                                  }))
                                }
                                placeholder="Ajouter une mitigation"
                              />
                              <button className="btn subtle" type="submit">
                                Ajouter
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {totalRisks > risks.length && (
              <div className="form-actions" style={{ justifyContent: "center" }}>
                <button
                  className="btn"
                  type="button"
                  disabled={loadingMore}
                  onClick={async () => {
                    setLoadingMore(true);
                    setLoadMoreError(null);
                    try {
                      await loadRisks(risks.length, true);
                    } catch (err: any) {
                      setLoadMoreError(err.message || "Erreur lors du chargement");
                    } finally {
                      setLoadingMore(false);
                    }
                  }}
                >
                  {loadingMore ? "Chargement..." : "Charger plus de risques"}
                </button>
                <span className="helper muted">
                  Affichés {risks.length} sur {totalRisks}
                </span>
                {loadMoreError && <span className="helper error">{loadMoreError}</span>}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

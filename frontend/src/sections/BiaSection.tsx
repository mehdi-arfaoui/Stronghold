import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import ReactECharts from "echarts-for-react";
import { PageIntro } from "../components/PageIntro";
import type { BusinessProcess, Service } from "../types";
import { apiFetch } from "../utils/api";

interface BiaSectionProps {
  configVersion: number;
}

type ProcessDraft = {
  name: string;
  description: string;
  owners: string;
  financialImpactLevel: number;
  regulatoryImpactLevel: number;
  interdependencies: string;
  rtoHours: number;
  rpoMinutes: number;
  mtpdHours: number;
  serviceIds: string[];
};

const impactLevels = [
  { value: 1, label: "1 - Faible" },
  { value: 2, label: "2 - Modéré" },
  { value: 3, label: "3 - Notable" },
  { value: 4, label: "4 - Élevé" },
  { value: 5, label: "5 - Critique" },
];

const defaultDraft: ProcessDraft = {
  name: "",
  description: "",
  owners: "",
  financialImpactLevel: 3,
  regulatoryImpactLevel: 3,
  interdependencies: "",
  rtoHours: 4,
  rpoMinutes: 60,
  mtpdHours: 24,
  serviceIds: [],
};

export function BiaSection({ configVersion }: BiaSectionProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [processes, setProcesses] = useState<BusinessProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProcessDraft>({ ...defaultDraft });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadBia = async () => {
    try {
      setLoading(true);
      setError(null);
      const [servicesData, processData] = await Promise.all([
        apiFetch("/services"),
        apiFetch("/bia/processes"),
      ]);
      setServices(servicesData);
      setProcesses(processData);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBia();
  }, [configVersion]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/bia/processes", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          description: draft.description || null,
          owners: draft.owners || null,
          financialImpactLevel: draft.financialImpactLevel,
          regulatoryImpactLevel: draft.regulatoryImpactLevel,
          interdependencies: draft.interdependencies || null,
          rtoHours: draft.rtoHours,
          rpoMinutes: draft.rpoMinutes,
          mtpdHours: draft.mtpdHours,
          serviceIds: draft.serviceIds,
        }),
      });
      await loadBia();
      setDraft({ ...defaultDraft });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  const criticalProcesses = processes.filter(
    (process) => process.criticalityScore >= 4 || process.impactScore >= 4
  );

  const impactMatrix = useMemo(() => {
    if (processes.length === 0) return null;
    const buckets = new Map<string, BusinessProcess[]>();
    const clampScore = (score: number) => {
      const rounded = Math.round(score);
      return Math.min(5, Math.max(1, rounded));
    };

    processes.forEach((process) => {
      const impact = clampScore(process.impactScore);
      const criticality = clampScore(process.criticalityScore);
      const key = `${impact}:${criticality}`;
      const existing = buckets.get(key) ?? [];
      existing.push(process);
      buckets.set(key, existing);
    });

    const data: Array<[number, number, number]> = [];
    const cellLookup = new Map<string, BusinessProcess[]>();
    for (let impact = 1; impact <= 5; impact += 1) {
      for (let criticality = 1; criticality <= 5; criticality += 1) {
        const key = `${impact}:${criticality}`;
        const processesInCell = buckets.get(key) ?? [];
        data.push([impact - 1, criticality - 1, processesInCell.length]);
        if (processesInCell.length > 0) {
          cellLookup.set(`${impact - 1}:${criticality - 1}`, processesInCell);
        }
      }
    }

    const maxValue = Math.max(...data.map((entry) => entry[2]), 1);

    return {
      tooltip: {
        formatter: (params: any) => {
          const processesInCell = cellLookup.get(`${params.data[0]}:${params.data[1]}`) ?? [];
          if (processesInCell.length === 0) {
            return "Aucun processus";
          }
          const labels = processesInCell.slice(0, 5).map((process) => process.name);
          const moreCount = processesInCell.length - labels.length;
          return `
            <strong>${processesInCell.length} processus</strong><br/>
            ${labels.join("<br/>")}
            ${moreCount > 0 ? `<br/>+${moreCount} autres` : ""}
          `;
        },
      },
      grid: { left: 50, right: 20, top: 30, bottom: 40, containLabel: true },
      xAxis: {
        type: "category",
        data: ["1", "2", "3", "4", "5"],
        name: "Impact",
        nameLocation: "middle",
        nameGap: 30,
        splitArea: { show: true },
      },
      yAxis: {
        type: "category",
        data: ["1", "2", "3", "4", "5"],
        name: "Criticité",
        nameLocation: "middle",
        nameGap: 35,
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: maxValue,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
      },
      series: [
        {
          type: "heatmap",
          data,
          label: { show: true },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.3)",
            },
          },
        },
      ],
    };
  }, [processes]);

  if (loading) {
    return <div className="skeleton">Chargement des analyses BIA...</div>;
  }

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  const progressSteps = [processes.length > 0, services.length > 0];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <>
      <PageIntro
        title="Business Impact Analysis"
        subtitle="Décrivez vos processus métiers, leurs impacts et les interdépendances pour prioriser la continuité."
        objective="Structurer le BIA, calculer l'impact/criticité et lier les processus aux services."
        steps={[
          "Renseigner les informations métiers et RTO/RPO/MTPD",
          "Associer les services critiques",
          "Analyser la matrice d'impact",
        ]}
        links={[
          { label: "Créer un processus", href: "#bia-form", description: "Formulaire" },
          { label: "Consulter le tableau", href: "#bia-table", description: "Table" },
          { label: "Matrice d'impact", href: "#bia-matrix", description: "Graphique" },
        ]}
        expectedData={[
          "Impacts financiers/réglementaires",
          "RTO/RPO/MTPD par processus",
          "Lien avec les services/applications",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <form id="bia-form" className="card form-grid" onSubmit={handleCreate}>
        <div className="card-header" style={{ gridColumn: "1 / -1" }}>
          <div>
            <p className="eyebrow">Processus métier</p>
            <h3>Nouveau processus BIA</h3>
          </div>
        </div>

        <label className="form-field">
          <span>Nom du processus</span>
          <input
            type="text"
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Traitement des paiements"
            required
          />
        </label>

        <label className="form-field">
          <span>Propriétaires</span>
          <input
            type="text"
            value={draft.owners}
            onChange={(event) => setDraft((prev) => ({ ...prev, owners: event.target.value }))}
            placeholder="Direction financière, DSI"
          />
        </label>

        <label className="form-field" style={{ gridColumn: "1 / -1" }}>
          <span>Description</span>
          <textarea
            value={draft.description}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, description: event.target.value }))
            }
            rows={3}
          />
        </label>

        <label className="form-field">
          <span>Impact financier</span>
          <select
            value={draft.financialImpactLevel}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                financialImpactLevel: Number(event.target.value),
              }))
            }
          >
            {impactLevels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Impact réglementaire</span>
          <select
            value={draft.regulatoryImpactLevel}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                regulatoryImpactLevel: Number(event.target.value),
              }))
            }
          >
            {impactLevels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>RTO (heures)</span>
          <input
            type="number"
            min={0}
            value={draft.rtoHours}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, rtoHours: Number(event.target.value) }))
            }
          />
        </label>

        <label className="form-field">
          <span>RPO (minutes)</span>
          <input
            type="number"
            min={0}
            value={draft.rpoMinutes}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, rpoMinutes: Number(event.target.value) }))
            }
          />
        </label>

        <label className="form-field">
          <span>MTPD (heures)</span>
          <input
            type="number"
            min={0}
            value={draft.mtpdHours}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, mtpdHours: Number(event.target.value) }))
            }
          />
        </label>

        <label className="form-field" style={{ gridColumn: "1 / -1" }}>
          <span>Interdépendances</span>
          <textarea
            value={draft.interdependencies}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, interdependencies: event.target.value }))
            }
            rows={2}
            placeholder="Flux entre agences, interfaces partenaires, etc."
          />
        </label>

        <label className="form-field" style={{ gridColumn: "1 / -1" }}>
          <span>Services / applications concernés</span>
          <select
            multiple
            value={draft.serviceIds}
            onChange={(event) => {
              const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
              setDraft((prev) => ({ ...prev, serviceIds: selected }));
            }}
          >
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} ({service.criticality})
              </option>
            ))}
          </select>
          <p className="helper">Maintenez Ctrl/Cmd pour sélectionner plusieurs services.</p>
        </label>

        {createError && (
          <div className="alert error" style={{ gridColumn: "1 / -1" }}>
            {createError}
          </div>
        )}

        <div className="form-field" style={{ gridColumn: "1 / -1" }}>
          <button className="button primary" type="submit" disabled={creating}>
            {creating ? "Création..." : "Enregistrer le processus"}
          </button>
        </div>
      </form>

      <div id="bia-table" className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <div>
            <p className="eyebrow">Synthèse</p>
            <h3>Processus & scores</h3>
          </div>
          <div className="badge subtle">{processes.length} processus</div>
        </div>
        {processes.length === 0 ? (
          <p className="muted">Ajoutez un premier processus pour afficher la synthèse.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Processus</th>
                  <th>Impacts</th>
                  <th>RTO/RPO/MTPD</th>
                  <th>Scores</th>
                  <th>Services liés</th>
                </tr>
              </thead>
              <tbody>
                {processes.map((process) => (
                  <tr key={process.id}>
                    <td>
                      <strong>{process.name}</strong>
                      {process.description && <p className="muted">{process.description}</p>}
                    </td>
                    <td>
                      Financier: {process.financialImpactLevel}
                      <br />
                      Réglementaire: {process.regulatoryImpactLevel}
                    </td>
                    <td>
                      RTO {process.rtoHours}h
                      <br />
                      RPO {process.rpoMinutes} min
                      <br />
                      MTPD {process.mtpdHours}h
                    </td>
                    <td>
                      Impact {process.impactScore.toFixed(2)}
                      <br />
                      Criticité {process.criticalityScore.toFixed(2)}
                    </td>
                    <td>
                      {process.services.length === 0
                        ? "Aucun"
                        : process.services.map((link) => link.service.name).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div id="bia-matrix" className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <div>
            <p className="eyebrow">Analyse visuelle</p>
            <h3>Matrice d'impact</h3>
          </div>
          <div className="badge subtle">{criticalProcesses.length} points critiques</div>
        </div>
        {impactMatrix ? (
          <ReactECharts option={impactMatrix} style={{ height: 360 }} />
        ) : (
          <p className="muted">La matrice s'affichera dès qu'un processus sera créé.</p>
        )}
        {criticalProcesses.length > 0 && (
          <p className="muted" style={{ marginTop: "1rem" }}>
            <strong>Processus critiques :</strong>{" "}
            {criticalProcesses.map((process) => process.name).join(", ")}
          </p>
        )}
      </div>
    </>
  );
}

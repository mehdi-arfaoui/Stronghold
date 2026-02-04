import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { SectionLayout } from "../components/ui/SectionLayout";
import type {
  BackupStrategy,
  DependencyCycle,
  SecurityPolicy,
  Service,
} from "../types";
import { apiFetch } from "../utils/api";

interface ContinuitySectionProps {
  configVersion: number;
}

const BACKUP_TYPES = ["full", "differential", "incremental", "continuous", "snapshot"];

type BackupDraft = {
  serviceId: string;
  type: string;
  frequencyMinutes: number;
  retentionDays: number;
  storageLocation: string;
  encryptionLevel: string;
  compression: boolean;
  immutability: boolean;
  rtoImpactHours: number | "";
  rpoImpactMinutes: number | "";
  notes: string;
};

type PolicyDraft = {
  name: string;
  policyType: string;
  classification: string;
  scope: string;
  controls: string;
  reviewFrequencyDays: number | "";
  owner: string;
  serviceIds: string[];
};

type CycleServiceDraft = {
  serviceId: string;
  roleInCycle: string;
};

const defaultBackupDraft: BackupDraft = {
  serviceId: "",
  type: "full",
  frequencyMinutes: 60,
  retentionDays: 30,
  storageLocation: "",
  encryptionLevel: "",
  compression: false,
  immutability: false,
  rtoImpactHours: "",
  rpoImpactMinutes: "",
  notes: "",
};

const defaultPolicyDraft: PolicyDraft = {
  name: "",
  policyType: "",
  classification: "",
  scope: "",
  controls: "",
  reviewFrequencyDays: "",
  owner: "",
  serviceIds: [],
};

const defaultCycleServices: CycleServiceDraft[] = [
  { serviceId: "", roleInCycle: "" },
  { serviceId: "", roleInCycle: "" },
];

export function ContinuitySection({ configVersion }: ContinuitySectionProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [backupStrategies, setBackupStrategies] = useState<BackupStrategy[]>([]);
  const [securityPolicies, setSecurityPolicies] = useState<SecurityPolicy[]>([]);
  const [dependencyCycles, setDependencyCycles] = useState<DependencyCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [backupDraft, setBackupDraft] = useState<BackupDraft>({ ...defaultBackupDraft });
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>({ ...defaultPolicyDraft });
  const [policyCreating, setPolicyCreating] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const [cycleLabel, setCycleLabel] = useState("");
  const [cycleSeverity, setCycleSeverity] = useState("");
  const [cycleNotes, setCycleNotes] = useState("");
  const [cycleServices, setCycleServices] = useState<CycleServiceDraft[]>([
    ...defaultCycleServices,
  ]);
  const [cycleCreating, setCycleCreating] = useState(false);
  const [cycleError, setCycleError] = useState<string | null>(null);

  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  const loadContinuity = async () => {
    try {
      setLoading(true);
      setError(null);
      const [servicesData, backupsData, policiesData, cyclesData] = await Promise.all([
        apiFetch("/services"),
        apiFetch("/continuity/backup-strategies"),
        apiFetch("/continuity/security-policies"),
        apiFetch("/continuity/dependency-cycles"),
      ]);
      setServices(servicesData);
      setBackupStrategies(backupsData);
      setSecurityPolicies(policiesData);
      setDependencyCycles(cyclesData);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContinuity();
  }, [configVersion]);

  const handleBackupCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBackupCreating(true);
    setBackupError(null);
    try {
      await apiFetch("/continuity/backup-strategies", {
        method: "POST",
        body: JSON.stringify({
          serviceId: backupDraft.serviceId || null,
          type: backupDraft.type,
          frequencyMinutes: backupDraft.frequencyMinutes,
          retentionDays: backupDraft.retentionDays,
          storageLocation: backupDraft.storageLocation || null,
          encryptionLevel: backupDraft.encryptionLevel || null,
          compression: backupDraft.compression,
          immutability: backupDraft.immutability,
          rtoImpactHours: backupDraft.rtoImpactHours === "" ? null : backupDraft.rtoImpactHours,
          rpoImpactMinutes:
            backupDraft.rpoImpactMinutes === "" ? null : backupDraft.rpoImpactMinutes,
          notes: backupDraft.notes || null,
        }),
      });
      await loadContinuity();
      setBackupDraft({ ...defaultBackupDraft });
    } catch (err: any) {
      setBackupError(err.message || "Erreur lors de la création");
    } finally {
      setBackupCreating(false);
    }
  };

  const handlePolicyCreate = async (event: FormEvent) => {
    event.preventDefault();
    setPolicyCreating(true);
    setPolicyError(null);
    try {
      await apiFetch("/continuity/security-policies", {
        method: "POST",
        body: JSON.stringify({
          name: policyDraft.name,
          policyType: policyDraft.policyType,
          classification: policyDraft.classification || null,
          scope: policyDraft.scope || null,
          controls: policyDraft.controls || null,
          reviewFrequencyDays:
            policyDraft.reviewFrequencyDays === "" ? null : policyDraft.reviewFrequencyDays,
          owner: policyDraft.owner || null,
          serviceIds: policyDraft.serviceIds,
        }),
      });
      await loadContinuity();
      setPolicyDraft({ ...defaultPolicyDraft });
    } catch (err: any) {
      setPolicyError(err.message || "Erreur lors de la création");
    } finally {
      setPolicyCreating(false);
    }
  };

  const handleCycleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCycleCreating(true);
    setCycleError(null);
    const selectedServices = cycleServices.filter((entry) => entry.serviceId);
    if (selectedServices.length < 2) {
      setCycleError("Sélectionnez au moins deux services pour créer un cycle.");
      setCycleCreating(false);
      return;
    }

    try {
      await apiFetch("/continuity/dependency-cycles", {
        method: "POST",
        body: JSON.stringify({
          label: cycleLabel,
          severity: cycleSeverity || null,
          notes: cycleNotes || null,
          services: selectedServices.map((entry) => ({
            serviceId: entry.serviceId,
            roleInCycle: entry.roleInCycle || null,
          })),
        }),
      });
      await loadContinuity();
      setCycleLabel("");
      setCycleSeverity("");
      setCycleNotes("");
      setCycleServices([...defaultCycleServices]);
    } catch (err: any) {
      setCycleError(err.message || "Erreur lors de la création");
    } finally {
      setCycleCreating(false);
    }
  };

  if (loading) {
    return <div className="skeleton">Chargement de la continuité...</div>;
  }

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  const progressSteps = [
    backupStrategies.length > 0,
    securityPolicies.length > 0,
    dependencyCycles.length > 0,
  ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <section id="continuity-panel" className="panel" aria-labelledby="continuity-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Continuité</p>
          <h2 id="continuity-title">Continuité d'activité</h2>
          <p className="muted">
            Centralisez les stratégies de sauvegarde, politiques de sécurité et cycles de dépendance.
          </p>
        </div>
        <div className="badge subtle">
          {backupStrategies.length} sauvegardes • {securityPolicies.length} politiques •{" "}
          {dependencyCycles.length} cycles
        </div>
      </div>

      <SectionLayout
        id="continuity"
        title="Continuité"
        description="Centralisez sauvegardes, politiques de sécurité et cycles de dépendance."
        badge={`${backupStrategies.length} sauvegardes`}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
        whyThisStep="La continuité d'activité garantit la reprise en documentant les stratégies de sauvegarde et les dépendances critiques."
        quickLinks={[
          { label: "Stratégie backup", href: "#continuity-backup" },
          { label: "Politique sécurité", href: "#continuity-policy" },
          { label: "Cycle dépendance", href: "#continuity-cycle" },
        ]}
        tips={[
          "Renseignez RTO/RPO pour mesurer l'impact des sauvegardes.",
          "Identifiez les cycles critiques avant les exercices PRA.",
        ]}
      >
      <div className="panel-stack">
        <div id="continuity-backup" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Backup</p>
              <h3>Backup strategies</h3>
            </div>
            <span className="pill subtle">{backupStrategies.length}</span>
          </div>

          <form className="form-grid" onSubmit={handleBackupCreate}>
            <label className="form-field">
              <span>Service associé</span>
              <select
                value={backupDraft.serviceId}
                onChange={(event) =>
                  setBackupDraft((prev) => ({ ...prev, serviceId: event.target.value }))
                }
              >
                <option value="">Global</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Type</span>
              <select
                value={backupDraft.type}
                onChange={(event) =>
                  setBackupDraft((prev) => ({ ...prev, type: event.target.value }))
                }
              >
                {BACKUP_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Fréquence (min)</span>
              <input
                type="number"
                min={1}
                value={backupDraft.frequencyMinutes}
                onChange={(event) =>
                  setBackupDraft((prev) => ({
                    ...prev,
                    frequencyMinutes: Number(event.target.value),
                  }))
                }
                required
              />
            </label>
            <label className="form-field">
              <span>Rétention (jours)</span>
              <input
                type="number"
                min={1}
                value={backupDraft.retentionDays}
                onChange={(event) =>
                  setBackupDraft((prev) => ({
                    ...prev,
                    retentionDays: Number(event.target.value),
                  }))
                }
                required
              />
            </label>
            <label className="form-field">
              <span>Stockage</span>
              <input
                type="text"
                value={backupDraft.storageLocation}
                onChange={(event) =>
                  setBackupDraft((prev) => ({ ...prev, storageLocation: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>Chiffrement</span>
              <input
                type="text"
                value={backupDraft.encryptionLevel}
                onChange={(event) =>
                  setBackupDraft((prev) => ({ ...prev, encryptionLevel: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>RTO impact (h)</span>
              <input
                type="number"
                min={0}
                value={backupDraft.rtoImpactHours}
                onChange={(event) =>
                  setBackupDraft((prev) => ({
                    ...prev,
                    rtoImpactHours: event.target.value === "" ? "" : Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>RPO impact (min)</span>
              <input
                type="number"
                min={0}
                value={backupDraft.rpoImpactMinutes}
                onChange={(event) =>
                  setBackupDraft((prev) => ({
                    ...prev,
                    rpoImpactMinutes: event.target.value === "" ? "" : Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="form-field checkbox">
              <input
                type="checkbox"
                checked={backupDraft.compression}
                onChange={(event) =>
                  setBackupDraft((prev) => ({ ...prev, compression: event.target.checked }))
                }
              />
              <span>Compression</span>
            </label>
            <label className="form-field checkbox">
              <input
                type="checkbox"
                checked={backupDraft.immutability}
                onChange={(event) =>
                  setBackupDraft((prev) => ({ ...prev, immutability: event.target.checked }))
                }
              />
              <span>Immutabilité</span>
            </label>
            <label className="form-field" style={{ gridColumn: "1 / -1" }}>
              <span>Notes</span>
              <input
                type="text"
                value={backupDraft.notes}
                onChange={(event) =>
                  setBackupDraft((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </label>
            <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
              <button className="btn primary" type="submit" disabled={backupCreating}>
                {backupCreating ? "Création..." : "Ajouter la stratégie"}
              </button>
              {backupError && <p className="helper error">{backupError}</p>}
            </div>
          </form>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Type</th>
                  <th>Fréquence</th>
                  <th>Rétention</th>
                  <th>Stockage</th>
                  <th>RTO/RPO impact</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                {backupStrategies.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      Aucune stratégie enregistrée.
                    </td>
                  </tr>
                ) : (
                  backupStrategies.map((strategy) => (
                    <tr key={strategy.id}>
                      <td>{strategy.service?.name || "Global"}</td>
                      <td>{strategy.type}</td>
                      <td>{strategy.frequencyMinutes} min</td>
                      <td>{strategy.retentionDays} j</td>
                      <td>{strategy.storageLocation || "-"}</td>
                      <td>
                        {strategy.rtoImpactHours ?? "-"}h / {strategy.rpoImpactMinutes ?? "-"} min
                      </td>
                      <td>
                        {strategy.compression ? "Compression" : "Sans compression"} •{" "}
                        {strategy.immutability ? "Immuable" : "Mutable"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div id="continuity-policy" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Sécurité</p>
              <h3>Security policies</h3>
            </div>
            <span className="pill subtle">{securityPolicies.length}</span>
          </div>

          <form className="form-grid" onSubmit={handlePolicyCreate}>
            <label className="form-field">
              <span>Nom</span>
              <input
                type="text"
                value={policyDraft.name}
                onChange={(event) =>
                  setPolicyDraft((prev) => ({ ...prev, name: event.target.value }))
                }
                required
              />
            </label>
            <label className="form-field">
              <span>Type de politique</span>
              <input
                type="text"
                value={policyDraft.policyType}
                onChange={(event) =>
                  setPolicyDraft((prev) => ({ ...prev, policyType: event.target.value }))
                }
                required
              />
            </label>
            <label className="form-field">
              <span>Classification</span>
              <input
                type="text"
                value={policyDraft.classification}
                onChange={(event) =>
                  setPolicyDraft((prev) => ({ ...prev, classification: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>Périmètre</span>
              <input
                type="text"
                value={policyDraft.scope}
                onChange={(event) =>
                  setPolicyDraft((prev) => ({ ...prev, scope: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>Contrôles</span>
              <input
                type="text"
                value={policyDraft.controls}
                onChange={(event) =>
                  setPolicyDraft((prev) => ({ ...prev, controls: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>Fréquence de revue (jours)</span>
              <input
                type="number"
                min={1}
                value={policyDraft.reviewFrequencyDays}
                onChange={(event) =>
                  setPolicyDraft((prev) => ({
                    ...prev,
                    reviewFrequencyDays:
                      event.target.value === "" ? "" : Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>Owner</span>
              <input
                type="text"
                value={policyDraft.owner}
                onChange={(event) =>
                  setPolicyDraft((prev) => ({ ...prev, owner: event.target.value }))
                }
              />
            </label>
            <label className="form-field" style={{ gridColumn: "1 / -1" }}>
              <span>Services liés</span>
              <select
                multiple
                value={policyDraft.serviceIds}
                onChange={(event) => {
                  const selected = Array.from(event.target.selectedOptions, (opt) => opt.value);
                  setPolicyDraft((prev) => ({ ...prev, serviceIds: selected }));
                }}
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
              <span className="helper">
                Maintenez Ctrl/Cmd pour sélectionner plusieurs services.
              </span>
            </label>
            <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
              <button className="btn primary" type="submit" disabled={policyCreating}>
                {policyCreating ? "Création..." : "Ajouter la politique"}
              </button>
              {policyError && <p className="helper error">{policyError}</p>}
            </div>
          </form>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th>Classification</th>
                  <th>Périmètre</th>
                  <th>Services</th>
                </tr>
              </thead>
              <tbody>
                {securityPolicies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      Aucune politique enregistrée.
                    </td>
                  </tr>
                ) : (
                  securityPolicies.map((policy) => (
                    <tr key={policy.id}>
                      <td>{policy.name}</td>
                      <td>{policy.policyType}</td>
                      <td>{policy.classification || "-"}</td>
                      <td>{policy.scope || "-"}</td>
                      <td>
                        {policy.services.length > 0
                          ? policy.services.map((link) => link.service.name).join(", ")
                          : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div id="continuity-cycle" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Dépendances</p>
              <h3>Dependency cycles</h3>
            </div>
            <span className="pill subtle">{dependencyCycles.length}</span>
          </div>

          <form className="form-grid" onSubmit={handleCycleCreate}>
            <label className="form-field">
              <span>Libellé du cycle</span>
              <input
                type="text"
                value={cycleLabel}
                onChange={(event) => setCycleLabel(event.target.value)}
                required
              />
            </label>
            <label className="form-field">
              <span>Sévérité</span>
              <input
                type="text"
                value={cycleSeverity}
                onChange={(event) => setCycleSeverity(event.target.value)}
              />
            </label>
            <label className="form-field" style={{ gridColumn: "1 / -1" }}>
              <span>Notes</span>
              <input
                type="text"
                value={cycleNotes}
                onChange={(event) => setCycleNotes(event.target.value)}
              />
            </label>
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <span>Services du cycle</span>
              <div className="stack">
                {cycleServices.map((entry, index) => (
                  <div key={index} className="form-grid" style={{ gridTemplateColumns: "2fr 2fr auto" }}>
                    <select
                      value={entry.serviceId}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCycleServices((prev) =>
                          prev.map((item, idx) =>
                            idx === index ? { ...item, serviceId: value } : item
                          )
                        );
                      }}
                    >
                      <option value="">Choisir un service</option>
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Rôle dans le cycle"
                      value={entry.roleInCycle}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCycleServices((prev) =>
                          prev.map((item, idx) =>
                            idx === index ? { ...item, roleInCycle: value } : item
                          )
                        );
                      }}
                    />
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        setCycleServices((prev) => prev.filter((_, idx) => idx !== index))
                      }
                      disabled={cycleServices.length <= 2}
                    >
                      Retirer
                    </button>
                  </div>
                ))}
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() =>
                    setCycleServices((prev) => [...prev, { serviceId: "", roleInCycle: "" }])
                  }
                >
                  Ajouter un service
                </button>
              </div>
            </div>
            <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
              <button className="btn primary" type="submit" disabled={cycleCreating}>
                {cycleCreating ? "Création..." : "Ajouter le cycle"}
              </button>
              {cycleError && <p className="helper error">{cycleError}</p>}
            </div>
          </form>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Sévérité</th>
                  <th>Services & rôles</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {dependencyCycles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      Aucun cycle enregistré.
                    </td>
                  </tr>
                ) : (
                  dependencyCycles.map((cycle) => (
                    <tr key={cycle.id}>
                      <td>{cycle.label}</td>
                      <td>{cycle.severity || "-"}</td>
                      <td>
                        {cycle.services.length > 0
                          ? cycle.services
                              .map((link) => {
                                const name = link.service?.name || serviceMap.get(link.serviceId)?.name;
                                return link.roleInCycle ? `${name} (${link.roleInCycle})` : name;
                              })
                              .join(", ")
                          : "-"}
                      </td>
                      <td>{cycle.notes || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </SectionLayout>
    </section>
  );
}

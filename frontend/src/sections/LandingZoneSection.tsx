import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { InfraComponent } from "../types";
import { apiFetch } from "../utils/api";

interface LandingZoneSectionProps {
  configVersion: number;
}

const defaultInfraPayload = {
  name: "",
  type: "vpc",
  provider: "aws",
  location: "eu-west-3",
  criticality: "high",
  isSingleAz: false,
  notes: "",
};

export function LandingZoneSection({ configVersion }: LandingZoneSectionProps) {
  const [components, setComponents] = useState<InfraComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newInfra, setNewInfra] = useState({ ...defaultInfraPayload });

  const loadInfra = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch("/infra/components");
      setComponents(data);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInfra();
  }, [configVersion]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/infra/components", {
        method: "POST",
        body: JSON.stringify({
          name: newInfra.name,
          type: newInfra.type,
          provider: newInfra.provider,
          location: newInfra.location,
          criticality: newInfra.criticality,
          isSingleAz: newInfra.isSingleAz,
          notes: newInfra.notes,
        }),
      });
      await loadInfra();
      setNewInfra({ ...defaultInfraPayload });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="skeleton">Chargement des composants...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  return (
    <section id="landing-panel" className="panel" aria-labelledby="landing-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Landing Zone</p>
          <h2 id="landing-title">Infrastructure</h2>
          <p className="muted">
            Modélisation des composants d'infra (VPC, subnets, zones, comptes...) et services hébergés.
          </p>
        </div>
        <div className="badge subtle">{components.length} composants</div>
      </div>

      <form className="form-grid card" onSubmit={handleCreate}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Nom</span>
            <input
              type="text"
              value={newInfra.name}
              onChange={(e) => setNewInfra((s) => ({ ...s, name: e.target.value }))}
              required
            />
          </label>
          <label className="form-field">
            <span>Type</span>
            <select
              value={newInfra.type}
              onChange={(e) => setNewInfra((s) => ({ ...s, type: e.target.value }))}
            >
              <option value="vpc">vpc</option>
              <option value="subnet">subnet</option>
              <option value="az">az</option>
              <option value="region">region</option>
              <option value="account">account</option>
              <option value="firewall">firewall</option>
              <option value="natgw">natgw</option>
              <option value="bastion">bastion</option>
            </select>
          </label>
          <label className="form-field">
            <span>Provider</span>
            <select
              value={newInfra.provider}
              onChange={(e) => setNewInfra((s) => ({ ...s, provider: e.target.value }))}
            >
              <option value="aws">aws</option>
              <option value="azure">azure</option>
              <option value="gcp">gcp</option>
              <option value="onprem">onprem</option>
            </select>
          </label>
          <label className="form-field">
            <span>Localisation</span>
            <input
              type="text"
              value={newInfra.location}
              onChange={(e) => setNewInfra((s) => ({ ...s, location: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Criticité</span>
            <select
              value={newInfra.criticality}
              onChange={(e) => setNewInfra((s) => ({ ...s, criticality: e.target.value }))}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="form-field checkbox">
            <span>Single-AZ ?</span>
            <input
              type="checkbox"
              checked={newInfra.isSingleAz}
              onChange={(e) => setNewInfra((s) => ({ ...s, isSingleAz: e.target.checked }))}
            />
          </label>
          <label className="form-field" style={{ gridColumn: "span 2" }}>
            <span>Notes</span>
            <input
              type="text"
              value={newInfra.notes}
              onChange={(e) => setNewInfra((s) => ({ ...s, notes: e.target.value }))}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={creating}>
            {creating ? "Création..." : "Ajouter le composant"}
          </button>
          {createError && <p className="helper error">{createError}</p>}
        </div>
      </form>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Type</th>
                <th>Provider</th>
                <th>Localisation</th>
                <th>Criticité</th>
                <th>Single AZ</th>
                <th># Services</th>
              </tr>
            </thead>
            <tbody>
              {components.map((component) => {
                const count = component.services?.length ?? 0;
                return (
                  <tr key={component.id}>
                    <td>{component.name}</td>
                    <td>{component.type}</td>
                    <td>{component.provider ?? "-"}</td>
                    <td>{component.location ?? "-"}</td>
                    <td>{component.criticality ?? "-"}</td>
                    <td>{component.isSingleAz ? "Oui" : "Non"}</td>
                    <td className="numeric">{count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { SERVICE_DOMAINS, domainMetaByValue } from "../constants/domains";
import type { InfraComponent, Service } from "../types";
import { apiFetch } from "../utils/api";

interface ServicesSectionProps {
  configVersion: number;
}

const defaultServicePayload = {
  name: "",
  type: "app",
  criticality: "medium",
  recoveryPriority: 2,
  rtoHours: 4,
  rpoMinutes: 60,
  mtpdHours: 24,
  domain: "APP",
};

export function ServicesSection({ configVersion }: ServicesSectionProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [infraComponents, setInfraComponents] = useState<InfraComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [newService, setNewService] = useState({ ...defaultServicePayload });
  const [newLink, setNewLink] = useState({ serviceId: "", infraId: "" });

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [servicesData, infraData] = await Promise.all([
        apiFetch("/services"),
        apiFetch("/infra/components"),
      ]);
      setServices(servicesData);
      setInfraComponents(infraData);
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
    setNewLink((current) => {
      const next = { ...current };
      if (!next.serviceId && services.length > 0) {
        next.serviceId = services[0].id;
      }
      if (!next.infraId && infraComponents.length > 0) {
        next.infraId = infraComponents[0].id;
      }
      return next;
    });
  }, [services, infraComponents]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/services", {
        method: "POST",
        body: JSON.stringify({
          name: newService.name,
          type: newService.type,
          criticality: newService.criticality,
          recoveryPriority: newService.recoveryPriority,
          rtoHours: newService.rtoHours,
          rpoMinutes: newService.rpoMinutes,
          mtpdHours: newService.mtpdHours,
          description: "",
          notes: "",
          domain: newService.domain,
        }),
      });
      await loadData();
      setNewService({ ...defaultServicePayload });
    } catch (err: any) {
      setCreateError(err.message || "Erreur lors de la création");
    } finally {
      setCreating(false);
    }
  };

  const handleLink = async (e: FormEvent) => {
    e.preventDefault();
    setLinking(true);
    setLinkError(null);
    try {
      await apiFetch("/infra/link", {
        method: "POST",
        body: JSON.stringify({
          serviceId: newLink.serviceId,
          infraId: newLink.infraId,
        }),
      });
      await loadData();
    } catch (err: any) {
      setLinkError(err.message || "Erreur lors de l'association");
    } finally {
      setLinking(false);
    }
  };

  if (loading) return <div className="skeleton">Chargement des services...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  return (
    <section id="services-panel" className="panel" aria-labelledby="services-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Catalogue</p>
          <h2 id="services-title">Services</h2>
          <p className="muted">
            Vue consolidée des services, priorités PRA et rattachements à la Landing Zone.
          </p>
        </div>
        <div className="badge subtle">{services.length} services</div>
      </div>

      <form className="form-grid card" onSubmit={handleCreate}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Domaine</span>
            <select
              value={newService.domain}
              onChange={(e) => setNewService((s) => ({ ...s, domain: e.target.value }))}
            >
              {SERVICE_DOMAINS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.icon} {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Nom</span>
            <input
              type="text"
              value={newService.name}
              onChange={(e) => setNewService((s) => ({ ...s, name: e.target.value }))}
              required
            />
          </label>
          <label className="form-field">
            <span>Type</span>
            <select
              value={newService.type}
              onChange={(e) => setNewService((s) => ({ ...s, type: e.target.value }))}
            >
              <option value="app">app</option>
              <option value="db">db</option>
              <option value="infra">infra</option>
              <option value="network">network</option>
              <option value="cloud">cloud</option>
            </select>
          </label>
          <label className="form-field">
            <span>Criticité</span>
            <select
              value={newService.criticality}
              onChange={(e) => setNewService((s) => ({ ...s, criticality: e.target.value }))}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="form-field">
            <span>Priorité (1–5)</span>
            <input
              type="number"
              min={1}
              max={5}
              value={newService.recoveryPriority}
              onChange={(e) =>
                setNewService((s) => ({
                  ...s,
                  recoveryPriority: Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>RTO (h)</span>
            <input
              type="number"
              min={0}
              value={newService.rtoHours}
              onChange={(e) =>
                setNewService((s) => ({
                  ...s,
                  rtoHours: Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>RPO (min)</span>
            <input
              type="number"
              min={0}
              value={newService.rpoMinutes}
              onChange={(e) =>
                setNewService((s) => ({
                  ...s,
                  rpoMinutes: Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>MTPD (h)</span>
            <input
              type="number"
              min={0}
              value={newService.mtpdHours}
              onChange={(e) =>
                setNewService((s) => ({
                  ...s,
                  mtpdHours: Number(e.target.value),
                }))
              }
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={creating}>
            {creating ? "Création..." : "Ajouter le service"}
          </button>
          {createError && <p className="helper error">{createError}</p>}
        </div>
      </form>

      <form className="form-grid card" onSubmit={handleLink}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Service</span>
            <select
              value={newLink.serviceId}
              onChange={(e) => setNewLink((s) => ({ ...s, serviceId: e.target.value }))}
              required
            >
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Composant infra</span>
            <select
              value={newLink.infraId}
              onChange={(e) => setNewLink((s) => ({ ...s, infraId: e.target.value }))}
              required
            >
              {infraComponents.map((infra) => (
                <option key={infra.id} value={infra.id}>
                  {infra.name} ({infra.type})
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="muted">Association</span>
            <button
              className="btn primary"
              type="submit"
              disabled={linking || !newLink.serviceId || !newLink.infraId}
            >
              {linking ? "Association..." : "Associer"}
            </button>
          </label>
        </div>
        <div className="form-actions">
          {linkError && <p className="helper error">{linkError}</p>}
          {!services.length && (
            <p className="helper">Ajoutez un service avant de créer un lien.</p>
          )}
          {!infraComponents.length && (
            <p className="helper">Ajoutez un composant infra pour créer un lien.</p>
          )}
        </div>
      </form>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Domaine</th>
                <th>Type</th>
                <th>Criticité</th>
                <th>Priorité</th>
                <th>RTO (h)</th>
                <th>RPO (min)</th>
                <th>MTPD (h)</th>
                <th>Infra (LZ)</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const infraNames =
                  service.infraLinks?.map((link) => link.infra.name).join(", ") || "-";
                const domainMeta = service.domain ? domainMetaByValue[service.domain] : null;

                return (
                  <tr key={service.id}>
                    <td>
                      <div className="stack">
                        <span className="service-name">
                          {domainMeta ? (
                            <>
                              <span className="icon">{domainMeta.icon}</span>
                              {service.name}
                            </>
                          ) : (
                            service.name
                          )}
                        </span>
                        <span className="muted small">{service.description || ""}</span>
                      </div>
                    </td>
                    <td>{domainMeta ? domainMeta.label : "-"}</td>
                    <td>{service.type}</td>
                    <td>
                      <span className={`pill criticality-${service.criticality}`}>
                        {service.criticality}
                      </span>
                    </td>
                    <td className="numeric">{service.recoveryPriority ?? "-"}</td>
                    <td className="numeric">{service.continuity?.rtoHours ?? "-"}</td>
                    <td className="numeric">{service.continuity?.rpoMinutes ?? "-"}</td>
                    <td className="numeric">{service.continuity?.mtpdHours ?? "-"}</td>
                    <td>{infraNames}</td>
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

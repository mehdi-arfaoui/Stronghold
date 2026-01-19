import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
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
  owner: "",
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
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editService, setEditService] = useState({
    ...defaultServicePayload,
    description: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [criticalityFilter, setCriticalityFilter] = useState("all");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
          owner: newService.owner || null,
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

  const startEdit = (service: Service) => {
    setEditingServiceId(service.id);
    setEditService({
      name: service.name,
      type: service.type,
      criticality: service.criticality,
      recoveryPriority: service.recoveryPriority ?? 1,
      rtoHours: service.continuity?.rtoHours ?? 0,
      rpoMinutes: service.continuity?.rpoMinutes ?? 0,
      mtpdHours: service.continuity?.mtpdHours ?? 0,
      domain: service.domain ?? "APP",
      owner: service.owner ?? "",
      description: service.description ?? "",
    });
    setUpdateError(null);
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingServiceId) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      await apiFetch(`/services/${editingServiceId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editService.name,
          type: editService.type,
          owner: editService.owner || null,
          criticality: editService.criticality,
          recoveryPriority: editService.recoveryPriority,
          rtoHours: editService.rtoHours,
          rpoMinutes: editService.rpoMinutes,
          mtpdHours: editService.mtpdHours,
          domain: editService.domain,
          description: editService.description,
        }),
      });
      await loadData();
      setEditingServiceId(null);
    } catch (err: any) {
      setUpdateError(err.message || "Erreur lors de la mise à jour");
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (serviceId: string) => {
    const confirmed = window.confirm("Supprimer ce service ?");
    if (!confirmed) return;
    setDeletingId(serviceId);
    setDeleteError(null);
    try {
      await apiFetch(`/services/${serviceId}`, { method: "DELETE" });
      await loadData();
    } catch (err: any) {
      setDeleteError(err.message || "Erreur lors de la suppression");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div className="skeleton">Chargement des services...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  const progressSteps = [
    services.length > 0,
    services.some((service) => Boolean(service.continuity)),
    services.some((service) => (service.infraLinks?.length ?? 0) > 0),
  ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  const filteredServices = services.filter((service) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      service.name.toLowerCase().includes(query) ||
      (service.owner ?? "").toLowerCase().includes(query);
    const matchesCriticality =
      criticalityFilter === "all" || service.criticality === criticalityFilter;
    return matchesQuery && matchesCriticality;
  });

  return (
    <section id="services-panel" className="panel" aria-labelledby="services-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Catalogue</p>
          <h2 id="services-title">Services & Applications</h2>
          <p className="muted">
            Vue consolidée des services, priorités PRA et rattachements à la Landing Zone.
          </p>
        </div>
        <div className="badge subtle">{services.length} services</div>
      </div>

      <PageIntro
        title="Piloter les services critiques"
        objective="Centraliser la cartographie des services, prioriser les besoins PRA et préparer les liaisons infra."
        steps={[
          "Créer les services critiques",
          "Renseigner criticité et objectifs RTO/RPO",
          "Lier les services aux composants Landing Zone",
        ]}
        tips={[
          "Priorisez les services à criticité haute ou critique.",
          "Renseignez le domaine pour faciliter les filtres transverses.",
          "Ajoutez les dépendances pour enrichir le graphe.",
        ]}
        links={[
          { label: "Ajouter un service", href: "#services-create", description: "Formulaire" },
          { label: "Associer à l'infra", href: "#services-link", description: "Lien service ↔ infra" },
          { label: "Voir le catalogue", href: "#services-table", description: "Table des services" },
        ]}
        expectedData={[
          "Nom du service + domaine fonctionnel",
          "Criticité, priorité et objectifs de continuité",
          "Composants infra associés (Landing Zone)",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      <form id="services-create" className="form-grid card" onSubmit={handleCreate}>
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
            <span>Propriétaire</span>
            <input
              type="text"
              value={newService.owner}
              onChange={(e) => setNewService((s) => ({ ...s, owner: e.target.value }))}
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

      <form id="services-link" className="form-grid card" onSubmit={handleLink}>
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

      <div id="services-table" className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Catalogue consolidé</p>
            <h3>Services & applications</h3>
            <p className="muted small">
              Filtrez les services importés ou détectés pour compléter les métadonnées clés.
            </p>
          </div>
          <div className="stack horizontal" style={{ gap: "12px" }}>
            <label className="form-field" style={{ minWidth: "160px" }}>
              <span>Criticité</span>
              <select
                value={criticalityFilter}
                onChange={(event) => setCriticalityFilter(event.target.value)}
              >
                <option value="all">Toutes</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label className="form-field" style={{ minWidth: "220px" }}>
              <span>Recherche</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Nom ou propriétaire"
              />
            </label>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Domaine</th>
                <th>Type</th>
                <th>Propriétaire</th>
                <th>Criticité</th>
                <th>Priorité</th>
                <th>RTO (h)</th>
                <th>RPO (min)</th>
                <th>MTPD (h)</th>
                <th>Infra (LZ)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.map((service) => {
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
                    <td>{service.owner || "-"}</td>
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
                    <td>
                      <div className="stack horizontal" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <button className="btn ghost" onClick={() => startEdit(service)}>
                          Modifier
                        </button>
                        <button
                          className="btn"
                          onClick={() => handleDelete(service.id)}
                          disabled={deletingId === service.id}
                        >
                          {deletingId === service.id ? "Suppression..." : "Supprimer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {deleteError && !editingServiceId && <p className="helper error">{deleteError}</p>}

      {editingServiceId && (
        <form className="form-grid card" onSubmit={handleUpdate}>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <label className="form-field">
              <span>Domaine</span>
              <select
                value={editService.domain}
                onChange={(e) => setEditService((s) => ({ ...s, domain: e.target.value }))}
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
                value={editService.name}
                onChange={(e) => setEditService((s) => ({ ...s, name: e.target.value }))}
                required
              />
            </label>
            <label className="form-field">
              <span>Propriétaire</span>
              <input
                type="text"
                value={editService.owner}
                onChange={(e) => setEditService((s) => ({ ...s, owner: e.target.value }))}
              />
            </label>
            <label className="form-field">
              <span>Type</span>
              <select
                value={editService.type}
                onChange={(e) => setEditService((s) => ({ ...s, type: e.target.value }))}
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
                value={editService.criticality}
                onChange={(e) => setEditService((s) => ({ ...s, criticality: e.target.value }))}
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
                value={editService.recoveryPriority}
                onChange={(e) =>
                  setEditService((s) => ({
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
                value={editService.rtoHours}
                onChange={(e) =>
                  setEditService((s) => ({
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
                value={editService.rpoMinutes}
                onChange={(e) =>
                  setEditService((s) => ({
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
                value={editService.mtpdHours}
                onChange={(e) =>
                  setEditService((s) => ({
                    ...s,
                    mtpdHours: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="form-field" style={{ gridColumn: "span 2" }}>
              <span>Description</span>
              <input
                type="text"
                value={editService.description}
                onChange={(e) => setEditService((s) => ({ ...s, description: e.target.value }))}
              />
            </label>
          </div>
          <div className="form-actions">
            <div className="stack horizontal" style={{ gap: "8px", alignItems: "center" }}>
              <button className="btn primary" type="submit" disabled={updating}>
                {updating ? "Mise à jour..." : "Enregistrer"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setEditingServiceId(null)}
                disabled={updating}
              >
                Annuler
              </button>
            </div>
            {updateError && <p className="helper error">{updateError}</p>}
            {deleteError && <p className="helper error">{deleteError}</p>}
          </div>
        </form>
      )}
    </section>
  );
}

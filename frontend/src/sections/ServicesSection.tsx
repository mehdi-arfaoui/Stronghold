import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { SectionLayout } from "../components/ui/SectionLayout";
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

const criticalityLabels: Record<string, string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
};

const typeLabels: Record<string, string> = {
  app: "Application",
  db: "Base de données",
  infra: "Infrastructure",
  network: "Réseau",
  cloud: "Cloud",
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
    const confirmed = window.confirm("Voulez-vous vraiment supprimer ce service ?");
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
    return <div className="alert error">Erreur : {error}</div>;
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
    <SectionLayout
      id="services-panel"
      title="Catalogue des services"
      description="Gérez vos services, définissez leur criticité et associez-les à l'infrastructure."
      badge={`${services.length} services`}
      progress={{
        value: progressValue,
        label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
      }}
      whyThisStep="Identifiez les services critiques pour prioriser les efforts de reprise d'activité."
      quickLinks={[
        { label: "Ajouter un service", href: "#services-create" },
        { label: "Associer à l'infra", href: "#services-link" },
      ]}
      tips={[
        "Priorisez les services à criticité élevée.",
        "Renseignez les objectifs RTO/RPO.",
      ]}
    >
      {/* Formulaire de création */}
      <form id="services-create" className="card" onSubmit={handleCreate}>
        <h3 className="section-title">Nouveau service</h3>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
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
            <span>Responsable</span>
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
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Criticité</span>
            <select
              value={newService.criticality}
              onChange={(e) => setNewService((s) => ({ ...s, criticality: e.target.value }))}
            >
              {Object.entries(criticalityLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
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
                setNewService((s) => ({ ...s, recoveryPriority: Number(e.target.value) }))
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
                setNewService((s) => ({ ...s, rtoHours: Number(e.target.value) }))
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
                setNewService((s) => ({ ...s, rpoMinutes: Number(e.target.value) }))
              }
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={creating}>
            {creating ? "Création..." : "Ajouter"}
          </button>
          {createError && <p className="helper error">{createError}</p>}
        </div>
      </form>

      {/* Formulaire d'association */}
      {services.length > 0 && infraComponents.length > 0 && (
        <form id="services-link" className="card" onSubmit={handleLink}>
          <h3 className="section-title">Associer à l'infrastructure</h3>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
            <label className="form-field">
              <span>Service</span>
              <select
                value={newLink.serviceId}
                onChange={(e) => setNewLink((s) => ({ ...s, serviceId: e.target.value }))}
                required
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Composant</span>
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
              <span>&nbsp;</span>
              <button className="btn primary" type="submit" disabled={linking}>
                {linking ? "..." : "Associer"}
              </button>
            </label>
          </div>
          {linkError && <p className="helper error">{linkError}</p>}
        </form>
      )}

      {/* Tableau des services */}
      <div id="services-table" className="card">
        <div className="card-header">
          <h3 className="section-title">Liste des services</h3>
          <div className="stack horizontal" style={{ gap: "12px" }}>
            <select
              value={criticalityFilter}
              onChange={(event) => setCriticalityFilter(event.target.value)}
              aria-label="Filtrer par criticité"
            >
              <option value="all">Toutes criticités</option>
              {Object.entries(criticalityLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Rechercher..."
              aria-label="Rechercher un service"
            />
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Type</th>
                <th>Responsable</th>
                <th>Criticité</th>
                <th>RTO</th>
                <th>RPO</th>
                <th>Infra</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.map((service) => {
                const infraNames =
                  service.infraLinks?.map((link) => link.infra.name).join(", ") || "—";
                const domainMeta = service.domain ? domainMetaByValue[service.domain] : null;

                return (
                  <tr key={service.id}>
                    <td>
                      <span className="service-name">
                        {domainMeta && <span className="icon">{domainMeta.icon}</span>}
                        {service.name}
                      </span>
                    </td>
                    <td>{typeLabels[service.type] || service.type}</td>
                    <td>{service.owner || "—"}</td>
                    <td>
                      <span className={`pill criticality-${service.criticality}`}>
                        {criticalityLabels[service.criticality] || service.criticality}
                      </span>
                    </td>
                    <td className="numeric">{service.continuity?.rtoHours ?? "—"} h</td>
                    <td className="numeric">{service.continuity?.rpoMinutes ?? "—"} min</td>
                    <td>{infraNames}</td>
                    <td>
                      <div className="button-group">
                        <button className="btn ghost" onClick={() => startEdit(service)}>
                          Modifier
                        </button>
                        <button
                          className="btn"
                          onClick={() => handleDelete(service.id)}
                          disabled={deletingId === service.id}
                        >
                          {deletingId === service.id ? "..." : "Supprimer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredServices.length === 0 && (
          <p className="empty-state">Aucun service trouvé.</p>
        )}
      </div>

      {deleteError && !editingServiceId && <p className="helper error">{deleteError}</p>}

      {/* Modal d'édition */}
      {editingServiceId && (
        <form className="card" onSubmit={handleUpdate}>
          <h3 className="section-title">Modifier le service</h3>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
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
              <span>Responsable</span>
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
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Criticité</span>
              <select
                value={editService.criticality}
                onChange={(e) => setEditService((s) => ({ ...s, criticality: e.target.value }))}
              >
                {Object.entries(criticalityLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
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
                  setEditService((s) => ({ ...s, recoveryPriority: Number(e.target.value) }))
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
                  setEditService((s) => ({ ...s, rtoHours: Number(e.target.value) }))
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
                  setEditService((s) => ({ ...s, rpoMinutes: Number(e.target.value) }))
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
            <button className="btn primary" type="submit" disabled={updating}>
              {updating ? "Enregistrement..." : "Enregistrer"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setEditingServiceId(null)}
              disabled={updating}
            >
              Annuler
            </button>
            {updateError && <p className="helper error">{updateError}</p>}
          </div>
        </form>
      )}
    </SectionLayout>
  );
}

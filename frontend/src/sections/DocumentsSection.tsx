import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { DocumentMetadata, DocumentRecord } from "../types";
import { apiFetch, apiFetchFormData } from "../utils/api";

interface DocumentsSectionProps {
  configVersion: number;
}

const DOC_TYPES = ["ARCHI", "CMDB", "POLICY", "RUNBOOK", "BACKUP_POLICY", "RISK", "OTHER"];

function parseMetadata(raw: DocumentRecord["detectedMetadata"]): DocumentMetadata {
  const base: DocumentMetadata = { services: [], slas: [] };
  if (!raw) return base;
  if (typeof raw === "object") {
    return {
      ...base,
      ...raw,
      services: raw.services ?? [],
      slas: raw.slas ?? [],
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DocumentMetadata>;
    return {
      ...base,
      ...parsed,
      services: parsed.services ?? [],
      slas: parsed.slas ?? [],
    };
  } catch (_err) {
    return { ...base, structuredSummary: String(raw) };
  }
}

function formatBytes(size?: number | null) {
  if (!size || size <= 0) return "-";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

export function DocumentsSection({ configVersion }: DocumentsSectionProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("ARCHI");
  const [description, setDescription] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [uploadStep, setUploadStep] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editDocType, setEditDocType] = useState("ARCHI");
  const [editDescription, setEditDescription] = useState("");
  const [updatingDoc, setUpdatingDoc] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch("/documents");
      setDocuments(data);
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [configVersion]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
  };

  const performUpload = async (autoIngest: boolean, event?: FormEvent) => {
    event?.preventDefault();
    if (!file) {
      setUploadError("Sélectionnez un fichier avant l'envoi.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    setActionMessage(null);
    setUploadStep("upload");

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (docType) formData.append("docType", docType);
      if (description) formData.append("description", description);

      const created = await apiFetchFormData("/documents", formData);
      setUploadStep("ingestion");
      if (autoIngest && created?.id) {
        await triggerExtraction(created.id);
        setActionMessage("Document importé et indexation déclenchée.");
      } else {
        setActionMessage("Document chargé et stocké. Lancez l'extraction pour indexer le contenu.");
      }
      setDescription("");
      setFile(null);
      await loadDocuments();
    } catch (err: any) {
      setUploadError(err.message || "Échec de l'upload");
    } finally {
      setUploading(false);
      setUploadStep(null);
    }
  };

  const triggerExtraction = async (documentId: string) => {
    setActionMessage(null);
    try {
      await apiFetch(`/documents/${documentId}/extract`, { method: "POST" });
      await loadDocuments();
      setActionMessage("Extraction lancée pour le document sélectionné.");
    } catch (err: any) {
      setUploadError(err.message || "Impossible de lancer l'extraction");
    }
  };

  const triggerExtractAll = async () => {
    setActionMessage(null);
    try {
      const result = await apiFetch("/documents/extract-all-pending", { method: "POST" });
      await loadDocuments();
      const count = result?.count ?? 0;
      setActionMessage(`${count} document(s) en attente envoyés en extraction.`);
    } catch (err: any) {
      setUploadError(err.message || "Impossible de lancer l'extraction groupée");
    }
  };

  const startEdit = (doc: DocumentRecord) => {
    setEditingDocId(doc.id);
    setEditDocType(doc.docType || "ARCHI");
    setEditDescription(doc.description || "");
    setUpdateError(null);
  };

  const handleUpdate = async (docId: string) => {
    setUpdatingDoc(true);
    setUpdateError(null);
    try {
      await apiFetch(`/documents/${docId}`, {
        method: "PUT",
        body: JSON.stringify({ docType: editDocType, description: editDescription }),
      });
      await loadDocuments();
      setEditingDocId(null);
    } catch (err: any) {
      setUpdateError(err.message || "Erreur lors de la mise à jour");
    } finally {
      setUpdatingDoc(false);
    }
  };

  const handleDelete = async (docId: string) => {
    const confirmed = window.confirm("Supprimer ce document ?");
    if (!confirmed) return;
    setDeletingDocId(docId);
    setDeleteError(null);
    try {
      await apiFetch(`/documents/${docId}`, { method: "DELETE" });
      await loadDocuments();
    } catch (err: any) {
      setDeleteError(err.message || "Erreur lors de la suppression");
    } finally {
      setDeletingDocId(null);
    }
  };

  const metadataTotals = useMemo(() => {
    return documents.reduce(
      (acc, doc) => {
        const metadata = parseMetadata(doc.detectedMetadata);
        acc.backups += metadata.backupMentions?.length || 0;
        acc.policies += metadata.slas?.length || 0;
        acc.dependencies += metadata.dependencies?.length || 0;
        return acc;
      },
      { backups: 0, policies: 0, dependencies: 0 }
    );
  }, [documents]);

  if (loading) return <div className="skeleton">Chargement des documents...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  return (
    <section id="documents-panel" className="panel" aria-labelledby="documents-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Ingestion</p>
          <h2 id="documents-title">Documents</h2>
          <p className="muted">
            Upload des pièces (archi, CMDB, politiques...), suivi d'extraction et détection des sauvegardes/dépendances.
          </p>
        </div>
        <div className="stack" style={{ gap: "8px", alignItems: "flex-end" }}>
          <div className="badge subtle">{documents.length} documents</div>
          <div className="stack horizontal" style={{ gap: "8px" }}>
            <span className="pill subtle">Backups détectés : {metadataTotals.backups}</span>
            <span className="pill subtle">Politiques/SLA : {metadataTotals.policies}</span>
            <span className="pill subtle">Dépendances : {metadataTotals.dependencies}</span>
          </div>
        </div>
      </div>

      <form
        className="card form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          performUpload(false, event);
        }}
      >
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label className="form-field">
            <span>Fichier</span>
            <input type="file" onChange={handleFileChange} required />
          </label>
          <label className="form-field">
            <span>Type déclaré</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Description</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex : contrat infogérance, backup policy S3..."
            />
          </label>
        </div>
        <div className="form-actions">
          <div className="stack horizontal" style={{ gap: "12px", alignItems: "center" }}>
            <button className="btn primary" type="submit" disabled={uploading}>
              {uploading ? "Upload en cours..." : "Charger le document"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={uploading}
              onClick={(event) => performUpload(true, event)}
            >
              {uploading && uploadStep === "ingestion" ? "Indexation..." : "Importer et indexer"}
            </button>
            <button className="btn" type="button" onClick={triggerExtractAll}>
              Extraire les documents en attente
            </button>
          </div>
          <div className="stack" style={{ gap: "4px" }}>
            {uploadError && <p className="helper error">{uploadError}</p>}
            {uploadStep && <p className="helper muted">Étape : {uploadStep}</p>}
            {actionMessage && <p className="helper success">{actionMessage}</p>}
          </div>
        </div>
      </form>

      {documents.length === 0 ? (
        <p className="empty-state">Aucun document importé pour ce tenant.</p>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Détection</th>
                  <th>Ingestion</th>
                  <th>Extraction</th>
                  <th>Backups / Politiques / Dépendances</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const metadata = parseMetadata(doc.detectedMetadata);
                  const isEditing = editingDocId === doc.id;
                  return (
                    <tr key={doc.id}>
                      <td>
                        <div className="stack">
                          <span className="service-name">{doc.originalName}</span>
                          <span className="muted small">
                            {formatBytes(doc.size)} • {doc.mimeType || "type inconnu"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="stack">
                          {isEditing ? (
                            <>
                              <select
                                value={editDocType}
                                onChange={(e) => setEditDocType(e.target.value)}
                              >
                                {DOC_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {type}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                placeholder="Description"
                              />
                            </>
                          ) : (
                            <>
                              <span className="pill subtle">{doc.docType || "Non renseigné"}</span>
                              {doc.description && (
                                <span className="muted small">{doc.description}</span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="stack">
                          <span className="pill subtle">
                            {doc.detectedDocType || "Non détecté"}
                          </span>
                          {metadata.structuredSummary && (
                            <span className="muted small">Résumé détecté (IA)</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="stack">
                          <span className="pill subtle">{doc.ingestionStatus || "-"}</span>
                          {doc.ingestionError && (
                            <span className="muted small error">{doc.ingestionError}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="stack">
                          <span className="pill subtle">{doc.extractionStatus || "-"}</span>
                          {doc.extractionError && (
                            <span className="muted small error">{doc.extractionError}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="stack small" style={{ gap: "6px" }}>
                          <span className="muted">
                            Backups : {metadata.backupMentions?.length || 0} • Politiques/SLA :{" "}
                            {metadata.slas?.length || 0} • Dépendances :{" "}
                            {metadata.dependencies?.length || 0}
                          </span>
                          {(metadata.backupMentions?.length || 0) > 0 && (
                            <span className="helper">
                              {metadata.backupMentions?.slice(0, 3).join(" • ")}
                            </span>
                          )}
                          {(metadata.dependencies?.length || 0) > 0 && (
                            <span className="helper">
                              {metadata.dependencies?.slice(0, 3).join(" • ")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="stack small">
                          <button className="btn" onClick={() => triggerExtraction(doc.id)}>
                            Lancer l'extraction
                          </button>
                          <button className="btn ghost" onClick={() => startEdit(doc)}>
                            Modifier
                          </button>
                          {isEditing && (
                            <div className="stack horizontal" style={{ gap: "8px" }}>
                              <button
                                className="btn primary"
                                onClick={() => handleUpdate(doc.id)}
                                disabled={updatingDoc}
                              >
                                {updatingDoc ? "Mise à jour..." : "Enregistrer"}
                              </button>
                              <button
                                className="btn"
                                onClick={() => setEditingDocId(null)}
                                disabled={updatingDoc}
                              >
                                Annuler
                              </button>
                            </div>
                          )}
                          <button
                            className="btn"
                            onClick={() => handleDelete(doc.id)}
                            disabled={deletingDocId === doc.id}
                          >
                            {deletingDocId === doc.id ? "Suppression..." : "Supprimer"}
                          </button>
                          {doc.signedUrl && (
                            <a
                              className="btn ghost"
                              href={doc.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Télécharger
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(updateError || deleteError) && (
            <div className="form-actions">
              {updateError && <p className="helper error">{updateError}</p>}
              {deleteError && <p className="helper error">{deleteError}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

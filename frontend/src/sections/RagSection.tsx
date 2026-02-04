import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { SectionLayout } from "../components/ui/SectionLayout";
import type { DocumentMetadata, DocumentRecord, ExtractedFactFront, RagResponse } from "../types";
import { apiFetch } from "../utils/api";

interface RagSectionProps {
  configVersion: number;
}

function parseMetadata(raw: DocumentRecord["detectedMetadata"]): DocumentMetadata {
  const base: DocumentMetadata = { services: [], slas: [] };
  if (!raw) return base;
  if (typeof raw === "object") {
    return { ...base, ...raw, services: raw.services ?? [], slas: raw.slas ?? [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DocumentMetadata>;
    return { ...base, ...parsed, services: parsed.services ?? [], slas: parsed.slas ?? [] };
  } catch (_err) {
    return { ...base, structuredSummary: String(raw) };
  }
}

export function RagSection({ configVersion }: RagSectionProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [factsDocId, setFactsDocId] = useState<string>("");
  const [facts, setFacts] = useState<ExtractedFactFront[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const [factsError, setFactsError] = useState<string | null>(null);

  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [ragResult, setRagResult] = useState<RagResponse | null>(null);
  const [ragError, setRagError] = useState<string | null>(null);
  const [ragLoading, setRagLoading] = useState(false);

  const loadDocuments = async () => {
    try {
      setDocsLoading(true);
      setDocsError(null);
      const data = await apiFetch("/documents");
      setDocuments(data);
      if (data.length > 0 && !factsDocId) {
        setFactsDocId(data[0].id);
      }
    } catch (err: any) {
      setDocsError(err.message || "Erreur inconnue");
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [configVersion]);

  const docById = useMemo(() => {
    const map = new Map<string, DocumentRecord>();
    documents.forEach((d) => map.set(d.id, d));
    return map;
  }, [documents]);

  const currentMetadata = parseMetadata(docById.get(factsDocId)?.detectedMetadata);

  const handleFactsExtract = async (force = false) => {
    if (!factsDocId) {
      setFactsError("Sélectionnez un document pour extraire les faits IA.");
      return;
    }
    setFactsError(null);
    setFactsLoading(true);

    try {
      const query = force ? "?force=true" : "";
      const response = await apiFetch(`/analysis/documents/${factsDocId}/extracted-facts${query}`, {
        method: "POST",
      });
      setFacts(response.facts || []);
    } catch (err: any) {
      setFactsError(err.message || "Extraction impossible");
    } finally {
      setFactsLoading(false);
    }
  };

  const toggleDocumentSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = event.target;
    setSelectedDocIds((prev) =>
      checked ? [...prev, value] : prev.filter((id) => id !== value)
    );
  };

  const handleRagQuery = async (event: FormEvent) => {
    event.preventDefault();
    setRagError(null);
    setRagLoading(true);
    setRagResult(null);

    try {
      const response = await apiFetch("/analysis/rag-query", {
        method: "POST",
        body: JSON.stringify({
          question,
          documentIds: selectedDocIds.length > 0 ? selectedDocIds : undefined,
          documentTypes: docTypeFilter
            ? docTypeFilter
                .split(",")
                .map((v) => v.trim().toUpperCase())
                .filter((v) => v.length > 0)
            : undefined,
          serviceFilter: serviceFilter || undefined,
        }),
      });
      setRagResult(response);
    } catch (err: any) {
      setRagError(err.message || "La requête RAG a échoué");
    } finally {
      setRagLoading(false);
    }
  };

  if (docsLoading) return <div className="skeleton">Chargement des documents RAG...</div>;

  if (docsError) {
    return <div className="alert error">Erreur lors du chargement : {docsError}</div>;
  }

  const progressSteps = [
    documents.length > 0,
    facts.length > 0,
    Boolean(ragResult),
  ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <section id="rag-panel" className="panel" aria-labelledby="rag-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">IA & connaissances</p>
          <h2 id="rag-title">Faits IA / RAG</h2>
          <p className="muted">
            Extraction structurée des documents puis Q&A RAG avec sélection de contexte, backups, politiques et dépendances détectés.
          </p>
        </div>
        <div className="badge subtle">{documents.length} sources</div>
      </div>

      <SectionLayout
        id="rag"
        title="Faits IA / RAG"
        description="Extrayez les faits structurés et interrogez le corpus documentaire."
        badge={`${documents.length} sources`}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
        whyThisStep="L'extraction IA et le RAG accélèrent les décisions PRA en exploitant les connaissances documentaires."
        quickLinks={[
          { label: "Extraire les faits", href: "#rag-facts" },
          { label: "Poser une question", href: "#rag-query" },
        ]}
        tips={[
          "Commencez par les documents avec extraction complète.",
          "Utilisez les filtres pour limiter le bruit dans le contexte.",
        ]}
      >
      <div className="panel-grid">
        <div id="rag-facts" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Extraction</p>
              <h3>Faits structurés par document</h3>
            </div>
            <span className="pill subtle">{facts.length} faits</span>
          </div>

          <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <label className="form-field">
              <span>Document à analyser</span>
              <select value={factsDocId} onChange={(e) => setFactsDocId(e.target.value)}>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.originalName} ({doc.extractionStatus || "PENDING"})
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions" style={{ justifyContent: "flex-start", marginTop: "20px" }}>
              <button className="btn primary" type="button" onClick={() => handleFactsExtract(false)} disabled={factsLoading}>
                {factsLoading ? "Extraction..." : "Extraire les faits"}
              </button>
              <button className="btn" type="button" onClick={() => handleFactsExtract(true)} disabled={factsLoading}>
                Forcer le recalcul
              </button>
            </div>
          </div>

          <div className="stack small" style={{ gap: "6px" }}>
            <span className="muted">
              Backups détectés : {currentMetadata.backupMentions?.length || 0} • Politiques/SLA :{" "}
              {currentMetadata.slas?.length || 0} • Dépendances :{" "}
              {currentMetadata.dependencies?.length || 0}
            </span>
            {(currentMetadata.dependencies?.length || 0) > 0 && (
              <span className="helper">Extraits de dépendances : {currentMetadata.dependencies?.slice(0, 3).join(" • ")}</span>
            )}
          </div>

          {factsError && <div className="alert error">{factsError}</div>}

          {facts.length === 0 ? (
            <p className="empty-state">Aucun fait structuré disponible pour ce document.</p>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Catégorie</th>
                    <th>Label</th>
                    <th>Confiance</th>
                    <th>Données</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.map((fact) => (
                    <tr key={fact.id}>
                      <td>{fact.category}</td>
                      <td>{fact.label}</td>
                      <td className="numeric">
                        {fact.confidence != null ? `${Math.round(fact.confidence * 100)}%` : "-"}
                      </td>
                      <td>
                        <code>{JSON.stringify(fact.data).slice(0, 240)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div id="rag-query" className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Q&A</p>
              <h3>RAG et contexte</h3>
            </div>
            {ragResult && <span className="pill subtle">{ragResult.context.chunks.length} extraits</span>}
          </div>

          <form className="stack" style={{ gap: "12px" }} onSubmit={handleRagQuery}>
            <label className="form-field">
              <span>Question</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ex: Quels backups couvrent la base finance ?"
                required
                rows={3}
              />
            </label>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <label className="form-field">
                <span>Filtrer par type de document</span>
                <input
                  type="text"
                  value={docTypeFilter}
                  onChange={(e) => setDocTypeFilter(e.target.value)}
                  placeholder="BACKUP_POLICY,ARCHI"
                />
              </label>
              <label className="form-field">
                <span>Service ciblé (optionnel)</span>
                <input
                  type="text"
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  placeholder="Nom de service"
                />
              </label>
            </div>
            <div>
              <p className="muted small">Limiter le contexte aux documents sélectionnés :</p>
              <div className="service-selector" style={{ maxHeight: "180px", overflow: "auto" }}>
                {documents.map((doc) => (
                  <label key={doc.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      value={doc.id}
                      checked={selectedDocIds.includes(doc.id)}
                      onChange={toggleDocumentSelection}
                    />
                    <span>
                      {doc.originalName} <span className="muted">({doc.docType || "?"})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="form-actions">
              <button className="btn primary" type="submit" disabled={ragLoading}>
                {ragLoading ? "Recherche..." : "Lancer la requête RAG"}
              </button>
              {ragError && <p className="helper error">{ragError}</p>}
            </div>
          </form>

          {ragResult && (
            <div id="rag-results" className="stack" style={{ gap: "12px", marginTop: "12px" }}>
              <div className="alert success">
                <strong>Réponse suggérée : </strong>
                <div className="muted">{ragResult.draftAnswer}</div>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Score</th>
                      <th>Extrait</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ragResult.context.chunks.map((chunk, idx) => (
                      <tr key={`${chunk.documentId}-${idx}`}>
                        <td>
                          <div className="stack">
                            <span className="service-name">
                              {docById.get(chunk.documentId)?.originalName || chunk.documentName}
                            </span>
                            <span className="muted small">{chunk.documentType || "doc"}</span>
                          </div>
                        </td>
                        <td className="numeric">{chunk.score.toFixed(3)}</td>
                        <td>{chunk.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fait structuré</th>
                      <th>Catégorie</th>
                      <th>Score</th>
                      <th>Confiance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ragResult.context.extractedFacts.map((fact) => (
                      <tr key={fact.id}>
                        <td>
                          <div className="stack">
                            <span className="service-name">{fact.label}</span>
                            <span className="muted small">{fact.dataPreview}</span>
                          </div>
                        </td>
                        <td>{fact.category}</td>
                        <td className="numeric">{fact.score.toFixed(3)}</td>
                        <td className="numeric">
                          {fact.confidence != null ? `${Math.round(fact.confidence * 100)}%` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Prompt complet ({ragResult.promptSize} caractères)</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{ragResult.prompt}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
      </SectionLayout>
    </section>
  );
}

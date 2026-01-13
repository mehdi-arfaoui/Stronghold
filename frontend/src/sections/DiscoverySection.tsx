import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import { SectionCard } from "../components/ui/SectionCard";
import { InfoBadge } from "../components/ui/InfoBadge";
import type { DiscoveryJob, DiscoverySuggestionResponse } from "../types";
import { apiFetch, apiFetchFormData } from "../utils/api";

interface DiscoverySectionProps {
  configVersion: number;
}

type CloudProviderState = {
  aws: boolean;
  azure: boolean;
  gcp: boolean;
};

type CredentialState = {
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  azureTenantId: string;
  azureClientId: string;
  azureClientSecret: string;
  gcpServiceAccountJson: string;
};

const DEFAULT_CREDENTIALS: CredentialState = {
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  azureTenantId: "",
  azureClientId: "",
  azureClientSecret: "",
  gcpServiceAccountJson: "",
};

function parseIpRanges(raw: string) {
  return raw
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("fr-FR");
}

export function DiscoverySection({ configVersion }: DiscoverySectionProps) {
  const [ipRanges, setIpRanges] = useState("");
  const [providers, setProviders] = useState<CloudProviderState>({
    aws: false,
    azure: false,
    gcp: false,
  });
  const [credentials, setCredentials] = useState<CredentialState>(DEFAULT_CREDENTIALS);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<DiscoveryJob | null>(null);
  const [history, setHistory] = useState<DiscoveryJob[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [githubFilePath, setGithubFilePath] = useState("");
  const [githubRef, setGithubRef] = useState("main");
  const [githubImporting, setGithubImporting] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DiscoverySuggestionResponse | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      const data = await apiFetch("/discovery/history");
      setHistory(data);
    } catch (err: any) {
      setRunError(err.message || "Erreur lors du chargement de l'historique");
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [configVersion]);

  const cloudProviders = useMemo(() => {
    const selected: string[] = [];
    if (providers.aws) selected.push("aws");
    if (providers.azure) selected.push("azure");
    if (providers.gcp) selected.push("gcp");
    return selected;
  }, [providers]);

  const handleRun = async (event: FormEvent) => {
    event.preventDefault();
    setRunError(null);
    setActionMessage(null);
    const ranges = parseIpRanges(ipRanges);
    if (ranges.length === 0) {
      setRunError("Merci de saisir au moins une plage IP.");
      return;
    }
    setRunning(true);

    const payload: any = {
      ipRanges: ranges,
      cloudProviders,
    };

    const creds: Record<string, any> = {};
    if (providers.aws && (credentials.awsAccessKeyId || credentials.awsSecretAccessKey)) {
      creds.aws = {
        accessKeyId: credentials.awsAccessKeyId,
        secretAccessKey: credentials.awsSecretAccessKey,
      };
    }
    if (
      providers.azure &&
      (credentials.azureTenantId || credentials.azureClientId || credentials.azureClientSecret)
    ) {
      creds.azure = {
        tenantId: credentials.azureTenantId,
        clientId: credentials.azureClientId,
        clientSecret: credentials.azureClientSecret,
      };
    }
    if (providers.gcp && credentials.gcpServiceAccountJson) {
      creds.gcp = {
        serviceAccountJson: credentials.gcpServiceAccountJson,
      };
    }
    if (Object.keys(creds).length > 0) {
      payload.credentials = creds;
    }

    try {
      const job = await apiFetch("/discovery/scan", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCurrentJob(job);
      setActionMessage("Découverte lancée. Consultez l'historique pour le suivi.");
      await loadHistory();
    } catch (err: any) {
      setRunError(err.message || "Impossible de lancer la découverte");
    } finally {
      setRunning(false);
    }
  };

  const handleRefreshStatus = async () => {
    if (!currentJob?.id) return;
    try {
      const job = await apiFetch(`/discovery/status/${currentJob.id}`);
      setCurrentJob(job);
    } catch (err: any) {
      setRunError(err.message || "Impossible de rafraîchir le statut");
    }
  };

  const handleProviderChange = (provider: keyof CloudProviderState) => {
    setProviders((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleCredentialChange = (field: keyof CredentialState, value: string) => {
    setCredentials((prev) => ({ ...prev, [field]: value }));
  };

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    setImportError(null);
    setActionMessage(null);
    if (!importFile) {
      setImportError("Sélectionnez un fichier CSV ou JSON.");
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const job = await apiFetchFormData("/discovery/import", formData);
      setCurrentJob(job);
      setImportFile(null);
      setActionMessage("Import terminé et données insérées.");
      await loadHistory();
    } catch (err: any) {
      setImportError(err.message || "Erreur lors de l'import");
    } finally {
      setImporting(false);
    }
  };

  const handleSuggest = async () => {
    setSuggestError(null);
    setSuggestions(null);
    if (!importFile) {
      setSuggestError("Sélectionnez un fichier CSV ou JSON pour générer des suggestions.");
      return;
    }
    setSuggesting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const response = await apiFetchFormData("/discovery/suggestions", formData);
      setSuggestions(response as DiscoverySuggestionResponse);
    } catch (err: any) {
      setSuggestError(err.message || "Impossible de générer les suggestions");
    } finally {
      setSuggesting(false);
    }
  };

  const handleGitHubImport = async (event: FormEvent) => {
    event.preventDefault();
    setGithubError(null);
    setActionMessage(null);
    if (!githubRepoUrl || !githubFilePath) {
      setGithubError("Renseignez l'URL du dépôt GitHub et le chemin du fichier.");
      return;
    }
    setGithubImporting(true);
    try {
      const job = await apiFetch("/discovery/github-import", {
        method: "POST",
        body: JSON.stringify({
          repoUrl: githubRepoUrl,
          filePath: githubFilePath,
          ref: githubRef || undefined,
        }),
      });
      setCurrentJob(job);
      setActionMessage("Import GitHub terminé et données insérées.");
      await loadHistory();
    } catch (err: any) {
      setGithubError(err.message || "Erreur lors de l'import GitHub");
    } finally {
      setGithubImporting(false);
    }
  };

  const latestJobs = history.slice(0, 6);
  const progressValue = currentJob?.progress ?? (history.length > 0 ? 60 : 10);
  const progressLabel = currentJob
    ? `Job ${currentJob.status.toLowerCase()} (${currentJob.progress}%)`
    : history.length > 0
      ? "Découvertes disponibles"
      : "Aucun scan lancé";

  return (
    <div className="section-stack">
      <PageIntro
        title="Découverte"
        objective="Lancez une découverte réseau/cloud, ou importez un export NetFlow/CMDB pour enrichir la cartographie."
        steps={[
          "Définir les plages IP et connecteurs cloud",
          "Lancer un scan ou importer un export",
          "Valider les suggestions de correspondance",
          "Confirmer l'import pour créer services et dépendances",
        ]}
        tips={[
          "Ajoutez un identifiant cloud uniquement si nécessaire (AWS/Azure/GCP).",
          "Utilisez l'analyse automatique pour retrouver les services déjà connus.",
          "Les dépendances issues des exports seront préremplies lors de l'import.",
        ]}
        links={[
          { label: "Lancer un scan", href: "#discovery-run", description: "Réseau/Cloud" },
          { label: "Importer un export", href: "#discovery-import", description: "CSV/JSON" },
          { label: "Importer depuis GitHub", href: "#discovery-github", description: "Repo public" },
          { label: "Wizard de mapping", href: "#discovery-wizard", description: "Suggestions" },
        ]}
        expectedData={[
          "Plages IP (CIDR) ou exports CMDB/NetFlow",
          "Connecteurs cloud sélectionnés",
          "Services existants pour le matching",
        ]}
        progress={{
          value: progressValue,
          label: progressLabel,
        }}
      />

      {actionMessage && <div className="alert success">{actionMessage}</div>}

      {!currentJob && history.length === 0 && !loadingHistory ? (
        <SectionCard
          eyebrow="Statut"
          title="Aucune découverte en cours"
          description="Lancez un scan ou importez un export pour remplir la cartographie."
        >
          <p className="muted small">
            Les premiers résultats apparaîtront dans l'historique dès la fin du scan ou de l'import.
          </p>
        </SectionCard>
      ) : null}

      <div id="discovery-run">
        <SectionCard
        eyebrow="Découverte réseau"
        title="Lancer un scan"
        description="Saisissez vos plages IP et ajoutez des identifiants cloud si nécessaire."
      >
        <form className="form-grid" onSubmit={handleRun}>
          <label className="form-field">
            <span>Plages IP (CIDR, séparées par des virgules ou lignes)</span>
            <textarea
              rows={3}
              value={ipRanges}
              onChange={(event) => setIpRanges(event.target.value)}
              placeholder="10.0.0.0/24, 10.0.1.0/24"
            />
          </label>

          <div className="form-field">
            <span>Connecteurs cloud à interroger</span>
            <div className="checkbox-group">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={providers.aws}
                  onChange={() => handleProviderChange("aws")}
                />
                AWS
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={providers.azure}
                  onChange={() => handleProviderChange("azure")}
                />
                Azure
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={providers.gcp}
                  onChange={() => handleProviderChange("gcp")}
                />
                GCP
              </label>
            </div>
          </div>

          {providers.aws && (
            <div className="form-grid">
              <label className="form-field">
                <span>AWS Access Key ID</span>
                <input
                  type="password"
                  value={credentials.awsAccessKeyId}
                  onChange={(event) => handleCredentialChange("awsAccessKeyId", event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>AWS Secret Access Key</span>
                <input
                  type="password"
                  value={credentials.awsSecretAccessKey}
                  onChange={(event) => handleCredentialChange("awsSecretAccessKey", event.target.value)}
                />
              </label>
            </div>
          )}

          {providers.azure && (
            <div className="form-grid">
              <label className="form-field">
                <span>Azure Tenant ID</span>
                <input
                  type="password"
                  value={credentials.azureTenantId}
                  onChange={(event) => handleCredentialChange("azureTenantId", event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Azure Client ID</span>
                <input
                  type="password"
                  value={credentials.azureClientId}
                  onChange={(event) => handleCredentialChange("azureClientId", event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Azure Client Secret</span>
                <input
                  type="password"
                  value={credentials.azureClientSecret}
                  onChange={(event) => handleCredentialChange("azureClientSecret", event.target.value)}
                />
              </label>
            </div>
          )}

          {providers.gcp && (
            <label className="form-field">
              <span>GCP Service Account JSON</span>
              <textarea
                rows={4}
                value={credentials.gcpServiceAccountJson}
                onChange={(event) =>
                  handleCredentialChange("gcpServiceAccountJson", event.target.value)
                }
              />
            </label>
          )}

          {runError && <div className="alert error">{runError}</div>}
          <div className="button-group">
            <button className="primary" type="submit" disabled={running}>
              {running ? "Scan en cours..." : "Lancer la découverte"}
            </button>
            {currentJob && (
              <button type="button" className="ghost" onClick={handleRefreshStatus}>
                Rafraîchir le statut
              </button>
            )}
          </div>
        </form>
      </SectionCard>
      </div>

      <div id="discovery-import">
        <SectionCard
        eyebrow="Import NetFlow"
        title="Importer un export CSV/JSON"
        description="Chargez un export Faddom ou équivalent pour créer des services et dépendances."
      >
        <form className="form-grid" onSubmit={handleImport}>
          <label className="form-field">
            <span>Fichier d'export</span>
            <input
              type="file"
              accept=".csv,.json"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setImportFile(event.target.files?.[0] || null)
              }
            />
          </label>
            {importError && <div className="alert error">{importError}</div>}
            <button className="primary" type="submit" disabled={importing}>
              {importing ? "Import en cours..." : "Importer l'export"}
            </button>
        </form>
      </SectionCard>
      </div>

      <div id="discovery-github">
        <SectionCard
          eyebrow="Import GitHub"
          title="Importer depuis un dépôt GitHub"
          description="Récupérez un export JSON depuis un dépôt GitHub public pour alimenter la cartographie."
        >
          <form className="form-grid" onSubmit={handleGitHubImport}>
            <label className="form-field">
              <span>URL du dépôt GitHub</span>
              <input
                type="url"
                value={githubRepoUrl}
                onChange={(event) => setGithubRepoUrl(event.target.value)}
                placeholder="https://github.com/organisation/infra-discovery"
              />
            </label>
            <label className="form-field">
              <span>Chemin du fichier JSON</span>
              <input
                type="text"
                value={githubFilePath}
                onChange={(event) => setGithubFilePath(event.target.value)}
                placeholder="exports/discovery.json"
              />
            </label>
            <label className="form-field">
              <span>Branche ou tag</span>
              <input
                type="text"
                value={githubRef}
                onChange={(event) => setGithubRef(event.target.value)}
                placeholder="main"
              />
            </label>
            {githubError && <div className="alert error">{githubError}</div>}
            <button className="primary" type="submit" disabled={githubImporting}>
              {githubImporting ? "Import en cours..." : "Importer depuis GitHub"}
            </button>
          </form>
        </SectionCard>
      </div>

      <div id="discovery-wizard">
        <SectionCard
          eyebrow="Wizard de correspondance"
          title="Suggérer les services existants"
          description="Analysez l'export pour rapprocher les éléments découverts du catalogue actuel."
        >
          <div className="stack">
            <button type="button" className="btn primary" onClick={handleSuggest} disabled={suggesting}>
              {suggesting ? "Analyse en cours..." : "Analyser l'export"}
            </button>
            {suggestError && <div className="alert error">{suggestError}</div>}
            {suggestions ? (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Élément détecté</th>
                      <th>Type</th>
                      <th>Suggestion</th>
                      <th>Score</th>
                      <th>RTO/RPO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.suggestions.map((suggestion) => (
                      <tr key={suggestion.externalId}>
                        <td>{suggestion.name}</td>
                        <td>{suggestion.kind}</td>
                        <td>
                          {suggestion.match ? suggestion.match.name : "Aucune correspondance"}
                        </td>
                        <td>{suggestion.match ? `${Math.round(suggestion.match.score * 100)}%` : "-"}</td>
                        <td>
                          {suggestion.match
                            ? `RTO ${suggestion.match.rtoHours ?? "-"}h · RPO ${suggestion.match.rpoMinutes ?? "-"}m`
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted small">
                  {suggestions.summary.serviceNodes} services et {suggestions.summary.infraNodes} composants infra détectés,
                  {` ${suggestions.summary.edges} dépendances prêtes à être importées.`}
                </p>
              </div>
            ) : (
              <p className="muted small">
                Chargez un export pour visualiser les correspondances suggérées avec votre catalogue.
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        eyebrow="Suivi"
        title="Derniers scans"
        description="Suivez l'état des dernières découvertes et imports."
      >
        {currentJob && (
          <div className="inline-card">
            <div>
              <strong>Job en cours:</strong> {currentJob.id}
            </div>
            <div className="inline-info">
              <InfoBadge variant="subtle">{currentJob.status}</InfoBadge>
              <span>{currentJob.progress}%</span>
            </div>
          </div>
        )}

        {loadingHistory ? (
          <div className="skeleton">Chargement...</div>
        ) : latestJobs.length === 0 ? (
          <div className="empty-state">Aucun scan lancé pour le moment.</div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Type</th>
                  <th>Statut</th>
                  <th>Progression</th>
                  <th>Créé</th>
                  <th>Résultat</th>
                </tr>
              </thead>
              <tbody>
                {latestJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id.slice(0, 8)}</td>
                    <td>{job.jobType}</td>
                    <td>{job.status}</td>
                    <td>{job.progress}%</td>
                    <td>{formatDate(job.createdAt)}</td>
                    <td>
                      {job.resultSummary ? (
                        <span className="muted small">
                          Services: {job.resultSummary.createdServices ?? 0} · Infra:{" "}
                          {job.resultSummary.createdInfra ?? 0}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

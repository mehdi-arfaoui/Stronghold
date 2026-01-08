import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import { SectionCard } from "../components/ui/SectionCard";
import { InfoBadge } from "../components/ui/InfoBadge";
import type { DiscoveryJob } from "../types";
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
      const job = await apiFetch("/discovery/run", {
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

  const latestJobs = history.slice(0, 6);

  return (
    <div className="section-stack">
      <PageIntro
        title="Découverte"
        description="Lancez une découverte réseau/cloud, ou importez un export NetFlow/CMDB pour enrichir le graphe."
      />

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
          {actionMessage && <div className="alert success">{actionMessage}</div>}

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

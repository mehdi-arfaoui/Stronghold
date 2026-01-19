import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageIntro } from "../components/PageIntro";
import { SectionCard } from "../components/ui/SectionCard";
import { InfoBadge } from "../components/ui/InfoBadge";
import type { DiscoveryJob } from "../types";
import { apiFetch, apiFetchFormData } from "../utils/api";
import { useDiscovery } from "../context/DiscoveryContext";
import { UploadDropzone } from "../components/discovery/UploadDropzone";
import {
  CloudCredentialsFields,
  type CloudCredentials,
} from "../components/discovery/CloudCredentialsFields";
import { DiscoveryProgress } from "../components/discovery/DiscoveryProgress";
import "./DiscoveryPage.css";

interface DiscoveryPageProps {
  configVersion: number;
}

type CloudProviderState = {
  aws: boolean;
  azure: boolean;
  gcp: boolean;
};

type ConnectorState = {
  snmp: boolean;
  ssh: boolean;
  wmi: boolean;
  hyperv: boolean;
  vmware: boolean;
  k8s: boolean;
};

const DEFAULT_CREDENTIALS: CloudCredentials = {
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  azureTenantId: "",
  azureClientId: "",
  azureClientSecret: "",
  gcpServiceAccountJson: "",
};

const DISCOVERY_STEPS = [
  {
    id: "QUEUED",
    label: "Préparation",
    description: "Planification et validation des paramètres.",
  },
  {
    id: "SCAN_NETWORK",
    label: "Scan réseau",
    description: "Collecte des hôtes et segments on-prem.",
  },
  {
    id: "FETCH_CLOUD",
    label: "Scan cloud",
    description: "API AWS/Azure/GCP, inventaire cloud.",
  },
  {
    id: "INVENTORY_VIRTUAL",
    label: "Virtualisation",
    description: "Hyper-V, VMware, Kubernetes.",
  },
  {
    id: "CORRELATE_RESOURCES",
    label: "Corrélation",
    description: "Déduplication et enrichissement des ressources.",
  },
  {
    id: "MAP_TO_DB",
    label: "Synchronisation",
    description: "Mise à jour de la cartographie.",
  },
];

function parseIpRanges(raw: string) {
  return raw
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeProviderKey(provider: string) {
  return provider.toLowerCase();
}

export function DiscoveryPage({ configVersion }: DiscoveryPageProps) {
  const navigate = useNavigate();
  const { discoveryCompleted, setDiscoveryCompleted } = useDiscovery();
  const [ipRanges, setIpRanges] = useState("");
  const [providers, setProviders] = useState<CloudProviderState>({
    aws: false,
    azure: false,
    gcp: false,
  });
  const [connectors, setConnectors] = useState<ConnectorState>({
    snmp: true,
    ssh: true,
    wmi: false,
    hyperv: false,
    vmware: false,
    k8s: false,
  });
  const [credentials, setCredentials] = useState<CloudCredentials>(DEFAULT_CREDENTIALS);
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const cloudProviders = useMemo(
    () =>
      Object.entries(providers)
        .filter(([, enabled]) => enabled)
        .map(([provider]) => normalizeProviderKey(provider)),
    [providers]
  );

  const activeConnectors = useMemo(
    () =>
      Object.entries(connectors)
        .filter(([, enabled]) => enabled)
        .map(([connector]) => connector),
    [connectors]
  );

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      const data = (await apiFetch("/discovery/history")) as DiscoveryJob[];
      setHistory(data);
      if (data.some((job) => job.status === "COMPLETED")) {
        setDiscoveryCompleted(true);
      }
    } catch (err: any) {
      setRunError(err.message || "Erreur lors du chargement de l'historique");
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [configVersion]);

  useEffect(() => {
    if (!currentJob?.id) return;
    let isMounted = true;
    const pollStatus = async () => {
      try {
        const job = (await apiFetch(`/discovery/status/${currentJob.id}`)) as DiscoveryJob;
        if (!isMounted) return;
        setCurrentJob(job);
        if (job.status === "COMPLETED") {
          setDiscoveryCompleted(true);
        }
      } catch (error: any) {
        if (!isMounted) return;
        setRunError(error.message || "Impossible de rafraîchir le statut");
      }
    };

    void pollStatus();
    const interval = window.setInterval(pollStatus, 3000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [currentJob?.id, setDiscoveryCompleted]);

  useEffect(() => {
    if (!discoveryCompleted || currentJob?.status !== "COMPLETED") return;
    const timeout = window.setTimeout(() => {
      navigate("/services");
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [currentJob?.status, discoveryCompleted, navigate]);

  const handleRun = async (event: FormEvent) => {
    event.preventDefault();
    setRunError(null);
    setActionMessage(null);
    const ranges = parseIpRanges(ipRanges);
    if (ranges.length === 0 && cloudProviders.length === 0) {
      setRunError("Merci de saisir au moins une plage IP ou un connecteur cloud.");
      return;
    }
    setRunning(true);

    const payload: Record<string, unknown> = {
      ipRanges: ranges,
      cloudProviders: cloudProviders.map((provider) => provider.toUpperCase()),
      connectors: activeConnectors,
    };

    if (providers.aws) {
      payload.awsCredentials = {
        accessKeyId: credentials.awsAccessKeyId,
        secretAccessKey: credentials.awsSecretAccessKey,
      };
    }
    if (providers.azure) {
      payload.azureCredentials = {
        tenantId: credentials.azureTenantId,
        clientId: credentials.azureClientId,
        clientSecret: credentials.azureClientSecret,
      };
    }
    if (providers.gcp && credentials.gcpServiceAccountJson) {
      payload.gcpCredentials = {
        serviceAccountJson: credentials.gcpServiceAccountJson,
      };
    }

    try {
      const job = (await apiFetch("/discovery/scan", {
        method: "POST",
        body: JSON.stringify(payload),
      })) as DiscoveryJob;
      setCurrentJob(job);
      setActionMessage("Découverte lancée. Suivez la progression en temps réel.");
      await loadHistory();
    } catch (err: any) {
      setRunError(err.message || "Impossible de lancer la découverte");
    } finally {
      setRunning(false);
    }
  };

  const handleConnectorChange = (connector: keyof ConnectorState) => {
    setConnectors((prev) => ({ ...prev, [connector]: !prev[connector] }));
  };

  const handleProviderChange = (provider: keyof CloudProviderState) => {
    setProviders((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleCredentialChange = (field: keyof CloudCredentials, value: string) => {
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
      const job = (await apiFetchFormData("/discovery/import", formData)) as DiscoveryJob;
      setCurrentJob(job);
      setImportFile(null);
      setActionMessage("Import terminé. Les ressources sont en cours de consolidation.");
      await loadHistory();
    } catch (err: any) {
      setImportError(err.message || "Erreur lors de l'import");
    } finally {
      setImporting(false);
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
      const job = (await apiFetch("/discovery/github-import", {
        method: "POST",
        body: JSON.stringify({
          repoUrl: githubRepoUrl,
          filePath: githubFilePath,
          ref: githubRef || undefined,
        }),
      })) as DiscoveryJob;
      setCurrentJob(job);
      setActionMessage("Import GitHub lancé. La cartographie se met à jour.");
      await loadHistory();
    } catch (err: any) {
      setGithubError(err.message || "Erreur lors de l'import GitHub");
    } finally {
      setGithubImporting(false);
    }
  };

  const handleRefreshStatus = async () => {
    if (!currentJob?.id) return;
    try {
      const job = (await apiFetch(`/discovery/status/${currentJob.id}`)) as DiscoveryJob;
      setCurrentJob(job);
    } catch (error: any) {
      setRunError(error.message || "Impossible de rafraîchir le statut");
    }
  };

  const latestJobs = history.slice(0, 5);
  const progressValue = currentJob?.progress ?? (history.length > 0 ? 60 : 5);
  const progressLabel = currentJob
    ? `Job ${currentJob.status.toLowerCase()} · ${currentJob.progress}%`
    : history.length > 0
      ? "Découvertes disponibles"
      : "Aucune découverte lancée";
  const resourceCount =
    currentJob?.resultSummary?.discoveredResources ??
    currentJob?.resultSummary?.discoveredHosts ??
    history[0]?.resultSummary?.discoveredResources ??
    0;

  return (
    <div className="section-stack discovery-page">
      <PageIntro
        title="Découverte"
        objective="Rassemblez les scans réseau, imports et sources cloud sur une seule page de découverte."
        steps={[
          "Définir les plages IP et connecteurs",
          "Lancer un scan ou un import",
          "Suivre la progression en temps réel",
          "Accéder à la consolidation des services",
        ]}
        tips={[
          "Les imports CSV/JSON peuvent être glissés-déposés pour accélérer la collecte.",
          "Les connecteurs cloud sont optionnels et ne sont interrogés que si activés.",
        ]}
        links={[
          { label: "Lancer un scan", href: "#discovery-run", description: "Réseau/Cloud" },
          { label: "Importer un export", href: "#discovery-import", description: "CSV/JSON" },
          { label: "Importer depuis GitHub", href: "#discovery-github", description: "Repo public" },
        ]}
        expectedData={[
          "Plages IP ou exports CMDB/NetFlow",
          "Connecteurs SNMP/SSH/WMI/Hyper-V/VMware/K8s",
          "Identifiants cloud si nécessaires",
        ]}
        progress={{
          value: progressValue,
          label: progressLabel,
        }}
      />

      {actionMessage && <div className="alert success">{actionMessage}</div>}

      <div className="discovery-layout">
        <div className="discovery-main">
          <div id="discovery-run">
            <SectionCard
              eyebrow="Découverte réseau"
              title="Lancer un scan on-prem & cloud"
              description="Saisissez vos plages IP et activez les connecteurs nécessaires."
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
                  <span>Connecteurs on-prem</span>
                  <div className="checkbox-grid">
                    {[
                      { key: "snmp", label: "SNMP" },
                      { key: "ssh", label: "SSH" },
                      { key: "wmi", label: "WMI" },
                      { key: "hyperv", label: "Hyper-V" },
                      { key: "vmware", label: "VMware" },
                      { key: "k8s", label: "Kubernetes" },
                    ].map((connector) => (
                      <label key={connector.key} className="checkbox">
                        <input
                          type="checkbox"
                          checked={connectors[connector.key as keyof ConnectorState]}
                          onChange={() =>
                            handleConnectorChange(connector.key as keyof ConnectorState)
                          }
                        />
                        {connector.label}
                      </label>
                    ))}
                  </div>
                </div>

                <CloudCredentialsFields
                  providers={providers}
                  credentials={credentials}
                  onToggleProvider={handleProviderChange}
                  onCredentialChange={handleCredentialChange}
                />

                {runError && <div className="alert error">{runError}</div>}
                <div className="button-group">
                  <button className="primary" type="submit" disabled={running}>
                    {running ? "Scan en cours..." : "Lancer la découverte"}
                  </button>
                  {currentJob && (
                    <button type="button" className="ghost" onClick={handleRefreshStatus}>
                      Rafraîchir
                    </button>
                  )}
                </div>
              </form>
            </SectionCard>
          </div>

          <div id="discovery-import">
            <SectionCard
              eyebrow="Import"
              title="Importer un export CSV/JSON"
              description="Chargez un export CMDB ou NetFlow pour alimenter la cartographie."
            >
              <form className="form-grid" onSubmit={handleImport}>
                <UploadDropzone
                  label="Fichier d'export"
                  helper="CSV ou JSON, 10 Mo max"
                  accept={[".csv", ".json"]}
                  maxSizeMb={10}
                  file={importFile}
                  onFileChange={(file) => {
                    setImportFile(file);
                    setValidationError(null);
                  }}
                  onValidationError={setValidationError}
                />
                {validationError && <div className="alert error">{validationError}</div>}
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
              title="Importer un export via GitHub"
              description="Récupérez un export JSON depuis un dépôt GitHub public."
            >
              <form className="form-grid" onSubmit={handleGitHubImport}>
                <label className="form-field">
                  <span>URL du dépôt GitHub</span>
                  <input
                    type="url"
                    value={githubRepoUrl}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setGithubRepoUrl(event.target.value)
                    }
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
        </div>

        <div className="discovery-side">
          <DiscoveryProgress job={currentJob} steps={DISCOVERY_STEPS} resourceCount={resourceCount} />
          <SectionCard
            eyebrow="Suivi"
            title="Dernières opérations"
            description="Historique des scans et imports."
          >
            {loadingHistory ? (
              <div className="skeleton">Chargement...</div>
            ) : latestJobs.length === 0 ? (
              <div className="empty-state">Aucun scan lancé pour le moment.</div>
            ) : (
              <div className="stack">
                {latestJobs.map((job) => (
                  <div key={job.id} className="inline-card">
                    <div>
                      <strong>{job.jobType}</strong>
                      <div className="muted small">{job.id.slice(0, 8)}</div>
                    </div>
                    <div className="inline-info">
                      <InfoBadge variant="subtle">{job.status}</InfoBadge>
                      <span>{job.progress}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

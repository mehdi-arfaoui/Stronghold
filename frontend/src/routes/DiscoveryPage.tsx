import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageIntro } from "../components/PageIntro";
import { SectionCard } from "../components/ui/SectionCard";
import { InfoBadge } from "../components/ui/InfoBadge";
import type { DiscoveryJob } from "../types";
import { apiFetch, apiFetchFormData, getDiscoveryWebSocketUrl } from "../utils/api";
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

type DiscoveryAction = "scan" | "import" | "github";

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
  const [activeAction, setActiveAction] = useState<DiscoveryAction>("scan");
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
  const [realtimeConnected, setRealtimeConnected] = useState(false);

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

  const loadHistory = useCallback(async () => {
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
  }, [setDiscoveryCompleted]);

  useEffect(() => {
    loadHistory();
  }, [configVersion, loadHistory]);

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
          void loadHistory();
        }
      } catch (error: any) {
        if (!isMounted) return;
        setRunError(error.message || "Impossible de rafraîchir le statut");
      }
    };

    void pollStatus();
    return () => {
      isMounted = false;
    };
  }, [currentJob?.id, loadHistory, setDiscoveryCompleted]);

  useEffect(() => {
    if (!currentJob?.id || realtimeConnected) return;
    const interval = window.setInterval(async () => {
      try {
        const job = (await apiFetch(`/discovery/status/${currentJob.id}`)) as DiscoveryJob;
        setCurrentJob(job);
        if (job.status === "COMPLETED") {
          setDiscoveryCompleted(true);
          void loadHistory();
        }
      } catch (error: any) {
        setRunError(error.message || "Impossible de rafraîchir le statut");
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [currentJob?.id, loadHistory, realtimeConnected, setDiscoveryCompleted]);

  useEffect(() => {
    const wsUrl = getDiscoveryWebSocketUrl();
    if (!wsUrl || typeof window === "undefined") return;
    let isMounted = true;
    const socket = new WebSocket(wsUrl);

    const handleOpen = () => {
      if (!isMounted) return;
      setRealtimeConnected(true);
    };

    const handleClose = () => {
      if (!isMounted) return;
      setRealtimeConnected(false);
    };

    const handleMessage = (event: MessageEvent) => {
      if (!isMounted) return;
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          jobId?: string;
          status?: string | null;
          step?: string | null;
          progress?: number | null;
          summary?: DiscoveryJob["resultSummary"] | null;
          errorMessage?: string | null;
          completedAt?: string | null;
        };
        if (payload.type !== "discovery.progress" || !payload.jobId) return;

        setCurrentJob((prev) => {
          if (prev && prev.id !== payload.jobId) return prev;
          const now = new Date().toISOString();
          return {
            id: payload.jobId,
            status: payload.status ?? prev?.status ?? "RUNNING",
            jobType: prev?.jobType ?? "DISCOVERY",
            progress: payload.progress ?? prev?.progress ?? 0,
            step: payload.step ?? prev?.step ?? null,
            resultSummary: payload.summary ?? prev?.resultSummary ?? null,
            errorMessage: payload.errorMessage ?? prev?.errorMessage ?? null,
            createdAt: prev?.createdAt ?? now,
            updatedAt: now,
            startedAt: prev?.startedAt ?? now,
            completedAt: payload.completedAt ?? prev?.completedAt ?? null,
          };
        });

        if (payload.status === "COMPLETED") {
          setDiscoveryCompleted(true);
          void loadHistory();
        }
      } catch (_error) {
        // Ignore malformed websocket payloads.
      }
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleClose);
    socket.addEventListener("message", handleMessage);

    return () => {
      isMounted = false;
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleClose);
      socket.removeEventListener("message", handleMessage);
      socket.close();
    };
  }, [configVersion, loadHistory, setDiscoveryCompleted]);

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
  const activeTabLabel = {
    scan: "Scan réseau & cloud",
    import: "Import CSV/JSON",
    github: "Import GitHub",
  } as const;

  return (
    <div className="section-stack discovery-page">
      <PageIntro
        title="Découverte"
        objective="Unifiez scan réseau, imports et sources cloud sur un seul écran pour accélérer la cartographie."
        steps={[
          "Choisir un mode (scan, import ou GitHub)",
          "Configurer les paramètres requis",
          "Suivre la progression en temps réel",
          "Déverrouiller les autres modules",
        ]}
        tips={[
          "La progression temps réel est poussée via WebSocket quand disponible.",
          "Les imports CSV/JSON peuvent être glissés-déposés pour accélérer la collecte.",
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
      {discoveryCompleted && (
        <div className="alert success discovery-complete-banner">
          <div>
            <strong>Découverte terminée.</strong> Les autres onglets sont désormais déverrouillés.
          </div>
          <button type="button" className="primary" onClick={() => navigate("/services")}>
            Aller aux services
          </button>
        </div>
      )}

      <div className="discovery-layout">
        <div className="discovery-main">
          <DiscoveryProgress
            job={currentJob}
            steps={DISCOVERY_STEPS}
            resourceCount={resourceCount}
            statusNote={realtimeConnected ? "Temps réel" : "Polling"}
          />
          <SectionCard
            eyebrow="Lancement"
            title="Configurer la découverte"
            description="Choisissez un mode de collecte puis lancez le scan ou l'import."
          >
            <div className="discovery-action-tabs" role="tablist" aria-label="Modes de découverte">
              {(Object.keys(activeTabLabel) as DiscoveryAction[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={activeAction === mode}
                  className={activeAction === mode ? "active" : undefined}
                  onClick={() => setActiveAction(mode)}
                >
                  <span>{activeTabLabel[mode]}</span>
                </button>
              ))}
            </div>
            <div className="discovery-action-panel" role="tabpanel">
              {activeAction === "scan" && (
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
              )}

              {activeAction === "import" && (
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
              )}

              {activeAction === "github" && (
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
              )}
            </div>
          </SectionCard>
        </div>

        <div className="discovery-side">
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

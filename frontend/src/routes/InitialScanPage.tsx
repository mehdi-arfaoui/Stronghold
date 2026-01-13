import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { SectionCard } from "../components/ui/SectionCard";
import { ProgressOverlay } from "../components/initialScan/ProgressOverlay";
import type { DiscoveryJob } from "../types";
import { apiFetch, apiFetchFormData } from "../utils/api";
import "./InitialScanPage.css";

const DOC_TYPES = ["ARCHI", "CMDB", "POLICY", "RUNBOOK", "BACKUP_POLICY", "RISK", "OTHER"];

const SCAN_STEPS = [
  {
    id: "SCAN_NETWORK",
    label: "Scan réseau",
    description: "Découverte des hôtes et segments IP.",
  },
  {
    id: "FETCH_CLOUD",
    label: "Scan cloud",
    description: "Collecte des ressources AWS/Azure/GCP.",
  },
  {
    id: "INVENTORY_VIRTUAL",
    label: "Extraction des dépendances",
    description: "Analyse des dépendances et environnements virtuels.",
  },
  { id: "CORRELATE_RESOURCES", label: "Corrélation", description: "Déduplique les ressources." },
  { id: "MAP_TO_DB", label: "Synchronisation", description: "Mise à jour de la cartographie." },
];

type InitialScanPageProps = {
  onContinue: () => void;
};

export function InitialScanPage({ onContinue }: InitialScanPageProps) {
  const [ipRanges, setIpRanges] = useState("");
  const [enableAws, setEnableAws] = useState(false);
  const [enableAzure, setEnableAzure] = useState(false);
  const [enableGcp, setEnableGcp] = useState(false);
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [azureTenantId, setAzureTenantId] = useState("");
  const [azureClientId, setAzureClientId] = useState("");
  const [azureClientSecret, setAzureClientSecret] = useState("");
  const [gcpServiceAccountJson, setGcpServiceAccountJson] = useState("");
  const [scanJob, setScanJob] = useState<DiscoveryJob | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("ARCHI");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const scanCompleted = scanJob?.status === "COMPLETED";
  const scanFailed = scanJob?.status === "FAILED";

  const parsedIpRanges = useMemo(
    () =>
      ipRanges
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    [ipRanges]
  );

  const cloudProviders = useMemo(() => {
    return [
      enableAws ? "AWS" : null,
      enableAzure ? "AZURE" : null,
      enableGcp ? "GCP" : null,
    ].filter(Boolean) as string[];
  }, [enableAws, enableAzure, enableGcp]);

  const buildCredentialsPayload = useCallback(() => {
    const credentials: Record<string, unknown> = {};

    if (enableAws && (awsAccessKeyId.trim() || awsSecretAccessKey.trim())) {
      credentials.awsCredentials = {
        accessKeyId: awsAccessKeyId.trim(),
        secretAccessKey: awsSecretAccessKey.trim(),
      };
    }

    if (enableAzure && (azureTenantId.trim() || azureClientId.trim() || azureClientSecret.trim())) {
      credentials.azureCredentials = {
        tenantId: azureTenantId.trim(),
        clientId: azureClientId.trim(),
        clientSecret: azureClientSecret.trim(),
      };
    }

    if (enableGcp && gcpServiceAccountJson.trim()) {
      credentials.gcpCredentials = {
        serviceAccountJson: gcpServiceAccountJson.trim(),
      };
    }

    return Object.keys(credentials).length > 0 ? credentials : null;
  }, [
    awsAccessKeyId,
    awsSecretAccessKey,
    azureClientId,
    azureClientSecret,
    azureTenantId,
    enableAws,
    enableAzure,
    enableGcp,
    gcpServiceAccountJson,
  ]);

  const handleStartScan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScanError(null);
    setScanJob(null);

    try {
      setIsScanning(true);
      const credentialsPayload = buildCredentialsPayload();
      const payload = {
        ipRanges: parsedIpRanges,
        cloudProviders,
        ...(credentialsPayload || {}),
      };
      const job = (await apiFetch("/discovery/scan", {
        method: "POST",
        body: JSON.stringify(payload),
      })) as DiscoveryJob;

      setJobId(job.id);
      setScanJob(job);
    } catch (error: any) {
      setScanError(error.message || "Impossible de lancer le scan.");
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (!jobId) return;
    let isMounted = true;
    const pollStatus = async () => {
      try {
        const status = (await apiFetch(`/discovery/status/${jobId}`)) as DiscoveryJob;
        if (!isMounted) return;
        setScanJob(status);
        if (status.status === "COMPLETED" || status.status === "FAILED") {
          setIsScanning(false);
        }
      } catch (error: any) {
        if (!isMounted) return;
        setScanError(error.message || "Erreur lors de la récupération du statut.");
        setIsScanning(false);
      }
    };

    void pollStatus();
    const interval = window.setInterval(pollStatus, 2000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [jobId]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setUploadError("Sélectionnez un fichier avant l'envoi.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docType", docType);
      if (description.trim()) formData.append("description", description.trim());
      await apiFetchFormData("/documents", formData);
      setUploadSuccess("Document importé. Vous pouvez lancer l'extraction dans l'onglet Documents.");
      setFile(null);
      setDescription("");
    } catch (error: any) {
      setUploadError(error.message || "Échec de l'upload.");
    } finally {
      setUploading(false);
    }
  };

  const summary = scanJob?.resultSummary;
  const overlaySummary = summary ? (
    <ul className="summary-list">
      <li>
        Ressources détectées : <strong>{summary.discoveredResources ?? 0}</strong>
      </li>
      <li>
        Services créés : <strong>{summary.createdServices ?? 0}</strong>
      </li>
      <li>
        Infrastructures créées : <strong>{summary.createdInfra ?? 0}</strong>
      </li>
      <li>
        Dépendances ajoutées : <strong>{summary.createdDependencies ?? 0}</strong>
      </li>
    </ul>
  ) : (
    <p className="muted small">Les résultats seront affichés au fur et à mesure.</p>
  );

  return (
    <div className="initial-scan-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Scan initial</p>
          <h1>Cartographiez votre infrastructure pour démarrer</h1>
          <p className="muted">
            Pour garantir une cartographie précise de votre infrastructure et éviter toute perte de
            données, veuillez commencer par effectuer un scan initial de vos environnements.
          </p>
        </div>
      </div>

      <SectionCard
        eyebrow="Démarrage"
        title="Configurer le scan initial"
        description="Renseignez vos plages IP et activez la découverte cloud si nécessaire."
      >
        <form className="initial-scan-form" onSubmit={handleStartScan}>
          <label htmlFor="ipRanges">Plages IP à scanner</label>
          <textarea
            id="ipRanges"
            placeholder="192.168.1.0/24, 10.0.0.0/16"
            value={ipRanges}
            onChange={(event) => setIpRanges(event.target.value)}
            rows={3}
          />
          <p className="helper muted">
            Séparez les plages par une virgule ou un retour à la ligne.
          </p>

          <div className="cloud-toggle-grid">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={enableAws}
                onChange={(event) => setEnableAws(event.target.checked)}
              />
              Activer la découverte AWS
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={enableAzure}
                onChange={(event) => setEnableAzure(event.target.checked)}
              />
              Activer la découverte Azure
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={enableGcp}
                onChange={(event) => setEnableGcp(event.target.checked)}
              />
              Activer la découverte GCP
            </label>
          </div>

          {enableAws && (
            <div className="cloud-credentials">
              <h3>Identifiants AWS</h3>
              <label htmlFor="awsAccessKey">Access key</label>
              <input
                id="awsAccessKey"
                type="text"
                value={awsAccessKeyId}
                onChange={(event) => setAwsAccessKeyId(event.target.value)}
                autoComplete="off"
              />
              <label htmlFor="awsSecret">Secret access key</label>
              <input
                id="awsSecret"
                type="password"
                value={awsSecretAccessKey}
                onChange={(event) => setAwsSecretAccessKey(event.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {enableAzure && (
            <div className="cloud-credentials">
              <h3>Identifiants Azure</h3>
              <label htmlFor="azureTenant">Tenant ID</label>
              <input
                id="azureTenant"
                type="text"
                value={azureTenantId}
                onChange={(event) => setAzureTenantId(event.target.value)}
                autoComplete="off"
              />
              <label htmlFor="azureClient">Client ID</label>
              <input
                id="azureClient"
                type="text"
                value={azureClientId}
                onChange={(event) => setAzureClientId(event.target.value)}
                autoComplete="off"
              />
              <label htmlFor="azureSecret">Client secret</label>
              <input
                id="azureSecret"
                type="password"
                value={azureClientSecret}
                onChange={(event) => setAzureClientSecret(event.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {enableGcp && (
            <div className="cloud-credentials">
              <h3>Identifiants GCP</h3>
              <label htmlFor="gcpJson">Clé de service (JSON)</label>
              <textarea
                id="gcpJson"
                rows={4}
                value={gcpServiceAccountJson}
                onChange={(event) => setGcpServiceAccountJson(event.target.value)}
                placeholder="Collez le JSON du compte de service."
              />
            </div>
          )}

          {scanError && <p className="helper error">{scanError}</p>}
          {scanFailed && <p className="helper error">Le scan a échoué. Corrigez les paramètres et relancez.</p>}

          <button
            type="submit"
            className="btn primary"
            disabled={isScanning || (!parsedIpRanges.length && !cloudProviders.length)}
          >
            {isScanning ? "Scan en cours..." : "Lancer le scan"}
          </button>
        </form>
      </SectionCard>

      {scanCompleted && (
        <>
          <SectionCard
            eyebrow="Scan terminé"
            title="Votre inventaire initial est prêt"
            description="Vous pouvez maintenant importer des documents complémentaires et lancer vos analyses BIA/Risques."
            actions={
              <button type="button" className="btn primary" onClick={onContinue}>
                Continuer
              </button>
            }
          >
            <div className="summary-grid">
              {summary && (
                <>
                  <div>
                    <p className="muted small">Ressources détectées</p>
                    <p className="summary-value">{summary.discoveredResources ?? 0}</p>
                  </div>
                  <div>
                    <p className="muted small">Services créés</p>
                    <p className="summary-value">{summary.createdServices ?? 0}</p>
                  </div>
                  <div>
                    <p className="muted small">Infrastructures créées</p>
                    <p className="summary-value">{summary.createdInfra ?? 0}</p>
                  </div>
                  <div>
                    <p className="muted small">Dépendances ajoutées</p>
                    <p className="summary-value">{summary.createdDependencies ?? 0}</p>
                  </div>
                </>
              )}
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="Documents"
            title="Importer des documents complémentaires"
            description="Chargez vos PDF, DOCX ou exports CMDB pour enrichir la cartographie."
          >
            <form className="initial-scan-form" onSubmit={handleUpload}>
              <label htmlFor="docType">Type de document</label>
              <select id="docType" value={docType} onChange={(event) => setDocType(event.target.value)}>
                {DOC_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <label htmlFor="docDescription">Description</label>
              <input
                id="docDescription"
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <label htmlFor="docFile">Fichier</label>
              <input id="docFile" type="file" onChange={handleFileChange} />
              {uploadError && <p className="helper error">{uploadError}</p>}
              {uploadSuccess && <p className="helper success">{uploadSuccess}</p>}
              <button type="submit" className="btn" disabled={uploading}>
                {uploading ? "Upload..." : "Importer le document"}
              </button>
            </form>
          </SectionCard>
        </>
      )}

      <ProgressOverlay
        isOpen={isScanning}
        progress={scanJob?.progress ?? 0}
        currentStep={scanJob?.step ?? null}
        steps={SCAN_STEPS}
        summary={overlaySummary}
        errorMessage={scanError}
      />
    </div>
  );
}

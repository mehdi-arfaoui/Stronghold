type CloudProviderState = {
  aws: boolean;
  azure: boolean;
  gcp: boolean;
};

export type CloudCredentials = {
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  azureTenantId: string;
  azureClientId: string;
  azureClientSecret: string;
  gcpServiceAccountJson: string;
};

interface CloudCredentialsFieldsProps {
  providers: CloudProviderState;
  credentials: CloudCredentials;
  onToggleProvider: (provider: keyof CloudProviderState) => void;
  onCredentialChange: (field: keyof CloudCredentials, value: string) => void;
}

export function CloudCredentialsFields({
  providers,
  credentials,
  onToggleProvider,
  onCredentialChange,
}: CloudCredentialsFieldsProps) {
  return (
    <div className="stack">
      <div className="form-field">
        <span>Connecteurs cloud à interroger</span>
        <div className="checkbox-group">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={providers.aws}
              onChange={() => onToggleProvider("aws")}
            />
            AWS
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={providers.azure}
              onChange={() => onToggleProvider("azure")}
            />
            Azure
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={providers.gcp}
              onChange={() => onToggleProvider("gcp")}
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
              onChange={(event) => onCredentialChange("awsAccessKeyId", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>AWS Secret Access Key</span>
            <input
              type="password"
              value={credentials.awsSecretAccessKey}
              onChange={(event) => onCredentialChange("awsSecretAccessKey", event.target.value)}
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
              onChange={(event) => onCredentialChange("azureTenantId", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Azure Client ID</span>
            <input
              type="password"
              value={credentials.azureClientId}
              onChange={(event) => onCredentialChange("azureClientId", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Azure Client Secret</span>
            <input
              type="password"
              value={credentials.azureClientSecret}
              onChange={(event) => onCredentialChange("azureClientSecret", event.target.value)}
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
            onChange={(event) => onCredentialChange("gcpServiceAccountJson", event.target.value)}
          />
        </label>
      )}
    </div>
  );
}

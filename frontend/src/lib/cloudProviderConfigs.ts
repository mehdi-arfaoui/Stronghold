import { getCredentialScopeKey } from '@/lib/credentialStorage';

export type CloudProviderId = 'aws' | 'azure' | 'gcp';

export type CloudProviderConfig = {
  credentials: Record<string, string>;
  regions?: string[];
};

export type CloudProviderConfigMap = Partial<Record<CloudProviderId, CloudProviderConfig>>;

export type CloudProviderDefinition = {
  id: CloudProviderId;
  label: string;
  fields: Array<{ name: string; label: string; type: 'text' | 'password'; required: boolean }>;
  regions?: string[];
};

const STORAGE_KEY_PREFIX = 'stronghold_cloud_provider_configs';

export const CLOUD_PROVIDER_DEFINITIONS: CloudProviderDefinition[] = [
  {
    id: 'aws',
    label: 'AWS',
    fields: [
      { name: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true },
      { name: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
      { name: 'sessionToken', label: 'Session Token (optional)', type: 'password', required: false },
      { name: 'roleArn', label: 'Role ARN (optional)', type: 'text', required: false },
      { name: 'externalId', label: 'External ID (optional)', type: 'text', required: false },
    ],
    regions: ['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'us-east-1', 'us-west-2'],
  },
  {
    id: 'azure',
    label: 'Azure',
    fields: [
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
      { name: 'clientId', label: 'Client ID', type: 'text', required: true },
      { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { name: 'subscriptionId', label: 'Subscription ID', type: 'text', required: true },
    ],
  },
  {
    id: 'gcp',
    label: 'GCP',
    fields: [
      { name: 'serviceAccountJson', label: 'Service Account JSON', type: 'text', required: true },
    ],
  },
];

function storageKey(scope = getCredentialScopeKey()): string {
  return `${STORAGE_KEY_PREFIX}:${scope}`;
}

function sanitizeCredentials(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, String(value ?? '').trim()])
      .filter(([, value]) => value.length > 0),
  );
}

function normalizeRegions(regions: string[] | undefined): string[] {
  if (!Array.isArray(regions)) return [];
  return regions
    .map((region) => String(region || '').trim())
    .filter((region) => region.length > 0);
}

type ValidationResult = { valid: true } | { valid: false; reason: string };

function hasAwsCredentials(credentials: Record<string, string>): ValidationResult {
  const hasStaticKeys = Boolean(credentials.accessKeyId && credentials.secretAccessKey);
  const hasRole = Boolean(credentials.roleArn);
  if (hasStaticKeys || hasRole) return { valid: true };
  return {
    valid: false,
    reason: 'AWS requires accessKeyId/secretAccessKey or roleArn.',
  };
}

function hasAzureCredentials(credentials: Record<string, string>): ValidationResult {
  if (
    credentials.tenantId &&
    credentials.clientId &&
    credentials.clientSecret &&
    credentials.subscriptionId
  ) {
    return { valid: true };
  }
  return {
    valid: false,
    reason: 'Azure requires tenantId, clientId, clientSecret and subscriptionId.',
  };
}

function parseGcpServiceAccountJson(
  credentials: Record<string, string>,
): { projectId: string; clientEmail: string; privateKey: string } | null {
  const json = credentials.serviceAccountJson?.trim();
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const projectId = String(parsed.project_id ?? parsed.projectId ?? '').trim();
    const clientEmail = String(parsed.client_email ?? parsed.clientEmail ?? '').trim();
    const privateKey = String(parsed.private_key ?? parsed.privateKey ?? '').trim();
    if (!projectId || !clientEmail || !privateKey) return null;
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

function hasGcpCredentials(credentials: Record<string, string>): ValidationResult {
  if (parseGcpServiceAccountJson(credentials)) return { valid: true };
  if (credentials.projectId && credentials.clientEmail && credentials.privateKey) {
    return { valid: true };
  }
  return {
    valid: false,
    reason: 'GCP requires a valid serviceAccountJson or projectId/clientEmail/privateKey.',
  };
}

export function validateCloudProviderConfig(
  provider: CloudProviderId,
  credentials: Record<string, string>,
): ValidationResult {
  const sanitized = sanitizeCredentials(credentials);
  if (provider === 'aws') return hasAwsCredentials(sanitized);
  if (provider === 'azure') return hasAzureCredentials(sanitized);
  return hasGcpCredentials(sanitized);
}

function normalizeSingleConfig(config: CloudProviderConfig): CloudProviderConfig {
  return {
    credentials: sanitizeCredentials(config.credentials || {}),
    regions: normalizeRegions(config.regions),
  };
}

export function loadCloudProviderConfigs(scope = getCredentialScopeKey()): CloudProviderConfigMap {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(storageKey(scope));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: CloudProviderConfigMap = {};
    for (const definition of CLOUD_PROVIDER_DEFINITIONS) {
      const candidate = parsed[definition.id];
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const candidateRecord = candidate as Record<string, unknown>;
      const credentialsValue =
        candidateRecord.credentials && typeof candidateRecord.credentials === 'object' && !Array.isArray(candidateRecord.credentials)
          ? Object.fromEntries(
              Object.entries(candidateRecord.credentials as Record<string, unknown>).map(([key, value]) => [
                key,
                String(value ?? ''),
              ]),
            )
          : {};
      const regionsValue = Array.isArray(candidateRecord.regions)
        ? candidateRecord.regions.map((value) => String(value ?? ''))
        : [];
      next[definition.id] = normalizeSingleConfig({
        credentials: credentialsValue,
        regions: regionsValue,
      });
    }
    return next;
  } catch {
    return {};
  }
}

export function saveCloudProviderConfigs(
  configs: CloudProviderConfigMap,
  scope = getCredentialScopeKey(),
): void {
  if (typeof window === 'undefined') return;
  const sanitized: CloudProviderConfigMap = {};
  for (const definition of CLOUD_PROVIDER_DEFINITIONS) {
    const config = configs[definition.id];
    if (!config) continue;
    sanitized[definition.id] = normalizeSingleConfig(config);
  }
  window.localStorage.setItem(storageKey(scope), JSON.stringify(sanitized));
}

export function upsertCloudProviderConfig(
  provider: CloudProviderId,
  config: CloudProviderConfig,
  scope = getCredentialScopeKey(),
): CloudProviderConfigMap {
  const current = loadCloudProviderConfigs(scope);
  const next = {
    ...current,
    [provider]: normalizeSingleConfig(config),
  };
  saveCloudProviderConfigs(next, scope);
  return next;
}

export function removeCloudProviderConfig(
  provider: CloudProviderId,
  scope = getCredentialScopeKey(),
): CloudProviderConfigMap {
  const current = loadCloudProviderConfigs(scope);
  const next = { ...current };
  delete next[provider];
  saveCloudProviderConfigs(next, scope);
  return next;
}

export function getConfiguredCloudProviders(configs: CloudProviderConfigMap): CloudProviderId[] {
  return CLOUD_PROVIDER_DEFINITIONS
    .map((definition) => definition.id)
    .filter((provider) => {
      const config = configs[provider];
      if (!config) return false;
      return validateCloudProviderConfig(provider, config.credentials).valid;
    });
}

function buildProviderPayload(
  provider: CloudProviderId,
  config: CloudProviderConfig,
): { type: CloudProviderId; credentials: Record<string, string>; regions?: string[] } | null {
  const normalized = normalizeSingleConfig(config);
  const validation = validateCloudProviderConfig(provider, normalized.credentials);
  if (!validation.valid) return null;

  if (provider === 'aws') {
    const firstRegion = normalized.regions?.[0];
    const payloadCredentials: Record<string, string> = {
      ...(normalized.credentials.accessKeyId ? { accessKeyId: normalized.credentials.accessKeyId } : {}),
      ...(normalized.credentials.secretAccessKey
        ? { secretAccessKey: normalized.credentials.secretAccessKey }
        : {}),
      ...(normalized.credentials.sessionToken ? { sessionToken: normalized.credentials.sessionToken } : {}),
      ...(normalized.credentials.roleArn ? { roleArn: normalized.credentials.roleArn } : {}),
      ...(normalized.credentials.externalId ? { externalId: normalized.credentials.externalId } : {}),
      ...(firstRegion ? { region: firstRegion } : {}),
    };
    return {
      type: 'aws',
      credentials: payloadCredentials,
      ...(normalized.regions && normalized.regions.length > 0 ? { regions: normalized.regions } : {}),
    };
  }

  if (provider === 'azure') {
    return {
      type: 'azure',
      credentials: {
        tenantId: normalized.credentials.tenantId,
        clientId: normalized.credentials.clientId,
        clientSecret: normalized.credentials.clientSecret,
        subscriptionId: normalized.credentials.subscriptionId,
      },
    };
  }

  const gcpFromJson = parseGcpServiceAccountJson(normalized.credentials);
  if (gcpFromJson) {
    return {
      type: 'gcp',
      credentials: {
        projectId: gcpFromJson.projectId,
        clientEmail: gcpFromJson.clientEmail,
        privateKey: gcpFromJson.privateKey,
      },
    };
  }

  return {
    type: 'gcp',
    credentials: {
      projectId: normalized.credentials.projectId,
      clientEmail: normalized.credentials.clientEmail,
      privateKey: normalized.credentials.privateKey,
    },
  };
}

export function buildCloudProviderScanPayload(
  configs: CloudProviderConfigMap,
): Array<{ type: CloudProviderId; credentials: Record<string, string>; regions?: string[] }> {
  return CLOUD_PROVIDER_DEFINITIONS
    .map((definition) => {
      const config = configs[definition.id];
      if (!config) return null;
      return buildProviderPayload(definition.id, config);
    })
    .filter((entry): entry is { type: CloudProviderId; credentials: Record<string, string>; regions?: string[] } => Boolean(entry));
}

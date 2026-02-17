import {
  encryptCredential,
  isEncryptedCredential,
  resolveCredentialEncryptionKey,
} from "../utils/credential-encryption.js";
import {
  maskCredential,
  sanitizeCredentialRecord,
} from "../utils/credential-mask.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function encryptCredentialValue(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return isEncryptedCredential(value) ? value : encryptCredential(value, key);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => encryptCredentialValue(entry, key));
  }
  if (isRecord(value)) {
    const encrypted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      encrypted[entryKey] = encryptCredentialValue(entryValue, key);
    }
    return encrypted;
  }
  return encryptCredential(JSON.stringify(value), key);
}

function hasPlaintextCredentialValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return !isEncryptedCredential(value);
  if (Array.isArray(value)) return value.some((entry) => hasPlaintextCredentialValue(entry));
  if (isRecord(value)) {
    return Object.values(value).some((entry) => hasPlaintextCredentialValue(entry));
  }
  return true;
}

function maskCredentialValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (isEncryptedCredential(value)) return "********";
    return maskCredential(value);
  }
  if (Array.isArray(value)) return value.map(() => "********");
  if (isRecord(value)) {
    const nested = sanitizeCredentialRecord(value);
    if (nested) return nested;
  }
  return "********";
}

function maskKubernetesConfig(kubernetesConfig: unknown): unknown {
  if (!Array.isArray(kubernetesConfig)) return kubernetesConfig;
  return kubernetesConfig.map((clusterConfig) => {
    if (!isRecord(clusterConfig)) return clusterConfig;
    const sanitized = { ...clusterConfig };
    if (typeof sanitized.kubeconfig === "string") {
      sanitized.kubeconfig = "********";
    }
    return sanitized;
  });
}

export function encryptScanConfigCredentials(config: unknown, encryptionKey?: string): unknown {
  if (!isRecord(config)) return config;
  const key = encryptionKey || resolveCredentialEncryptionKey();
  const next = cloneValue(config);

  if (Array.isArray(next.providers)) {
    next.providers = next.providers.map((provider) => {
      if (!isRecord(provider)) return provider;
      const providerConfig = { ...provider };
      if (providerConfig.credentials !== undefined) {
        providerConfig.credentials = encryptCredentialValue(providerConfig.credentials, key);
      }
      return providerConfig;
    });
  }

  if (next.credentials !== undefined) {
    next.credentials = encryptCredentialValue(next.credentials, key);
  }

  if (Array.isArray(next.kubernetes)) {
    next.kubernetes = next.kubernetes.map((clusterConfig) => {
      if (!isRecord(clusterConfig)) return clusterConfig;
      const sanitized = { ...clusterConfig };
      if (typeof sanitized.kubeconfig === "string" && !isEncryptedCredential(sanitized.kubeconfig)) {
        sanitized.kubeconfig = encryptCredential(sanitized.kubeconfig, key);
      }
      return sanitized;
    });
  }

  return next;
}

export function sanitizeScanConfig(config: unknown): unknown {
  if (!isRecord(config)) return config;
  const next = cloneValue(config);

  if (Array.isArray(next.providers)) {
    next.providers = next.providers.map((provider) => {
      if (!isRecord(provider)) return provider;
      const providerConfig = { ...provider };
      if (providerConfig.credentials !== undefined) {
        providerConfig.credentials = maskCredentialValue(providerConfig.credentials);
      }
      return providerConfig;
    });
  }

  if (next.credentials !== undefined) {
    next.credentials = maskCredentialValue(next.credentials);
  }

  if (next.kubernetes !== undefined) {
    next.kubernetes = maskKubernetesConfig(next.kubernetes);
  }

  return next;
}

export function scanConfigHasPlaintextCredentials(config: unknown): boolean {
  if (!isRecord(config)) return false;
  if (nextHasPlaintext(config.providers)) return true;
  if (nextHasPlaintext(config.credentials)) return true;
  if (Array.isArray(config.kubernetes)) {
    const hasPlainKubeconfig = config.kubernetes.some((clusterConfig) => {
      if (!isRecord(clusterConfig)) return false;
      return hasPlaintextCredentialValue(clusterConfig.kubeconfig);
    });
    if (hasPlainKubeconfig) return true;
  }
  return false;
}

function nextHasPlaintext(value: unknown): boolean {
  if (value === undefined) return false;
  return hasPlaintextCredentialValue(value);
}

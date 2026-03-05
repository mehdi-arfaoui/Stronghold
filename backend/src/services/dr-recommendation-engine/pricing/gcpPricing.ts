// @deprecated Replaced by JSON catalogs in backend/src/services/pricing/*.json.
// Kept temporarily for backward compatibility with legacy tests.
import {
  readPositiveNumberFromKeys,
  readStringFromKeys,
} from '../metadataUtils.js';
import type { CloudServiceResolution } from '../types.js';

export const GCP_PRICING_ESTIMATES = {
  region: 'europe-west1 / europe-west9',
  computeEngine: {
    'e2-micro': 7.5,
    'e2-small': 15,
    'e2-medium': 30,
    'e2-standard-2': 60,
    'e2-standard-4': 120,
    'n2-standard-2': 70,
    'n2-standard-4': 140,
    default: 50,
  },
  cloudSQL: {
    'db-f1-micro': 10,
    'db-g1-small': 28,
    'db-custom-2-8192': 80,
    'db-custom-4-16384': 160,
    default: 50,
  },
  memorystore: {
    M1_1GB: 35,
    M1_2GB: 55,
    M1_5GB: 120,
    default: 35,
  },
  cloudStorage: { default: 2 },
  cloudFunctions: { default: 0 },
  bigTable: { default: 50 },
  firestore: { default: 0 },
  pubsub: { default: 0 },
  cloudTasks: { default: 0 },
  gke: {
    'e2-standard-2': 60,
    'e2-standard-4': 120,
    default: 70,
  },
} as const;

function lookupByKey<T extends Readonly<Record<string, number>> & { readonly default: number }>(
  table: T,
  key: string | null,
): number {
  if (!key) return table.default;
  const value = table[key as keyof T];
  return typeof value === 'number' ? value : table.default;
}

function readMachineType(metadata: Record<string, unknown>): string | null {
  const machineTypeRaw = readStringFromKeys(metadata, [
    'machineType',
    'instanceType',
    'machine_type',
    'nodeMachineType',
  ]);
  if (!machineTypeRaw) return null;
  const segments = machineTypeRaw.split('/');
  return segments[segments.length - 1] || machineTypeRaw;
}

export function lookupGcpEstimatedMonthlyEur(resolution: CloudServiceResolution): number | null {
  const metadata = resolution.metadata;
  const kind = resolution.kind;

  if (kind === 'computeEngine') {
    return lookupByKey(GCP_PRICING_ESTIMATES.computeEngine, readMachineType(metadata));
  }
  if (kind === 'cloudSQL') {
    const tier = readStringFromKeys(metadata, ['tier', 'instanceType', 'machineType']);
    return lookupByKey(GCP_PRICING_ESTIMATES.cloudSQL, tier);
  }
  if (kind === 'memorystore') {
    const size = readStringFromKeys(metadata, ['memorySizeGb', 'memorySizeGB', 'memoryTier', 'tier']);
    if (size) {
      const normalized = size.includes('GB') ? size : `M1_${size}GB`;
      return lookupByKey(GCP_PRICING_ESTIMATES.memorystore, normalized);
    }
    return GCP_PRICING_ESTIMATES.memorystore.default;
  }
  if (kind === 'cloudStorage') {
    const bytes = readPositiveNumberFromKeys(metadata, ['sizeBytes']);
    const storageGb = readPositiveNumberFromKeys(metadata, ['storageGB', 'storageGb', 'sizeGB', 'sizeGb']);
    const estimatedGb = storageGb ?? (bytes != null ? bytes / (1024 ** 3) : null);
    const base = GCP_PRICING_ESTIMATES.cloudStorage.default;
    if (estimatedGb == null) return base;
    const estimatedPerTb = (estimatedGb / 1024) * 20;
    return Math.max(base, Number(estimatedPerTb.toFixed(2)));
  }
  if (kind === 'cloudFunctions') return GCP_PRICING_ESTIMATES.cloudFunctions.default;
  if (kind === 'bigTable') return GCP_PRICING_ESTIMATES.bigTable.default;
  if (kind === 'firestore') return GCP_PRICING_ESTIMATES.firestore.default;
  if (kind === 'pubsub') return GCP_PRICING_ESTIMATES.pubsub.default;
  if (kind === 'cloudTasks') return GCP_PRICING_ESTIMATES.cloudTasks.default;
  if (kind === 'gke') {
    return lookupByKey(GCP_PRICING_ESTIMATES.gke, readMachineType(metadata));
  }

  return null;
}

import {
  readPositiveNumberFromKeys,
  readStringFromKeys,
} from '../metadataUtils.js';
import type { CloudServiceResolution } from '../types.js';

export const AZURE_PRICING_ESTIMATES = {
  region: 'westeurope / francecentral',
  vm: {
    Standard_B1s: 8.5,
    Standard_B1ms: 17,
    Standard_B2s: 34,
    Standard_B2ms: 68,
    Standard_D2s_v5: 78,
    Standard_D4s_v5: 156,
    Standard_D8s_v5: 312,
    default: 50,
  },
  sqlDatabase: {
    GP_S_Gen5_1: 30,
    GP_Gen5_2: 150,
    BC_Gen5_2: 340,
    default: 80,
  },
  postgresqlFlexible: {
    Standard_B1ms: 16,
    Standard_B2s: 32,
    Standard_D2s_v3: 100,
    default: 50,
  },
  mysqlFlexible: {
    Standard_B1ms: 14,
    Standard_B2s: 28,
    default: 45,
  },
  redis: {
    C0_Basic: 14,
    C0_Standard: 28,
    C1_Standard: 55,
    C1_Premium: 115,
    default: 30,
  },
  storage: {
    default: 2,
  },
  functions: { default: 0 },
  cosmosdb: { default: 25 },
  serviceBus: { default: 10 },
  eventGrid: { default: 0 },
  aks: {
    Standard_B2s: 34,
    Standard_D2s_v5: 78,
    default: 78,
  },
} as const;

function readAzureSku(metadata: Record<string, unknown>): string | null {
  return (
    readStringFromKeys(metadata, [
      'skuName',
      'sku',
      'sku_name',
      'size',
      'vmSize',
      'vm_size',
      'instanceType',
    ]) || null
  );
}

function lookupBySku<T extends Readonly<Record<string, number>> & { readonly default: number }>(
  table: T,
  sku: string | null,
): number {
  if (!sku) return table.default;
  const value = table[sku as keyof T];
  return typeof value === 'number' ? value : table.default;
}

export function lookupAzureEstimatedMonthlyEur(resolution: CloudServiceResolution): number | null {
  const metadata = resolution.metadata;
  const kind = resolution.kind;

  if (kind === 'vm' || kind === 'virtualMachineScaleSet') {
    return lookupBySku(AZURE_PRICING_ESTIMATES.vm, readAzureSku(metadata));
  }
  if (kind === 'sqlDatabase') {
    const objective = readStringFromKeys(metadata, [
      'currentServiceObjectiveName',
      'serviceObjective',
      'serviceObjectiveName',
      'skuName',
      'sku',
    ]);
    return lookupBySku(AZURE_PRICING_ESTIMATES.sqlDatabase, objective);
  }
  if (kind === 'postgresqlFlexible') {
    return lookupBySku(AZURE_PRICING_ESTIMATES.postgresqlFlexible, readAzureSku(metadata));
  }
  if (kind === 'mysqlFlexible') {
    return lookupBySku(AZURE_PRICING_ESTIMATES.mysqlFlexible, readAzureSku(metadata));
  }
  if (kind === 'redis') {
    const redisSku = readStringFromKeys(metadata, ['skuName', 'sku_name', 'sku', 'tier']);
    return lookupBySku(AZURE_PRICING_ESTIMATES.redis, redisSku);
  }
  if (kind === 'storageAccount') {
    const bytes = readPositiveNumberFromKeys(metadata, ['sizeBytes']);
    const storageGb = readPositiveNumberFromKeys(metadata, ['storageGB', 'storageGb', 'sizeGB', 'sizeGb']);
    const estimatedGb = storageGb ?? (bytes != null ? bytes / (1024 ** 3) : null);
    const base = AZURE_PRICING_ESTIMATES.storage.default;
    if (estimatedGb == null) return base;
    const estimatedPerTb = (estimatedGb / 1024) * 20;
    return Math.max(base, Number(estimatedPerTb.toFixed(2)));
  }
  if (kind === 'functions') return AZURE_PRICING_ESTIMATES.functions.default;
  if (kind === 'cosmosdb') return AZURE_PRICING_ESTIMATES.cosmosdb.default;
  if (kind === 'serviceBus') return AZURE_PRICING_ESTIMATES.serviceBus.default;
  if (kind === 'eventGrid') return AZURE_PRICING_ESTIMATES.eventGrid.default;
  if (kind === 'aks') {
    const sku = readAzureSku(metadata);
    return lookupBySku(AZURE_PRICING_ESTIMATES.aks, sku);
  }

  return null;
}

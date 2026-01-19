import { normalizeAwsPriceListEntries } from "../clients/awsPricingClient.js";
import { normalizeAzurePricingResponse } from "../clients/azurePricingClient.js";
import { normalizeGcpPricingResponse } from "../clients/gcpPricingClient.js";
import type { NormalizedPricingItem } from "../clients/pricingTypes.js";
import {
  fetchAwsComputePricePerHour,
  fetchAwsStoragePricePerGbMonth,
  fetchAwsTransferPricePerGb,
} from "./awsPricing.js";
import { fetchAwsPricingProducts } from "./awsPricingService.js";
import {
  fetchAzureComputePricePerHour,
  fetchAzureStoragePricePerGbMonth,
  fetchAzureTransferPricePerGb,
} from "./azurePricing.js";
import { fetchAzureRetailPrices } from "./azurePricingService.js";
import {
  fetchGcpComputePricePerHour,
  fetchGcpStoragePricePerGbMonth,
  fetchGcpTransferPricePerGb,
} from "./gcpPricing.js";
import { fetchGcpSkus } from "./gcpPricingService.js";

export type DisasterRecoveryScenarioId =
  | "backup_restore"
  | "pilot_light"
  | "warm_standby"
  | "multi_site";

export type ScenarioProfile = {
  id: DisasterRecoveryScenarioId;
  label: string;
  description: string;
  computeMultiplier: number;
  storageMultiplier: number;
  transferMultiplier: number;
  snapshotMultiplier: number;
  capexMultiplier: number;
};

export type ScenarioInput = {
  instanceType: string;
  instanceCount: number;
  storageGb: number;
  dataTransferGb: number;
  snapshotFrequencyPerDay: number;
  currency: string;
  awsRegion: string;
  azureRegion: string;
  gcpRegion: string;
  awsLocation?: string;
  gcpComputeServiceId?: string;
  gcpStorageServiceId?: string;
  gcpNetworkServiceId?: string;
};

export type ProviderEstimate = {
  provider: "aws" | "azure" | "gcp";
  capex: number;
  opexMonthly: number;
  currency: string;
  breakdown: {
    compute: number;
    storage: number;
    dataTransfer: number;
    snapshots: number;
  };
  unitPrices: {
    compute: number;
    storage: number;
    dataTransfer: number;
    currency: string;
  };
  usage: {
    computeHours: number;
    storageGbMonth: number;
    dataTransferGb: number;
    snapshotGbMonth: number;
  };
  sources: {
    compute?: string;
    storage?: string;
    dataTransfer?: string;
  };
};

export type ScenarioEstimate = {
  scenarioId: DisasterRecoveryScenarioId;
  scenarioLabel: string;
  scenarioDescription: string;
  inputs: ScenarioInput;
  providers: ProviderEstimate[];
};

export type ScenarioComparisonResponse = {
  generatedAt: string;
  scenarios: ScenarioEstimate[];
};

export type ResourceInput = {
  name?: string;
  vcpu: number;
  ramGb: number;
  storageGb: number;
  transferGb: number;
  durationHours: number;
};

export type FinancialReportInput = {
  resources: ResourceInput[];
  scenarioId: DisasterRecoveryScenarioId;
  currency: string;
  awsRegion: string;
  azureRegion: string;
  gcpRegion: string;
  awsLocation?: string;
  gcpComputeServiceId?: string;
  gcpStorageServiceId?: string;
  gcpNetworkServiceId?: string;
  providers?: Array<"aws" | "azure" | "gcp">;
};

export type FinancialProviderReport = {
  provider: "aws" | "azure" | "gcp";
  capex: number;
  opexMonthly: number;
  currency: string;
  breakdown: {
    compute: number;
    storage: number;
    dataTransfer: number;
  };
  unitPrices: {
    computePerHour: number;
    storagePerGbMonth: number;
    transferPerGb: number;
    currency: string;
  };
  usage: {
    computeHours: number;
    storageGbMonth: number;
    dataTransferGb: number;
  };
  recommendations: string[];
  sources: {
    compute?: string;
    storage?: string;
    dataTransfer?: string;
  };
};

export type FinancialReport = {
  generatedAt: string;
  scenario: {
    id: DisasterRecoveryScenarioId;
    label: string;
    description: string;
  };
  inputs: FinancialReportInput;
  providers: FinancialProviderReport[];
};

const DEFAULT_SCENARIOS: ScenarioProfile[] = [
  {
    id: "backup_restore",
    label: "Backup & Restore",
    description: "Infra minimale, reprise sur sauvegardes froides.",
    computeMultiplier: 0.1,
    storageMultiplier: 1,
    transferMultiplier: 0.3,
    snapshotMultiplier: 0.2,
    capexMultiplier: 0.6,
  },
  {
    id: "pilot_light",
    label: "Pilot Light",
    description: "Services essentiels pré-positionnés, montée en charge à la demande.",
    computeMultiplier: 0.2,
    storageMultiplier: 1.05,
    transferMultiplier: 0.4,
    snapshotMultiplier: 0.3,
    capexMultiplier: 0.8,
  },
  {
    id: "warm_standby",
    label: "Warm Standby",
    description: "Capacité intermédiaire, reprise accélérée.",
    computeMultiplier: 0.6,
    storageMultiplier: 1.2,
    transferMultiplier: 0.6,
    snapshotMultiplier: 0.5,
    capexMultiplier: 1.1,
  },
  {
    id: "multi_site",
    label: "Multi-site",
    description: "Infrastructure active-active répartie sur plusieurs sites.",
    computeMultiplier: 1.2,
    storageMultiplier: 1.4,
    transferMultiplier: 1.1,
    snapshotMultiplier: 0.8,
    capexMultiplier: 1.6,
  },
];

const DEFAULT_INPUTS: ScenarioInput = {
  instanceType: "m5.large",
  instanceCount: 4,
  storageGb: 1200,
  dataTransferGb: 800,
  snapshotFrequencyPerDay: 2,
  currency: "EUR",
  awsRegion: "eu-west-1",
  azureRegion: "westeurope",
  gcpRegion: "europe-west1",
};

const AWS_REGION_LOCATION_MAP: Record<string, string> = {
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-1": "US West (N. California)",
  "us-west-2": "US West (Oregon)",
  "eu-west-1": "EU (Ireland)",
  "eu-west-2": "EU (London)",
  "eu-west-3": "EU (Paris)",
  "eu-central-1": "EU (Frankfurt)",
};

const GCP_DEFAULT_SERVICE_IDS = {
  compute: "6F81-5844-456A",
  storage: "95FF-2EF5-5EA1",
  network: "4E27-9D80-5BD9",
};

const BASE_INSTANCE_SPECS = {
  aws: { instanceType: "m5.large", vcpu: 2, ramGb: 8 },
  azure: { instanceType: "D2s v5", vcpu: 2, ramGb: 8 },
  gcp: { instanceDescriptor: "e2-standard-2", vcpu: 2, ramGb: 8 },
};

function toNumber(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPositive(value: number, fallback: number, max = 100000): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, 0), max);
}

function resolveAwsLocation(region: string, explicitLocation?: string): string | undefined {
  if (explicitLocation && explicitLocation.trim().length > 0) {
    return explicitLocation.trim();
  }
  return AWS_REGION_LOCATION_MAP[region] ?? undefined;
}

function pickBestItem(
  items: NormalizedPricingItem[],
  filters: Array<(item: NormalizedPricingItem) => boolean>
): NormalizedPricingItem | undefined {
  for (const filter of filters) {
    const match = items.find(filter);
    if (match) return match;
  }
  return items[0];
}

function calcUsage(profile: ScenarioProfile, input: ScenarioInput) {
  const computeHours = 730 * input.instanceCount * profile.computeMultiplier;
  const storageGbMonth = input.storageGb * profile.storageMultiplier;
  const dataTransferGb = input.dataTransferGb * profile.transferMultiplier;
  const snapshotGbMonth =
    input.storageGb * profile.snapshotMultiplier * input.snapshotFrequencyPerDay * 30 * 0.15;

  return {
    computeHours,
    storageGbMonth,
    dataTransferGb,
    snapshotGbMonth,
  };
}

function calcCapex(profile: ScenarioProfile, input: ScenarioInput): number {
  const base = input.instanceCount * 450 + input.storageGb * 1.2 + input.dataTransferGb * 0.3;
  return base * profile.capexMultiplier;
}

function calcResourceCapex(profile: ScenarioProfile, resources: ResourceInput[]): number {
  const base = resources.reduce((acc, resource) => {
    return (
      acc +
      resource.vcpu * 380 +
      resource.ramGb * 45 +
      resource.storageGb * 1.1 +
      resource.transferGb * 0.25
    );
  }, 0);
  return base * profile.capexMultiplier;
}

function estimateProviderCosts(
  provider: "aws" | "azure" | "gcp",
  profile: ScenarioProfile,
  input: ScenarioInput,
  unitPrices: { compute: number; storage: number; dataTransfer: number; currency: string },
  sources: { compute?: string; storage?: string; dataTransfer?: string }
): ProviderEstimate {
  const usage = calcUsage(profile, input);
  const compute = unitPrices.compute * usage.computeHours;
  const storage = unitPrices.storage * usage.storageGbMonth;
  const dataTransfer = unitPrices.dataTransfer * usage.dataTransferGb;
  const snapshots = unitPrices.storage * usage.snapshotGbMonth;

  return {
    provider,
    capex: calcCapex(profile, input),
    opexMonthly: compute + storage + dataTransfer + snapshots,
    currency: unitPrices.currency || input.currency,
    breakdown: {
      compute,
      storage,
      dataTransfer,
      snapshots,
    },
    unitPrices,
    usage,
    sources,
  };
}

function buildOptimizationRecommendations(breakdown: {
  compute: number;
  storage: number;
  dataTransfer: number;
}, opexMonthly: number): string[] {
  const suggestions: string[] = [];
  const safeTotal = opexMonthly || 1;
  const computeShare = breakdown.compute / safeTotal;
  const storageShare = breakdown.storage / safeTotal;
  const transferShare = breakdown.dataTransfer / safeTotal;

  if (computeShare >= 0.45) {
    suggestions.push("Right-sizing des instances et automatisation de la mise en veille.");
  }
  if (storageShare >= 0.4) {
    suggestions.push("Tiering objet et politiques de rétention pour réduire le stockage chaud.");
  }
  if (transferShare >= 0.35) {
    suggestions.push("Optimiser la réplication inter-région et le cache CDN.");
  }
  if (opexMonthly >= 5000) {
    suggestions.push("Négocier des engagements (Savings Plans / Reservations).");
  }
  if (suggestions.length === 0) {
    suggestions.push("Coûts équilibrés : monitorer la croissance et ajuster trimestriellement.");
  }
  return suggestions;
}

function accumulateResourceUsage(resources: ResourceInput[]) {
  return resources.reduce(
    (acc, resource) => {
      const scalingFactor = Math.max(
        resource.vcpu / BASE_INSTANCE_SPECS.aws.vcpu,
        resource.ramGb / BASE_INSTANCE_SPECS.aws.ramGb
      );
      acc.computeHours += resource.durationHours * scalingFactor;
      acc.storageGbMonth += resource.storageGb;
      acc.dataTransferGb += resource.transferGb;
      return acc;
    },
    { computeHours: 0, storageGbMonth: 0, dataTransferGb: 0 }
  );
}

function estimateComputeCost(
  resource: ResourceInput,
  baseInstance: { vcpu: number; ramGb: number; hourlyPrice: number }
): number {
  if (baseInstance.hourlyPrice <= 0) return 0;
  const scaling = Math.max(resource.vcpu / baseInstance.vcpu, resource.ramGb / baseInstance.ramGb);
  return resource.durationHours * baseInstance.hourlyPrice * scaling;
}

async function buildFinancialProviderReport(
  provider: "aws" | "azure" | "gcp",
  profile: ScenarioProfile,
  input: FinancialReportInput
): Promise<FinancialProviderReport> {
  if (provider === "aws") {
    const base = BASE_INSTANCE_SPECS.aws;
    const computePrice = await fetchAwsComputePricePerHour({
      instanceType: base.instanceType,
      region: input.awsRegion,
      location: input.awsLocation,
    });
    const storagePrice = await fetchAwsStoragePricePerGbMonth(input.awsRegion, input.awsLocation);
    const transferPrice = await fetchAwsTransferPricePerGb(input.awsRegion, input.awsLocation);

    const compute = input.resources.reduce(
      (sum, resource) =>
        sum + estimateComputeCost(resource, { ...base, hourlyPrice: computePrice.pricePerUnit }),
      0
    );
    const storage = input.resources.reduce((sum, resource) => sum + resource.storageGb, 0);
    const transfer = input.resources.reduce((sum, resource) => sum + resource.transferGb, 0);
    const breakdown = {
      compute: compute * profile.computeMultiplier,
      storage: storage * storagePrice.pricePerUnit * profile.storageMultiplier,
      dataTransfer: transfer * transferPrice.pricePerUnit * profile.transferMultiplier,
    };
    const opexMonthly = breakdown.compute + breakdown.storage + breakdown.dataTransfer;

    return {
      provider,
      capex: calcResourceCapex(profile, input.resources),
      opexMonthly,
      currency: computePrice.currency || input.currency,
      breakdown,
      unitPrices: {
        computePerHour: computePrice.pricePerUnit,
        storagePerGbMonth: storagePrice.pricePerUnit,
        transferPerGb: transferPrice.pricePerUnit,
        currency: computePrice.currency || input.currency,
      },
      usage: accumulateResourceUsage(input.resources),
      recommendations: buildOptimizationRecommendations(breakdown, opexMonthly),
      sources: {
        compute: computePrice.source,
        storage: storagePrice.source,
        dataTransfer: transferPrice.source,
      },
    };
  }

  if (provider === "azure") {
    const base = BASE_INSTANCE_SPECS.azure;
    const computePrice = await fetchAzureComputePricePerHour({
      skuName: base.instanceType,
      region: input.azureRegion,
    });
    const storagePrice = await fetchAzureStoragePricePerGbMonth(input.azureRegion);
    const transferPrice = await fetchAzureTransferPricePerGb(input.azureRegion);
    const compute = input.resources.reduce(
      (sum, resource) =>
        sum + estimateComputeCost(resource, { ...base, hourlyPrice: computePrice.pricePerUnit }),
      0
    );
    const storage = input.resources.reduce((sum, resource) => sum + resource.storageGb, 0);
    const transfer = input.resources.reduce((sum, resource) => sum + resource.transferGb, 0);
    const breakdown = {
      compute: compute * profile.computeMultiplier,
      storage: storage * storagePrice.pricePerUnit * profile.storageMultiplier,
      dataTransfer: transfer * transferPrice.pricePerUnit * profile.transferMultiplier,
    };
    const opexMonthly = breakdown.compute + breakdown.storage + breakdown.dataTransfer;

    return {
      provider,
      capex: calcResourceCapex(profile, input.resources),
      opexMonthly,
      currency: computePrice.currency || input.currency,
      breakdown,
      unitPrices: {
        computePerHour: computePrice.pricePerUnit,
        storagePerGbMonth: storagePrice.pricePerUnit,
        transferPerGb: transferPrice.pricePerUnit,
        currency: computePrice.currency || input.currency,
      },
      usage: accumulateResourceUsage(input.resources),
      recommendations: buildOptimizationRecommendations(breakdown, opexMonthly),
      sources: {
        compute: computePrice.source,
        storage: storagePrice.source,
        dataTransfer: transferPrice.source,
      },
    };
  }

  const base = BASE_INSTANCE_SPECS.gcp;
  const computeServiceId = input.gcpComputeServiceId ?? GCP_DEFAULT_SERVICE_IDS.compute;
  const storageServiceId = input.gcpStorageServiceId ?? GCP_DEFAULT_SERVICE_IDS.storage;
  const networkServiceId = input.gcpNetworkServiceId ?? GCP_DEFAULT_SERVICE_IDS.network;
  const computePrice = await fetchGcpComputePricePerHour({
    serviceId: computeServiceId,
    instanceDescriptor: base.instanceDescriptor,
  });
  const storagePrice = await fetchGcpStoragePricePerGbMonth(storageServiceId);
  const transferPrice = await fetchGcpTransferPricePerGb(networkServiceId);
  const compute = input.resources.reduce(
    (sum, resource) =>
      sum + estimateComputeCost(resource, { ...base, hourlyPrice: computePrice.pricePerUnit }),
    0
  );
  const storage = input.resources.reduce((sum, resource) => sum + resource.storageGb, 0);
  const transfer = input.resources.reduce((sum, resource) => sum + resource.transferGb, 0);
  const breakdown = {
    compute: compute * profile.computeMultiplier,
    storage: storage * storagePrice.pricePerUnit * profile.storageMultiplier,
    dataTransfer: transfer * transferPrice.pricePerUnit * profile.transferMultiplier,
  };
  const opexMonthly = breakdown.compute + breakdown.storage + breakdown.dataTransfer;

  return {
    provider,
    capex: calcResourceCapex(profile, input.resources),
    opexMonthly,
    currency: computePrice.currency || input.currency,
    breakdown,
    unitPrices: {
      computePerHour: computePrice.pricePerUnit,
      storagePerGbMonth: storagePrice.pricePerUnit,
      transferPerGb: transferPrice.pricePerUnit,
      currency: computePrice.currency || input.currency,
    },
    usage: accumulateResourceUsage(input.resources),
    recommendations: buildOptimizationRecommendations(breakdown, opexMonthly),
    sources: {
      compute: computePrice.source,
      storage: storagePrice.source,
      dataTransfer: transferPrice.source,
    },
  };
}

async function fetchAwsUnitPrices(input: ScenarioInput) {
  const location = resolveAwsLocation(input.awsRegion, input.awsLocation);
  const filtersBase = location ? [{ field: "location", value: location }] : [];

  const [computeRaw, storageRaw, transferRaw] = await Promise.all([
    fetchAwsPricingProducts({
      serviceCode: "AmazonEC2",
      filters: [
        ...filtersBase,
        { field: "instanceType", value: input.instanceType },
        { field: "operatingSystem", value: "Linux" },
      ],
      maxResults: 50,
      maxPages: 1,
    }),
    fetchAwsPricingProducts({
      serviceCode: "AmazonS3",
      filters: [...filtersBase, { field: "productFamily", value: "Storage" }],
      maxResults: 50,
      maxPages: 1,
    }),
    fetchAwsPricingProducts({
      serviceCode: "AmazonEC2",
      filters: [...filtersBase, { field: "productFamily", value: "Data Transfer" }],
      maxResults: 50,
      maxPages: 1,
    }),
  ]);

  const computeItems = normalizeAwsPriceListEntries(computeRaw.priceList);
  const storageItems = normalizeAwsPriceListEntries(storageRaw.priceList);
  const transferItems = normalizeAwsPriceListEntries(transferRaw.priceList);

  const computePick = pickBestItem(computeItems, [
    (item) =>
      item.metadata?.instanceType === input.instanceType && item.unit.toLowerCase().includes("hr"),
  ]);
  const storagePick = pickBestItem(storageItems, [
    (item) => item.unit.toLowerCase().includes("gb"),
    (item) => item.service.toLowerCase().includes("storage"),
  ]);
  const transferPick = pickBestItem(transferItems, [
    (item) => item.metadata?.usageType?.toString().toLowerCase().includes("data transfer"),
    (item) => item.service.toLowerCase().includes("transfer"),
  ]);

  const currency =
    computePick?.currency || storagePick?.currency || transferPick?.currency || input.currency;

  return {
    compute: computePick?.pricePerUnit ?? 0,
    storage: storagePick?.pricePerUnit ?? 0,
    dataTransfer: transferPick?.pricePerUnit ?? 0,
    currency,
    sources: {
      compute: computePick?.source,
      storage: storagePick?.source,
      dataTransfer: transferPick?.source,
    },
  };
}

async function fetchAzureUnitPrices(input: ScenarioInput) {
  const regionFilter = input.azureRegion ? `armRegionName eq '${input.azureRegion}'` : "";
  const computeFilter = [
    "serviceName eq 'Virtual Machines'",
    `skuName eq '${input.instanceType}'`,
    regionFilter,
  ]
    .filter(Boolean)
    .join(" and ");

  const storageFilter = ["serviceName eq 'Storage'", regionFilter].filter(Boolean).join(" and ");
  const transferFilter = ["serviceName eq 'Bandwidth'", regionFilter].filter(Boolean).join(" and ");

  const [computeRaw, storageRaw, transferRaw] = await Promise.all([
    fetchAzureRetailPrices({ filter: computeFilter, pageSize: 50, maxPages: 1 }),
    fetchAzureRetailPrices({ filter: storageFilter, pageSize: 50, maxPages: 1 }),
    fetchAzureRetailPrices({ filter: transferFilter, pageSize: 50, maxPages: 1 }),
  ]);

  const computeItems = normalizeAzurePricingResponse({ Items: computeRaw.items });
  const storageItems = normalizeAzurePricingResponse({ Items: storageRaw.items });
  const transferItems = normalizeAzurePricingResponse({ Items: transferRaw.items });

  const computePick = pickBestItem(computeItems, [
    (item) => item.unit.toLowerCase().includes("hour"),
  ]);
  const storagePick = pickBestItem(storageItems, [
    (item) => item.unit.toLowerCase().includes("gb"),
  ]);
  const transferPick = pickBestItem(transferItems, [
    (item) => item.unit.toLowerCase().includes("gb"),
  ]);

  const currency =
    computePick?.currency || storagePick?.currency || transferPick?.currency || input.currency;

  return {
    compute: computePick?.pricePerUnit ?? 0,
    storage: storagePick?.pricePerUnit ?? 0,
    dataTransfer: transferPick?.pricePerUnit ?? 0,
    currency,
    sources: {
      compute: computePick?.source,
      storage: storagePick?.source,
      dataTransfer: transferPick?.source,
    },
  };
}

async function fetchGcpUnitPrices(input: ScenarioInput) {
  const computeServiceId = input.gcpComputeServiceId ?? GCP_DEFAULT_SERVICE_IDS.compute;
  const storageServiceId = input.gcpStorageServiceId ?? GCP_DEFAULT_SERVICE_IDS.storage;
  const networkServiceId = input.gcpNetworkServiceId ?? GCP_DEFAULT_SERVICE_IDS.network;

  const [computeRaw, storageRaw, transferRaw] = await Promise.all([
    fetchGcpSkus({ serviceId: computeServiceId, pageSize: 200, maxPages: 1 }),
    fetchGcpSkus({ serviceId: storageServiceId, pageSize: 200, maxPages: 1 }),
    fetchGcpSkus({ serviceId: networkServiceId, pageSize: 200, maxPages: 1 }),
  ]);

  const computeItems = normalizeGcpPricingResponse({ skus: computeRaw.skus });
  const storageItems = normalizeGcpPricingResponse({ skus: storageRaw.skus });
  const transferItems = normalizeGcpPricingResponse({ skus: transferRaw.skus });

  const computePick = pickBestItem(computeItems, [
    (item) => item.metadata?.description?.toString().toLowerCase().includes(input.instanceType),
    (item) => item.unit.toLowerCase().includes("hour"),
  ]);
  const storagePick = pickBestItem(storageItems, [
    (item) => item.unit.toLowerCase().includes("gb"),
  ]);
  const transferPick = pickBestItem(transferItems, [
    (item) => item.metadata?.description?.toString().toLowerCase().includes("egress"),
    (item) => item.unit.toLowerCase().includes("gb"),
  ]);

  const currency =
    computePick?.currency || storagePick?.currency || transferPick?.currency || input.currency;

  return {
    compute: computePick?.pricePerUnit ?? 0,
    storage: storagePick?.pricePerUnit ?? 0,
    dataTransfer: transferPick?.pricePerUnit ?? 0,
    currency,
    sources: {
      compute: computePick?.source,
      storage: storagePick?.source,
      dataTransfer: transferPick?.source,
    },
  };
}

export async function buildScenarioComparison(
  payload: Partial<ScenarioInput> & { providers?: Array<"aws" | "azure" | "gcp"> }
): Promise<ScenarioComparisonResponse> {
  const input: ScenarioInput = {
    ...DEFAULT_INPUTS,
    ...payload,
    instanceType: payload.instanceType?.trim() || DEFAULT_INPUTS.instanceType,
    instanceCount: clampPositive(toNumber(payload.instanceCount, DEFAULT_INPUTS.instanceCount), 1),
    storageGb: clampPositive(toNumber(payload.storageGb, DEFAULT_INPUTS.storageGb), 1),
    dataTransferGb: clampPositive(toNumber(payload.dataTransferGb, DEFAULT_INPUTS.dataTransferGb), 1),
    snapshotFrequencyPerDay: clampPositive(
      toNumber(payload.snapshotFrequencyPerDay, DEFAULT_INPUTS.snapshotFrequencyPerDay),
      1,
      24
    ),
    currency: payload.currency?.trim() || DEFAULT_INPUTS.currency,
    awsRegion: payload.awsRegion?.trim() || DEFAULT_INPUTS.awsRegion,
    azureRegion: payload.azureRegion?.trim() || DEFAULT_INPUTS.azureRegion,
    gcpRegion: payload.gcpRegion?.trim() || DEFAULT_INPUTS.gcpRegion,
  };

  const providers = payload.providers?.length ? payload.providers : ["aws", "azure", "gcp"];

  const scenarios: ScenarioEstimate[] = [];

  for (const profile of DEFAULT_SCENARIOS) {
    const providersEstimates: ProviderEstimate[] = [];

    for (const provider of providers) {
      if (provider === "aws") {
        const { compute, storage, dataTransfer, currency, sources } = await fetchAwsUnitPrices(input);
        providersEstimates.push(
          estimateProviderCosts(
            "aws",
            profile,
            input,
            { compute, storage, dataTransfer, currency },
            sources
          )
        );
      }

      if (provider === "azure") {
        const { compute, storage, dataTransfer, currency, sources } = await fetchAzureUnitPrices(input);
        providersEstimates.push(
          estimateProviderCosts(
            "azure",
            profile,
            input,
            { compute, storage, dataTransfer, currency },
            sources
          )
        );
      }

      if (provider === "gcp") {
        const { compute, storage, dataTransfer, currency, sources } = await fetchGcpUnitPrices(input);
        providersEstimates.push(
          estimateProviderCosts(
            "gcp",
            profile,
            input,
            { compute, storage, dataTransfer, currency },
            sources
          )
        );
      }
    }

    scenarios.push({
      scenarioId: profile.id,
      scenarioLabel: profile.label,
      scenarioDescription: profile.description,
      inputs: input,
      providers: providersEstimates,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    scenarios,
  };
}

export async function buildFinancialReport(input: FinancialReportInput): Promise<FinancialReport> {
  const scenario =
    DEFAULT_SCENARIOS.find((profile) => profile.id === input.scenarioId) ?? DEFAULT_SCENARIOS[0];
  const providers = input.providers?.length ? input.providers : ["aws", "azure", "gcp"];
  const sanitizedResources = input.resources.map((resource) => ({
    ...resource,
    vcpu: clampPositive(toNumber(resource.vcpu, 1), 1, 256),
    ramGb: clampPositive(toNumber(resource.ramGb, 1), 1, 4096),
    storageGb: clampPositive(toNumber(resource.storageGb, 0), 0, 100000),
    transferGb: clampPositive(toNumber(resource.transferGb, 0), 0, 100000),
    durationHours: clampPositive(toNumber(resource.durationHours, 0), 0, 8760),
  }));

  const normalizedInput: FinancialReportInput = {
    ...input,
    resources: sanitizedResources,
    currency: input.currency?.trim() || DEFAULT_INPUTS.currency,
    awsRegion: input.awsRegion?.trim() || DEFAULT_INPUTS.awsRegion,
    azureRegion: input.azureRegion?.trim() || DEFAULT_INPUTS.azureRegion,
    gcpRegion: input.gcpRegion?.trim() || DEFAULT_INPUTS.gcpRegion,
  };

  const providersReports: FinancialProviderReport[] = [];

  for (const provider of providers) {
    providersReports.push(await buildFinancialProviderReport(provider, scenario, normalizedInput));
  }

  return {
    generatedAt: new Date().toISOString(),
    scenario: {
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
    },
    inputs: normalizedInput,
    providers: providersReports,
  };
}

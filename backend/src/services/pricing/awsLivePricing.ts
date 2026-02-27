import {
  fetchAwsPricingProducts,
  type AwsPricingFilter,
} from '../awsPricingService.js';

const HOURS_PER_MONTH = 730;

const REGION_TO_LOCATION: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'ca-central-1': 'Canada (Central)',
  'eu-central-1': 'EU (Frankfurt)',
  'eu-west-1': 'EU (Ireland)',
  'eu-west-2': 'EU (London)',
  'eu-west-3': 'EU (Paris)',
  'eu-north-1': 'EU (Stockholm)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'sa-east-1': 'South America (Sao Paulo)',
};

function normalizeAwsRegion(region: string | null | undefined): string {
  const normalized = String(region || '').trim().toLowerCase();
  if (normalized.length === 0) return 'eu-west-3';
  return normalized;
}

function awsRegionToLocation(region: string): string {
  return REGION_TO_LOCATION[region] ?? region;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function readUsdFromPricePerUnit(value: unknown): number | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const payload = value as Record<string, unknown>;
    return (
      toPositiveNumber(payload.USD) ??
      toPositiveNumber(payload.usd) ??
      toPositiveNumber(payload.EUR) ??
      toPositiveNumber(payload.eur) ??
      null
    );
  }
  return toPositiveNumber(value);
}

type OnDemandExtraction = {
  hourlyUsd: number | null;
  fallbackUsd: number | null;
  scannedDimensions: number;
  matchedHourlyDimensions: number;
  unitsSeen: string[];
};

function extractOnDemandHourlyUsd(priceList: unknown[]): OnDemandExtraction {
  let fallbackUsd: number | null = null;
  let scannedDimensions = 0;
  let matchedHourlyDimensions = 0;
  const unitsSeen = new Set<string>();

  for (const entry of priceList) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const product = entry as Record<string, unknown>;
    const termsRaw = product.terms;
    if (!termsRaw || typeof termsRaw !== 'object' || Array.isArray(termsRaw)) continue;
    const onDemandRaw = (termsRaw as Record<string, unknown>).OnDemand;
    if (!onDemandRaw || typeof onDemandRaw !== 'object' || Array.isArray(onDemandRaw)) continue;

    for (const term of Object.values(onDemandRaw)) {
      if (!term || typeof term !== 'object' || Array.isArray(term)) continue;
      const priceDimensionsRaw = (term as Record<string, unknown>).priceDimensions;
      if (!priceDimensionsRaw || typeof priceDimensionsRaw !== 'object' || Array.isArray(priceDimensionsRaw)) {
        continue;
      }

      for (const dimension of Object.values(priceDimensionsRaw)) {
        if (!dimension || typeof dimension !== 'object' || Array.isArray(dimension)) continue;
        const payload = dimension as Record<string, unknown>;
        const unit = String(payload.unit || '').toLowerCase();
        const usd = readUsdFromPricePerUnit(payload.pricePerUnit);
        scannedDimensions += 1;
        if (unit.length > 0) unitsSeen.add(unit);
        if (usd == null) continue;
        if (fallbackUsd == null) fallbackUsd = usd;
        if (unit.includes('hrs') || unit.includes('hour') || unit.includes('hr')) {
          matchedHourlyDimensions += 1;
          return {
            hourlyUsd: usd,
            fallbackUsd,
            scannedDimensions,
            matchedHourlyDimensions,
            unitsSeen: Array.from(unitsSeen),
          };
        }
      }
    }
  }

  return {
    hourlyUsd: null,
    fallbackUsd,
    scannedDimensions,
    matchedHourlyDimensions,
    unitsSeen: Array.from(unitsSeen),
  };
}

export type AwsMonthlyPricingDiagnostics = {
  serviceCode: string;
  region: string;
  location: string;
  filters: AwsPricingFilter[];
  rawCount: number;
  parsedEntries: number;
  scannedDimensions: number;
  matchedHourlyDimensions: number;
  unitsSeen: string[];
  hourlyUsd: number | null;
  fallbackUsd: number | null;
};

type AwsMonthlyPricingResult = {
  monthlyCostUsd: number | null;
  diagnostics: AwsMonthlyPricingDiagnostics;
};

async function getAwsMonthlyPriceUsd(options: {
  serviceCode: string;
  region: string;
  location: string;
  filters: AwsPricingFilter[];
}): Promise<AwsMonthlyPricingResult> {
  const response = await fetchAwsPricingProducts({
    serviceCode: options.serviceCode,
    filters: options.filters,
    maxResults: 20,
    maxPages: 2,
  });
  const extraction = extractOnDemandHourlyUsd(response.priceList);
  const selectedHourly = extraction.hourlyUsd ?? extraction.fallbackUsd;
  return {
    monthlyCostUsd: selectedHourly == null ? null : Number((selectedHourly * HOURS_PER_MONTH).toFixed(4)),
    diagnostics: {
      serviceCode: options.serviceCode,
      region: options.region,
      location: options.location,
      filters: options.filters,
      rawCount: response.rawCount,
      parsedEntries: response.priceList.length,
      scannedDimensions: extraction.scannedDimensions,
      matchedHourlyDimensions: extraction.matchedHourlyDimensions,
      unitsSeen: extraction.unitsSeen,
      hourlyUsd: extraction.hourlyUsd,
      fallbackUsd: extraction.fallbackUsd,
    },
  };
}

function normalizeRdsEngine(rawEngine: string | null | undefined): string {
  const engine = String(rawEngine || '').toLowerCase();
  if (engine.includes('postgres')) return 'PostgreSQL';
  if (engine.includes('mysql')) return 'MySQL';
  if (engine.includes('mariadb')) return 'MariaDB';
  if (engine.includes('oracle')) return 'Oracle';
  if (engine.includes('sqlserver') || engine.includes('sql server')) return 'SQL Server';
  if (engine.includes('aurora')) return 'Aurora MySQL';
  return 'PostgreSQL';
}

function normalizeCacheEngine(rawEngine: string | null | undefined): string {
  const engine = String(rawEngine || '').toLowerCase();
  if (engine.includes('mem')) return 'Memcached';
  return 'Redis';
}

export async function getAwsEc2MonthlyPriceUsd(input: {
  instanceType: string;
  region?: string | null;
}): Promise<number | null> {
  const result = await getAwsEc2MonthlyPriceUsdWithDiagnostics(input);
  return result.monthlyCostUsd;
}

export async function getAwsEc2MonthlyPriceUsdWithDiagnostics(input: {
  instanceType: string;
  region?: string | null;
}): Promise<AwsMonthlyPricingResult> {
  const instanceType = String(input.instanceType || '').trim();
  if (!instanceType) {
    return {
      monthlyCostUsd: null,
      diagnostics: {
        serviceCode: 'AmazonEC2',
        region: '',
        location: '',
        filters: [],
        rawCount: 0,
        parsedEntries: 0,
        scannedDimensions: 0,
        matchedHourlyDimensions: 0,
        unitsSeen: [],
        hourlyUsd: null,
        fallbackUsd: null,
      },
    };
  }
  const region = normalizeAwsRegion(input.region);
  const location = awsRegionToLocation(region);
  const filters: AwsPricingFilter[] = [
    { field: 'instanceType', value: instanceType },
    { field: 'location', value: location },
    { field: 'operatingSystem', value: 'Linux' },
    { field: 'tenancy', value: 'Shared' },
    { field: 'preInstalledSw', value: 'NA' },
    { field: 'capacitystatus', value: 'Used' },
  ];

  return getAwsMonthlyPriceUsd({
    serviceCode: 'AmazonEC2',
    region,
    location,
    filters,
  });
}

export async function getAwsRdsMonthlyPriceUsd(input: {
  instanceClass: string;
  engine?: string | null;
  region?: string | null;
}): Promise<number | null> {
  const instanceClass = String(input.instanceClass || '').trim();
  if (!instanceClass) return null;
  const region = normalizeAwsRegion(input.region);
  const location = awsRegionToLocation(region);
  const engine = normalizeRdsEngine(input.engine);

  const result = await getAwsMonthlyPriceUsd({
    serviceCode: 'AmazonRDS',
    region,
    location,
    filters: [
      { field: 'instanceType', value: instanceClass },
      { field: 'location', value: location },
      { field: 'databaseEngine', value: engine },
      { field: 'deploymentOption', value: 'Single-AZ' },
    ],
  });
  return result.monthlyCostUsd;
}

export async function getAwsElastiCacheMonthlyPriceUsd(input: {
  nodeType: string;
  engine?: string | null;
  region?: string | null;
}): Promise<number | null> {
  const nodeType = String(input.nodeType || '').trim();
  if (!nodeType) return null;
  const region = normalizeAwsRegion(input.region);
  const location = awsRegionToLocation(region);
  const engine = normalizeCacheEngine(input.engine);

  const result = await getAwsMonthlyPriceUsd({
    serviceCode: 'AmazonElastiCache',
    region,
    location,
    filters: [
      { field: 'instanceType', value: nodeType },
      { field: 'location', value: location },
      { field: 'cacheEngine', value: engine },
    ],
  });
  return result.monthlyCostUsd;
}

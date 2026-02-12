// ============================================================
// Market Data Constants — Verified industry data for ROI calculations
// ============================================================

export const DOWNTIME_COSTS = {
  enterprise: {
    label: 'Grande entreprise (>1000 employes)',
    perHour: { min: 300_000, median: 500_000, max: 5_000_000, currency: 'USD' },
    perMinute: { min: 5_000, median: 8_333, max: 83_333, currency: 'USD' },
    source: 'ITIC 2024 Hourly Cost of Downtime Survey',
    sourceUrl: 'https://itic-corp.com/itic-2024-hourly-cost-of-downtime-report/',
    notes: '90%+ des grandes entreprises estiment le cout > 300K$/h. 41% estiment entre 1M$ et 5M$/h.',
  },
  midMarket: {
    label: 'ETI / Mid-market (200-1000 employes)',
    perHour: { min: 100_000, median: 300_000, max: 1_000_000, currency: 'USD' },
    perMinute: { min: 1_667, median: 5_000, max: 16_667, currency: 'USD' },
    source: 'ITIC 2024 + EMA Research 2024',
    sourceUrl: 'https://www.bigpanda.io/blog/it-outage-costs-2024/',
    notes: 'EMA Research 2024 : cout moyen de 14,056$/min toutes tailles confondues.',
  },
  smb: {
    label: 'PME (<200 employes)',
    perHour: { min: 25_000, median: 50_000, max: 300_000, currency: 'USD' },
    perMinute: { min: 417, median: 833, max: 5_000, currency: 'USD' },
    source: 'ITIC/Calyptix 2025 Joint Study',
    sourceUrl: 'https://systechmsp.com/what-it-downtime-really-costs/',
    notes: '57% des PME de 20-100 employes estiment le cout a 100K$/h.',
  },

  byVertical: {
    banking_finance: { perHour: 5_000_000, source: 'ITIC 2024 Part 2' },
    healthcare: { perHour: 5_000_000, source: 'ITIC 2024 Part 2' },
    manufacturing: { perHour: 2_300_000, source: 'Siemens 2024' },
    retail: { perHour: 1_100_000, source: 'ITIC 2024 Part 2' },
    media_telecom: { perHour: 2_000_000, source: 'ITIC 2024 Part 2' },
    government: { perHour: 1_500_000, source: 'ITIC 2024 Part 2' },
    technology: { perHour: 500_000, source: 'Estimation moyenne' },
  },
} as const;

export const DATA_BREACH_COSTS = {
  global_average: {
    total: 4_880_000,
    currency: 'USD',
    source: 'IBM Cost of a Data Breach Report 2024',
    sourceUrl: 'https://www.ibm.com/reports/data-breach',
    notes: 'Cout moyen mondial d\'un data breach. Inclut downtime, recovery, amendes.',
  },
} as const;

export const MARKET_STATS = {
  outage_frequency: {
    pct_orgs_experienced_outage: 60,
    pct_outages_over_100k: 70,
    source: 'Uptime Institute + Splunk',
  },
  outage_duration: {
    typical_range: '30 minutes a 2 heures',
    ransomware_healthcare_avg_days: 24,
    source: 'EMA Research 2024',
  },
  smb_breach_rate: {
    smb: 88,
    large: 39,
    source: 'Verizon 2025 Data Breach Incident Report',
  },
} as const;

export const COMPANY_SIZE_PROFILES = {
  smb: { label: 'PME', minEmployees: 1, maxEmployees: 199, defaultHourlyCost: 50_000 },
  midMarket: { label: 'ETI', minEmployees: 200, maxEmployees: 999, defaultHourlyCost: 300_000 },
  enterprise: { label: 'Grande entreprise', minEmployees: 1000, maxEmployees: Infinity, defaultHourlyCost: 500_000 },
} as const;

export type CompanySizeKey = keyof typeof COMPANY_SIZE_PROFILES;

export function getDefaultHourlyCost(sizeKey: CompanySizeKey): number {
  return COMPANY_SIZE_PROFILES[sizeKey].defaultHourlyCost;
}

export function getHourlyCostForVertical(vertical: string): number {
  const v = DOWNTIME_COSTS.byVertical[vertical as keyof typeof DOWNTIME_COSTS.byVertical];
  return v?.perHour ?? DOWNTIME_COSTS.midMarket.perHour.median;
}

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY'] as const;

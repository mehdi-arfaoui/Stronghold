import type { SupportedCurrency } from './market-financial-data.js';

export type DrStrategyKey =
  | 'backup_restore'
  | 'pilot_light'
  | 'warm_standby'
  | 'hot_standby'
  | 'active_active';

export type IncidentProbabilityKey =
  | 'infrastructure'
  | 'cloud_region'
  | 'ransomware'
  | 'third_party'
  | 'human_error'
  | 'database'
  | 'dns_network';

export type CostSourceKey =
  | 'cloud_type_reference'
  | 'criticality_fallback'
  | 'user_override';

export type ProfileValueSourceKey =
  | 'user_input'
  | 'suggested'
  | 'inferred'
  | 'bia_validated'
  | 'inferred_infrastructure'
  | 'market_reference';

export const DR_STRATEGY_PROFILES: Record<
  DrStrategyKey,
  {
    label: string;
    order: number;
    rtoMinMinutes: number;
    rtoMaxMinutes: number;
    rtoTypicalMinutes: number;
    rpoMinMinutes: number;
    rpoMaxMinutes: number;
    productionCostMultiplier: number;
    monthlyCostFloor: number;
    source: string;
  }
> = {
  backup_restore: {
    label: 'Backup & Restore',
    order: 1,
    rtoMinMinutes: 120,
    rtoMaxMinutes: 1_440,
    rtoTypicalMinutes: 240,
    rpoMinMinutes: 60,
    rpoMaxMinutes: 1_440,
    productionCostMultiplier: 0.08,
    monthlyCostFloor: 5,
    source:
      'AWS Architecture Blog (2024) and public cloud pricing benchmarks (AWS/Azure/GCP, 2025)',
  },
  pilot_light: {
    label: 'Pilot Light',
    order: 2,
    rtoMinMinutes: 10,
    rtoMaxMinutes: 30,
    rtoTypicalMinutes: 20,
    rpoMinMinutes: 5,
    rpoMaxMinutes: 60,
    productionCostMultiplier: 0.2,
    monthlyCostFloor: 15,
    source:
      'AWS Architecture Blog (2024) and public cloud pricing benchmarks (AWS/Azure/GCP, 2025)',
  },
  warm_standby: {
    label: 'Warm Standby',
    order: 3,
    rtoMinMinutes: 5,
    rtoMaxMinutes: 10,
    rtoTypicalMinutes: 7.5,
    rpoMinMinutes: 1,
    rpoMaxMinutes: 5,
    productionCostMultiplier: 0.42,
    monthlyCostFloor: 40,
    source:
      'AWS Architecture Blog (2024) and public cloud pricing benchmarks (AWS/Azure/GCP, 2025)',
  },
  hot_standby: {
    label: 'Hot Standby',
    order: 4,
    rtoMinMinutes: 1,
    rtoMaxMinutes: 5,
    rtoTypicalMinutes: 3,
    rpoMinMinutes: 0,
    rpoMaxMinutes: 1,
    productionCostMultiplier: 0.65,
    monthlyCostFloor: 80,
    source:
      'AWS Architecture Blog (2024) and public cloud pricing benchmarks (AWS/Azure/GCP, 2025)',
  },
  active_active: {
    label: 'Active-Active',
    order: 5,
    rtoMinMinutes: 0,
    rtoMaxMinutes: 1,
    rtoTypicalMinutes: 0.5,
    rpoMinMinutes: 0,
    rpoMaxMinutes: 1,
    productionCostMultiplier: 0.85,
    monthlyCostFloor: 120,
    source:
      'AWS Architecture Blog (2024) and public cloud pricing benchmarks (AWS/Azure/GCP, 2025)',
  },
};

export const DR_STRATEGY_COST_FACTORS: Record<
  DrStrategyKey,
  {
    min: number;
    max: number;
    default: number;
  }
> = {
  backup_restore: {
    min: 0.05,
    max: 0.1,
    default: 0.08,
  },
  pilot_light: {
    min: 0.15,
    max: 0.25,
    default: 0.2,
  },
  warm_standby: {
    min: 0.3,
    max: 0.5,
    default: 0.42,
  },
  hot_standby: {
    min: 0.55,
    max: 0.75,
    default: 0.65,
  },
  active_active: {
    min: 0.8,
    max: 0.95,
    default: 0.85,
  },
};

export const AWS_PRICING_ESTIMATES_EU_WEST_3 = {
  ec2: {
    't3.nano': 4.5,
    't3.micro': 8.5,
    't3.small': 17,
    't3.medium': 34,
    'm5.large': 78,
    'm5.xlarge': 156,
    'c5.large': 69,
    'c5.xlarge': 138,
    'r5.large': 102,
    'r5.xlarge': 204,
    default: 40,
  },
  rds: {
    'db.t3.micro': 15,
    'db.t3.small': 29,
    'db.t3.medium': 58,
    'db.r5.large': 185,
    'db.r5.xlarge': 370,
    default: 60,
  },
  elasticache: {
    'cache.t3.micro': 13,
    'cache.t3.small': 26,
    'cache.t3.medium': 52,
    'cache.r5.large': 163,
    default: 40,
  },
  lambda: {
    'per_million_invocations_128mb': 2.1,
    'per_million_invocations_512mb': 8.3,
    'per_million_invocations_1024mb': 16.6,
    default: 2.1,
  },
  dynamodb: {
    per_wcu_month: 0.47,
    per_rcu_month: 0.09,
    default: 12,
  },
  s3: {
    per_gb_month: 0.023,
    default: 1,
  },
  alb: {
    base_monthly: 22,
    per_lcu: 5.8,
    default: 27.8,
  },
  nat_gateway: {
    base_monthly: 32,
    per_gb: 0.045,
    default: 32,
  },
  sqs: {
    per_million_requests: 0.4,
    default: 1,
  },
  sns: {
    per_million_notifications: 0.5,
    default: 1,
  },
} as const;

export const INCIDENT_PROBABILITIES: Record<
  IncidentProbabilityKey,
  {
    probabilityAnnual: number;
    source: string;
  }
> = {
  infrastructure: {
    probabilityAnnual: 0.15,
    source: 'Uptime Institute 2024 Annual Outage Analysis',
  },
  cloud_region: {
    probabilityAnnual: 0.05,
    source: 'Uptime Institute 2024 Annual Outage Analysis',
  },
  ransomware: {
    probabilityAnnual: 0.1,
    source: 'IBM Cost of Data Breach 2024 and sector incident trend reports',
  },
  third_party: {
    probabilityAnnual: 0.08,
    source: 'ITIC 2024 and cross-provider incident reports',
  },
  human_error: {
    probabilityAnnual: 0.2,
    source: 'Uptime Institute 2024 Annual Outage Analysis',
  },
  database: {
    probabilityAnnual: 0.12,
    source: 'Uptime Institute 2024 Annual Outage Analysis',
  },
  dns_network: {
    probabilityAnnual: 0.1,
    source: 'Uptime Institute 2024 Annual Outage Analysis',
  },
};

export const DOWNTIME_MEDIAN_BY_EMPLOYEE_SIZE = [
  { minEmployees: 0, maxEmployees: 24, hourlyCost: 1_500 },
  { minEmployees: 25, maxEmployees: 100, hourlyCost: 8_000 },
  { minEmployees: 101, maxEmployees: 250, hourlyCost: 25_000 },
  { minEmployees: 251, maxEmployees: 1_000, hourlyCost: 100_000 },
  { minEmployees: 1_001, maxEmployees: 5_000, hourlyCost: 300_000 },
  { minEmployees: 5_001, maxEmployees: Number.MAX_SAFE_INTEGER, hourlyCost: 500_000 },
] as const;

export const INFRA_SIZE_HEURISTICS = [
  {
    minNodes: 1,
    maxNodes: 20,
    sizeLabel: 'micro_sme',
    inferredEmployees: 30,
    inferredAnnualRevenue: 3_000_000,
    confidence: 0.35,
  },
  {
    minNodes: 21,
    maxNodes: 80,
    sizeLabel: 'sme_mid',
    inferredEmployees: 200,
    inferredAnnualRevenue: 20_000_000,
    confidence: 0.4,
  },
  {
    minNodes: 81,
    maxNodes: 300,
    sizeLabel: 'mid_enterprise',
    inferredEmployees: 1_200,
    inferredAnnualRevenue: 200_000_000,
    confidence: 0.45,
  },
  {
    minNodes: 301,
    maxNodes: Number.MAX_SAFE_INTEGER,
    sizeLabel: 'large_enterprise',
    inferredEmployees: 5_000,
    inferredAnnualRevenue: 700_000_000,
    confidence: 0.5,
  },
] as const;

export const IT_BUDGET_PERCENT_BY_SECTOR: Record<string, number> = {
  finance: 0.08,
  healthcare: 0.07,
  retail: 0.05,
  retail_ecommerce: 0.05,
  manufacturing: 0.04,
  technology: 0.1,
  technology_saas: 0.1,
  services: 0.05,
  public: 0.06,
  government_public: 0.06,
};

export const RESOURCE_MONTHLY_COST_REFERENCES = {
  compute: {
    vm_small: { min: 30, max: 80 },
    vm_medium: { min: 80, max: 250 },
    vm_large: { min: 250, max: 800 },
    kubernetes_pod: { min: 30, max: 120 },
    serverless: { min: 5, max: 50 },
  },
  database: {
    small: { min: 80, max: 150 },
    medium: { min: 150, max: 400 },
    large: { min: 400, max: 1_200 },
    redis_cache: { min: 120, max: 300 },
    elasticsearch: { min: 200, max: 600 },
  },
  storage: {
    object_per_tb: { min: 23, max: 25 },
    disk_500gb_ssd: { min: 50, max: 80 },
  },
  network: {
    load_balancer: { min: 20, max: 50 },
    api_gateway: { min: 10, max: 100 },
    cdn: { min: 20, max: 200 },
  },
  messaging: {
    queue: { min: 5, max: 30 },
    pubsub: { min: 5, max: 20 },
  },
} as const;

export const DR_FINANCIAL_SOURCES = {
  downtimeCost:
    'ITIC 2024 Hourly Cost of Downtime Survey, Gartner 2024, BigPanda 2024 (conservative medians)',
  incidentProbabilities:
    'Estimated probabilities from Uptime Institute 2024, ITIC 2024 and IBM Cost of Data Breach 2024',
  strategyMatrix:
    'AWS Architecture Blog 2024 and public cloud pricing benchmarks (AWS/Azure/GCP, 2025)',
  serviceCost:
    'Public cloud pricing references (AWS/Azure/GCP as of 2025-01), conservative ranges',
};

export const DEFAULT_DR_BUDGET_PERCENT = 4;
export const DEFAULT_CURRENCY: SupportedCurrency = 'EUR';

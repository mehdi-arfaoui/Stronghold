/**
 * Market financial reference data used by the Stronghold financial engine.
 *
 * All values are default estimates based on public sources.
 * Users can override these values from organization settings.
 */

export const DOWNTIME_COST_BENCHMARKS = {
  enterprise: {
    label: 'Large enterprise (>1000 employees)',
    perHourUSD: { p25: 300_000, median: 500_000, p75: 1_000_000, p95: 5_000_000 },
    source: 'ITIC 2024 Hourly Cost of Downtime Survey',
    sourceUrl: 'https://itic-corp.com/itic-2024-hourly-cost-of-downtime-report/',
    year: 2024,
  },
  midMarket: {
    label: 'Mid-market (200-1000 employees)',
    perHourUSD: { p25: 100_000, median: 300_000, p75: 500_000, p95: 1_000_000 },
    source: 'EMA Research 2024 + Gartner 2024',
    sourceUrl: 'https://www.bigpanda.io/blog/it-outage-costs-2024/',
    year: 2024,
  },
  smb: {
    label: 'SMB (<200 employees)',
    perHourUSD: { p25: 10_000, median: 50_000, p75: 100_000, p95: 300_000 },
    source: 'ITIC 2024 + CloudSecureTech 2025',
    sourceUrl: 'https://www.cloudsecuretech.com/cost-of-it-downtime-in-2025/',
    year: 2025,
  },
  byVertical: {
    banking_finance: {
      perHourUSD: 5_000_000,
      source: 'Gartner 2024 - finance and healthcare can exceed 5M USD/hour in Fortune 500 contexts',
      notes: 'May include regulatory penalties such as DORA and NIS2.',
    },
    healthcare: {
      perHourUSD: 3_200_000,
      source: 'Sector studies 2024 - large hospitals can reach 3.2M USD/hour for EHR outages',
      notes: 'Patient safety impact is additional to direct financial impact.',
    },
    manufacturing: {
      perHourUSD: 2_300_000,
      source: 'Siemens 2024 - automotive manufacturing outage estimate',
      notes: null,
    },
    retail_ecommerce: {
      perHourUSD: 1_100_000,
      source: 'ITIC 2024 Part 2',
      notes: 'Highly variable based on online revenue share.',
    },
    media_telecom: {
      perHourUSD: 2_000_000,
      source: 'ITIC 2024 Part 2',
      notes: null,
    },
    government_public: {
      perHourUSD: 1_500_000,
      source: 'ITIC 2024 Part 2',
      notes: 'Can include societal impact in addition to financial impact.',
    },
    technology_saas: {
      perHourUSD: 500_000,
      source: 'Cross-sector average estimate',
      notes: 'Highly variable depending on ARR and active user base.',
    },
  },
  globalStats: {
    global2000_annual_loss_per_company_USD: 200_000_000,
    global2000_total_annual_loss_USD: 400_000_000_000,
    global2000_profit_pct_lost: 9,
    source: 'Splunk 2024 cited by New Relic 2025',

    median_cost_per_minute_USD: 33_333,
    median_annual_cost_USD: 76_000_000,
    newRelicSource: 'New Relic 2025 Observability Study',

    pct_incidents_over_100k: 70,
    pct_incidents_over_100k_2019: 39,
    pct_recovery_over_48h: 16,
    pct_recovery_over_48h_2017: 4,
    uptimeSource: 'Uptime Institute Annual Outage Report 2025',
  },
} as const;

export const REGULATORY_PENALTY_BENCHMARKS = {
  nis2: {
    essential_entities: {
      maxFine: '10M EUR or 2% of global annual turnover (whichever is higher)',
      maxFineEUR: 10_000_000,
      maxFinePctRevenue: 2.0,
      sectors: [
        'energy',
        'transport',
        'health',
        'water',
        'digital infrastructure',
        'space',
        'banking',
      ],
      source: 'NIS2 Directive, Articles 21 and 23',
    },
    important_entities: {
      maxFine: '7M EUR or 1.4% of global annual turnover (whichever is higher)',
      maxFineEUR: 7_000_000,
      maxFinePctRevenue: 1.4,
      sectors: ['digital services', 'chemicals', 'food', 'manufacturing', 'research'],
      source: 'NIS2 Directive',
    },
    personalLiability: true,
    notes: 'Personal liability can apply to leadership in severe negligence cases.',
    complianceDeadline: '2026-10-17',
  },
  dora: {
    financialEntities: {
      description: 'Banks, insurers, asset managers, payment institutions',
      penalties:
        'Set by national competent authorities; can include administrative and criminal sanctions.',
      source: 'DORA Regulation, applicable since 2025-01-17',
    },
    ictProviders: {
      maxFine: '1% of average daily worldwide turnover per day, up to 6 months',
      maxFinePctDailyRevenue: 1.0,
      maxDurationDays: 180,
      source: 'DORA provisions for critical ICT third-party providers',
    },
    personalLiability: true,
    notes: 'Individual fines can reach up to 1M EUR in some enforcement contexts.',
    personalMaxFineEUR: 1_000_000,
    applicableDate: '2025-01-17',
  },
  gdpr: {
    maxFine: '20M EUR or 4% of global annual turnover',
    maxFineEUR: 20_000_000,
    maxFinePctRevenue: 4.0,
    source: 'GDPR Article 83',
  },
  dataBreach: {
    globalAverageCostUSD: 4_880_000,
    source: 'IBM Cost of a Data Breach Report 2024',
    sourceUrl: 'https://www.ibm.com/reports/data-breach',
    notes:
      'Average global data breach cost including downtime, remediation, legal and reputation effects.',
  },
} as const;

export const RECOVERY_STRATEGY_COSTS = {
  active_active: {
    label: 'Active-Active (Multi-Site)',
    description: 'Duplicated infrastructure across 2+ regions with near-instant failover.',
    rto: { min: 0, max: 1, unit: 'minutes' },
    rpo: { min: 0, max: 1, unit: 'minutes' },
    costMultiplier: { min: 1.6, max: 2.0 },
    monthlyEstimateUSD: { min: 2_000, max: 15_000, perService: true },
    complexity: 'very_high',
    bestFor: ['Payments', 'Trading', 'Real-time APIs', 'Mission-critical SaaS'],
    cloudDetails: {
      aws: 'Multi-AZ RDS + Global Accelerator + Route53 failover + DynamoDB Global Tables',
      azure: 'Cosmos DB multi-region + Traffic Manager + Availability Groups',
      gcp: 'Spanner multi-region + Cloud CDN + Global Load Balancer',
    },
    source: 'AWS Well-Architected Reliability Pillar and AWS Architecture Blog 2024',
  },
  warm_standby: {
    label: 'Warm Standby',
    description:
      'Reduced but live stack in a secondary region, scaled up during failover.',
    rto: { min: 5, max: 10, unit: 'minutes' },
    rpo: { min: 1, max: 5, unit: 'minutes' },
    costMultiplier: { min: 0.3, max: 0.5 },
    monthlyEstimateUSD: { min: 500, max: 5_000, perService: true },
    complexity: 'medium',
    bestFor: ['Critical business apps', 'ERP', 'CRM', 'Transactional databases'],
    cloudDetails: {
      aws: 'RDS cross-region read replica + reduced Auto Scaling + ELB + Route53',
      azure: 'SQL Geo-Replication + Traffic Manager + App Service warm slot',
      gcp: 'Cloud SQL cross-region replica + Cloud DNS failover',
    },
    source: 'AWS Architecture Blog - Pilot Light and Warm Standby (2024)',
  },
  pilot_light: {
    label: 'Pilot Light',
    description:
      'Minimal infrastructure with replicated data and cold compute activated on demand.',
    rto: { min: 10, max: 30, unit: 'minutes' },
    rpo: { min: 5, max: 15, unit: 'minutes' },
    costMultiplier: { min: 0.1, max: 0.2 },
    monthlyEstimateUSD: { min: 100, max: 1_500, perService: true },
    complexity: 'medium_low',
    bestFor: ['Moderate SLA apps', 'Important staging environments'],
    cloudDetails: {
      aws: 'RDS read replica + prebuilt AMIs + Auto Scaling group at 0 + CloudFormation',
      azure: 'SQL Geo-Replication + ARM templates + VMSS at 0',
      gcp: 'Cloud SQL replica + Instance Templates + MIG at 0',
    },
    source: 'AWS Architecture Blog - Pilot Light and Warm Standby (2024)',
  },
  backup_restore: {
    label: 'Backup and Restore',
    description:
      'Periodic backups with full rebuild when a disaster occurs.',
    rto: { min: 60, max: 480, unit: 'minutes' },
    rpo: { min: 60, max: 1_440, unit: 'minutes' },
    costMultiplier: { min: 0.02, max: 0.05 },
    monthlyEstimateUSD: { min: 20, max: 200, perService: true },
    complexity: 'low',
    bestFor: ['Archives', 'Dev/Test', 'Non-critical workloads'],
    cloudDetails: {
      aws: 'AWS Backup + S3 + Glacier + CloudFormation or Terraform rebuild',
      azure: 'Azure Backup + Blob Storage + ARM templates',
      gcp: 'Cloud Storage + Deployment Manager',
    },
    source: 'AWS Well-Architected Reliability Pillar',
  },
} as const;

/**
 * Estimated hourly impact per direct dependent by node type.
 *
 * Method: base multiplier x direct dependents x org size multiplier.
 * These are conservative defaults and should be overridden with real business values.
 */
export const NODE_TYPE_COST_MULTIPLIERS: Record<string, number> = {
  DATABASE: 500,
  API_GATEWAY: 300,
  LOAD_BALANCER: 300,
  MESSAGE_QUEUE: 250,
  APPLICATION: 200,
  MICROSERVICE: 200,
  CACHE: 150,
  STORAGE: 100,
  OBJECT_STORAGE: 100,
  FILE_STORAGE: 100,
  DNS: 400,
  CDN: 100,
  MONITORING: 50,
  CI_CD: 30,
};

export const ORG_SIZE_MULTIPLIERS = {
  startup: 0.3,
  smb: 0.6,
  midMarket: 1.0,
  enterprise: 2.5,
  largeEnterprise: 5.0,
} as const;

export const STRATEGY_RISK_REDUCTION = {
  active_active: 0.95,
  warm_standby: 0.8,
  pilot_light: 0.6,
  backup_restore: 0.4,
} as const;

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF'] as const;

export type OrganizationSizeCategory = keyof typeof ORG_SIZE_MULTIPLIERS;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export type RecoveryStrategyKey = keyof typeof RECOVERY_STRATEGY_COSTS;
export type VerticalSectorKey = keyof typeof DOWNTIME_COST_BENCHMARKS.byVertical;


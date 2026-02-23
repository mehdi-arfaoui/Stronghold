export type DemoSectorKey =
  | 'ecommerce'
  | 'finance'
  | 'healthcare'
  | 'manufacturing'
  | 'it_saas'
  | 'transport'
  | 'energy'
  | 'public';

export type DemoCompanySizeKey = 'pme' | 'pme_plus' | 'eti' | 'large';

export type DemoFinancialFieldKey =
  | 'employeeCount'
  | 'annualRevenue'
  | 'annualITBudget'
  | 'drBudgetPercent'
  | 'hourlyDowntimeCost';

export type DemoProfileFieldSource = 'suggested' | 'user_input';

export type DemoProfileFinancials = Record<DemoFinancialFieldKey, number>;

export type DemoFinancialOverrides = Partial<Record<DemoFinancialFieldKey, number>>;

type DemoSectorDefinition = {
  key: DemoSectorKey;
  label: string;
  icon: string;
  verticalSector: string;
  industrySector: string;
};

type DemoCompanySizeDefinition = {
  key: DemoCompanySizeKey;
  label: string;
  employeeRangeLabel: string;
};

export type DemoProfileSelectionInput = {
  sector?: DemoSectorKey;
  companySize?: DemoCompanySizeKey;
  financialOverrides?: DemoFinancialOverrides | null;
};

export type DemoProfileSelection = {
  sector: DemoSectorKey;
  sectorLabel: string;
  companySize: DemoCompanySizeKey;
  companySizeLabel: string;
  industrySector: string;
  verticalSector: string;
  financials: DemoProfileFinancials;
  fieldSources: Record<DemoFinancialFieldKey, DemoProfileFieldSource>;
  hasUserOverrides: boolean;
};

export const DEMO_SECTOR_DEFINITIONS: ReadonlyArray<DemoSectorDefinition> = [
  {
    key: 'ecommerce',
    label: 'E-commerce / Retail',
    icon: 'ShoppingCart',
    verticalSector: 'retail_ecommerce',
    industrySector: 'retail_ecommerce',
  },
  {
    key: 'finance',
    label: 'Finance / Banque / Assurance',
    icon: 'Landmark',
    verticalSector: 'banking_finance',
    industrySector: 'finance',
  },
  {
    key: 'healthcare',
    label: 'Sante / Pharma',
    icon: 'HeartPulse',
    verticalSector: 'healthcare',
    industrySector: 'healthcare',
  },
  {
    key: 'manufacturing',
    label: 'Industrie / Manufacturing',
    icon: 'Factory',
    verticalSector: 'manufacturing',
    industrySector: 'manufacturing',
  },
  {
    key: 'it_saas',
    label: 'Services IT / SaaS',
    icon: 'Code2',
    verticalSector: 'technology_saas',
    industrySector: 'technology_saas',
  },
  {
    key: 'transport',
    label: 'Transport / Logistique',
    icon: 'Truck',
    verticalSector: 'media_telecom',
    industrySector: 'services',
  },
  {
    key: 'energy',
    label: 'Energie / Utilities',
    icon: 'Zap',
    verticalSector: 'government_public',
    industrySector: 'manufacturing',
  },
  {
    key: 'public',
    label: 'Secteur public / Administration',
    icon: 'Building2',
    verticalSector: 'government_public',
    industrySector: 'government_public',
  },
] as const;

export const DEMO_COMPANY_SIZE_DEFINITIONS: ReadonlyArray<DemoCompanySizeDefinition> = [
  {
    key: 'pme',
    label: 'PME (< 50 employes)',
    employeeRangeLabel: '<50',
  },
  {
    key: 'pme_plus',
    label: 'PME+ (50-250 employes)',
    employeeRangeLabel: '50-250',
  },
  {
    key: 'eti',
    label: 'ETI (250-2000 employes)',
    employeeRangeLabel: '250-2000',
  },
  {
    key: 'large',
    label: 'Grande entreprise (2000+ employes)',
    employeeRangeLabel: '2000+',
  },
] as const;

export const DEFAULT_DEMO_PROFILE: Readonly<{
  sector: DemoSectorKey;
  companySize: DemoCompanySizeKey;
}> = {
  sector: 'ecommerce',
  companySize: 'eti',
} as const;

export const DEMO_PROFILE_MATRIX: Readonly<
  Record<DemoSectorKey, Record<DemoCompanySizeKey, DemoProfileFinancials>>
> = {
  ecommerce: {
    pme: {
      employeeCount: 30,
      annualRevenue: 5_000_000,
      annualITBudget: 250_000,
      drBudgetPercent: 3,
      hourlyDowntimeCost: 2_000,
    },
    pme_plus: {
      employeeCount: 150,
      annualRevenue: 30_000_000,
      annualITBudget: 1_500_000,
      drBudgetPercent: 4,
      hourlyDowntimeCost: 15_000,
    },
    eti: {
      employeeCount: 800,
      annualRevenue: 200_000_000,
      annualITBudget: 8_000_000,
      drBudgetPercent: 4,
      hourlyDowntimeCost: 50_000,
    },
    large: {
      employeeCount: 5_000,
      annualRevenue: 2_000_000_000,
      annualITBudget: 80_000_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 500_000,
    },
  },
  finance: {
    pme: {
      employeeCount: 25,
      annualRevenue: 8_000_000,
      annualITBudget: 600_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 5_000,
    },
    pme_plus: {
      employeeCount: 200,
      annualRevenue: 50_000_000,
      annualITBudget: 4_000_000,
      drBudgetPercent: 6,
      hourlyDowntimeCost: 40_000,
    },
    eti: {
      employeeCount: 1_000,
      annualRevenue: 500_000_000,
      annualITBudget: 40_000_000,
      drBudgetPercent: 6,
      hourlyDowntimeCost: 200_000,
    },
    large: {
      employeeCount: 8_000,
      annualRevenue: 5_000_000_000,
      annualITBudget: 400_000_000,
      drBudgetPercent: 7,
      hourlyDowntimeCost: 2_000_000,
    },
  },
  healthcare: {
    pme: {
      employeeCount: 40,
      annualRevenue: 4_000_000,
      annualITBudget: 200_000,
      drBudgetPercent: 4,
      hourlyDowntimeCost: 3_000,
    },
    pme_plus: {
      employeeCount: 200,
      annualRevenue: 25_000_000,
      annualITBudget: 1_500_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 20_000,
    },
    eti: {
      employeeCount: 1_200,
      annualRevenue: 300_000_000,
      annualITBudget: 18_000_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 100_000,
    },
    large: {
      employeeCount: 10_000,
      annualRevenue: 3_000_000_000,
      annualITBudget: 150_000_000,
      drBudgetPercent: 6,
      hourlyDowntimeCost: 1_000_000,
    },
  },
  manufacturing: {
    pme: {
      employeeCount: 50,
      annualRevenue: 6_000_000,
      annualITBudget: 200_000,
      drBudgetPercent: 3,
      hourlyDowntimeCost: 4_000,
    },
    pme_plus: {
      employeeCount: 250,
      annualRevenue: 40_000_000,
      annualITBudget: 1_200_000,
      drBudgetPercent: 3,
      hourlyDowntimeCost: 25_000,
    },
    eti: {
      employeeCount: 1_500,
      annualRevenue: 400_000_000,
      annualITBudget: 12_000_000,
      drBudgetPercent: 4,
      hourlyDowntimeCost: 150_000,
    },
    large: {
      employeeCount: 15_000,
      annualRevenue: 4_000_000_000,
      annualITBudget: 120_000_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 1_500_000,
    },
  },
  it_saas: {
    pme: {
      employeeCount: 20,
      annualRevenue: 3_000_000,
      annualITBudget: 450_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 3_000,
    },
    pme_plus: {
      employeeCount: 100,
      annualRevenue: 20_000_000,
      annualITBudget: 3_000_000,
      drBudgetPercent: 6,
      hourlyDowntimeCost: 25_000,
    },
    eti: {
      employeeCount: 600,
      annualRevenue: 150_000_000,
      annualITBudget: 22_000_000,
      drBudgetPercent: 6,
      hourlyDowntimeCost: 80_000,
    },
    large: {
      employeeCount: 4_000,
      annualRevenue: 1_000_000_000,
      annualITBudget: 150_000_000,
      drBudgetPercent: 7,
      hourlyDowntimeCost: 600_000,
    },
  },
  transport: {
    pme: {
      employeeCount: 40,
      annualRevenue: 5_000_000,
      annualITBudget: 175_000,
      drBudgetPercent: 3,
      hourlyDowntimeCost: 3_000,
    },
    pme_plus: {
      employeeCount: 200,
      annualRevenue: 35_000_000,
      annualITBudget: 1_000_000,
      drBudgetPercent: 4,
      hourlyDowntimeCost: 20_000,
    },
    eti: {
      employeeCount: 1_000,
      annualRevenue: 300_000_000,
      annualITBudget: 9_000_000,
      drBudgetPercent: 4,
      hourlyDowntimeCost: 100_000,
    },
    large: {
      employeeCount: 8_000,
      annualRevenue: 3_000_000_000,
      annualITBudget: 90_000_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 800_000,
    },
  },
  energy: {
    pme: {
      employeeCount: 30,
      annualRevenue: 10_000_000,
      annualITBudget: 400_000,
      drBudgetPercent: 4,
      hourlyDowntimeCost: 5_000,
    },
    pme_plus: {
      employeeCount: 150,
      annualRevenue: 60_000_000,
      annualITBudget: 2_400_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 30_000,
    },
    eti: {
      employeeCount: 800,
      annualRevenue: 500_000_000,
      annualITBudget: 20_000_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 200_000,
    },
    large: {
      employeeCount: 12_000,
      annualRevenue: 10_000_000_000,
      annualITBudget: 300_000_000,
      drBudgetPercent: 6,
      hourlyDowntimeCost: 2_000_000,
    },
  },
  public: {
    pme: {
      employeeCount: 30,
      annualRevenue: 2_000_000,
      annualITBudget: 150_000,
      drBudgetPercent: 3,
      hourlyDowntimeCost: 1_000,
    },
    pme_plus: {
      employeeCount: 200,
      annualRevenue: 15_000_000,
      annualITBudget: 1_000_000,
      drBudgetPercent: 4,
      hourlyDowntimeCost: 8_000,
    },
    eti: {
      employeeCount: 1_000,
      annualRevenue: 100_000_000,
      annualITBudget: 7_000_000,
      drBudgetPercent: 5,
      hourlyDowntimeCost: 50_000,
    },
    large: {
      employeeCount: 10_000,
      annualRevenue: 1_000_000_000,
      annualITBudget: 70_000_000,
      drBudgetPercent: 6,
      hourlyDowntimeCost: 300_000,
    },
  },
} as const;

const DEMO_SECTOR_KEY_SET = new Set<DemoSectorKey>(
  DEMO_SECTOR_DEFINITIONS.map((item) => item.key),
);
const DEMO_COMPANY_SIZE_KEY_SET = new Set<DemoCompanySizeKey>(
  DEMO_COMPANY_SIZE_DEFINITIONS.map((item) => item.key),
);

const DEMO_FINANCIAL_FIELDS: DemoFinancialFieldKey[] = [
  'employeeCount',
  'annualRevenue',
  'annualITBudget',
  'drBudgetPercent',
  'hourlyDowntimeCost',
];

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function mapSizeCategoryFromEmployees(employeeCount: number): string {
  if (employeeCount >= 5_000) return 'largeEnterprise';
  if (employeeCount >= 2_000) return 'enterprise';
  if (employeeCount >= 250) return 'midMarket';
  return 'smb';
}

export function isDemoSectorKey(value: unknown): value is DemoSectorKey {
  return typeof value === 'string' && DEMO_SECTOR_KEY_SET.has(value as DemoSectorKey);
}

export function isDemoCompanySizeKey(value: unknown): value is DemoCompanySizeKey {
  return typeof value === 'string' && DEMO_COMPANY_SIZE_KEY_SET.has(value as DemoCompanySizeKey);
}

export function getDemoProfileDefaults(
  sector: DemoSectorKey,
  companySize: DemoCompanySizeKey,
): DemoProfileFinancials {
  return { ...DEMO_PROFILE_MATRIX[sector][companySize] };
}

export function resolveDemoProfileSelection(
  input: DemoProfileSelectionInput = {},
): DemoProfileSelection {
  const sector = input.sector ?? DEFAULT_DEMO_PROFILE.sector;
  const companySize = input.companySize ?? DEFAULT_DEMO_PROFILE.companySize;

  const sectorDef =
    DEMO_SECTOR_DEFINITIONS.find((item) => item.key === sector) ??
    DEMO_SECTOR_DEFINITIONS[0];
  const sizeDef =
    DEMO_COMPANY_SIZE_DEFINITIONS.find((item) => item.key === companySize) ??
    DEMO_COMPANY_SIZE_DEFINITIONS[2];

  const defaults = getDemoProfileDefaults(sector, companySize);
  const values: DemoProfileFinancials = { ...defaults };
  const fieldSources: Record<DemoFinancialFieldKey, DemoProfileFieldSource> = {
    employeeCount: 'suggested',
    annualRevenue: 'suggested',
    annualITBudget: 'suggested',
    drBudgetPercent: 'suggested',
    hourlyDowntimeCost: 'suggested',
  };

  const overrides = input.financialOverrides ?? {};
  for (const field of DEMO_FINANCIAL_FIELDS) {
    const parsed = toPositiveNumber(overrides[field]);
    if (!parsed) continue;
    values[field] = parsed;
    fieldSources[field] = 'user_input';
  }

  const hasUserOverrides = Object.values(fieldSources).some((source) => source === 'user_input');
  const employeeCount = Math.max(1, Math.round(values.employeeCount));

  return {
    sector,
    sectorLabel: sectorDef?.label ?? sector,
    companySize,
    companySizeLabel: sizeDef?.label ?? companySize,
    verticalSector: sectorDef?.verticalSector ?? 'retail_ecommerce',
    industrySector: sectorDef?.industrySector ?? 'retail_ecommerce',
    financials: {
      employeeCount,
      annualRevenue: values.annualRevenue,
      annualITBudget: values.annualITBudget,
      drBudgetPercent: values.drBudgetPercent,
      hourlyDowntimeCost: values.hourlyDowntimeCost,
    },
    fieldSources,
    hasUserOverrides,
  };
}

export function deriveOrganizationSizeCategoryFromDemoProfile(
  selection: DemoProfileSelection,
): string {
  return mapSizeCategoryFromEmployees(selection.financials.employeeCount);
}

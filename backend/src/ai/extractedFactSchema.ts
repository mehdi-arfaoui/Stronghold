export const EXTRACTED_FACT_CATEGORIES = [
  "SERVICE",
  "INFRA",
  "RISK",
  "RTO_RPO",
  "SLA",
  "OTHER",
] as const;

export type ExtractedFactCategory = (typeof EXTRACTED_FACT_CATEGORIES)[number];

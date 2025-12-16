export const EXTRACTED_FACT_CATEGORIES = [
  "SERVICE",
  "INFRA",
  "RISK",
  "RTO_RPO",
  "OTHER",
] as const;

export type ExtractedFactCategory = (typeof EXTRACTED_FACT_CATEGORIES)[number];

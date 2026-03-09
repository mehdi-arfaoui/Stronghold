import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

export type JsonConfigValidationSummary = {
  frameworks: string[];
  pricingProviders: string[];
};

const FRAMEWORK_FILES = [
  { id: "iso22301", relativePath: "services/compliance/frameworks/iso22301.json" },
  { id: "nis2", relativePath: "services/compliance/frameworks/nis2.json" },
] as const;

const PRICING_FILES = [
  { provider: "aws", relativePath: "services/pricing/aws-prices.json" },
  { provider: "azure", relativePath: "services/pricing/azure-prices.json" },
  { provider: "gcp", relativePath: "services/pricing/gcp-prices.json" },
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveExistingPath(relativePath: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "src", relativePath),
    path.resolve(process.cwd(), "dist", relativePath),
    path.resolve(moduleDir, "..", relativePath),
    path.resolve(moduleDir, "..", "..", "src", relativePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`missing file (${relativePath})`);
}

function parseJsonFile(filePath: string, label: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "read_failed";
    throw new Error(`${label}: unreadable (${message})`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "parse_failed";
    throw new Error(`${label}: invalid JSON (${message})`);
  }
}

export function validateFrameworkDefinition(framework: unknown, label: string): void {
  if (!isRecord(framework)) {
    throw new Error(`${label}: root must be an object`);
  }

  const id = framework.id;
  const requirements = framework.requirements;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error(`${label}: missing non-empty id`);
  }
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new Error(`${label}: missing non-empty requirements array`);
  }

  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index];
    if (!isRecord(requirement)) {
      throw new Error(`${label}: requirements[${index}] must be an object`);
    }
    if (typeof requirement.id !== "string" || requirement.id.trim().length === 0) {
      throw new Error(`${label}: requirements[${index}].id is required`);
    }
    if (typeof requirement.check !== "string" || requirement.check.trim().length === 0) {
      throw new Error(`${label}: requirements[${index}].check is required`);
    }
    if (typeof requirement.weight !== "number" || !Number.isFinite(requirement.weight)) {
      throw new Error(`${label}: requirements[${index}].weight must be a finite number`);
    }
  }
}

export function validatePricingCatalog(catalog: unknown, label: string): void {
  if (!isRecord(catalog)) {
    throw new Error(`${label}: root must be an object`);
  }

  const meta = catalog._meta;
  const regions = catalog.regions;
  if (!isRecord(meta)) {
    throw new Error(`${label}: missing _meta object`);
  }
  if (!isRecord(regions) || Object.keys(regions).length === 0) {
    throw new Error(`${label}: missing non-empty regions object`);
  }

  for (const [region, regionTable] of Object.entries(regions)) {
    if (!isRecord(regionTable) || Object.keys(regionTable).length === 0) {
      throw new Error(`${label}: region "${region}" must define at least one category`);
    }
  }
}

export function validateCriticalJsonConfig(): JsonConfigValidationSummary {
  for (const frameworkFile of FRAMEWORK_FILES) {
    const filePath = resolveExistingPath(frameworkFile.relativePath);
    const parsed = parseJsonFile(filePath, `${frameworkFile.id}.json`);
    validateFrameworkDefinition(parsed, `${frameworkFile.id}.json`);
  }

  for (const pricingFile of PRICING_FILES) {
    const filePath = resolveExistingPath(pricingFile.relativePath);
    const parsed = parseJsonFile(filePath, `${pricingFile.provider}-prices.json`);
    validatePricingCatalog(parsed, `${pricingFile.provider}-prices.json`);
  }

  return {
    frameworks: FRAMEWORK_FILES.map((entry) => entry.id),
    pricingProviders: PRICING_FILES.map((entry) => entry.provider),
  };
}

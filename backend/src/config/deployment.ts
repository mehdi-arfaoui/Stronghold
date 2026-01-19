import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export type DeploymentMode = "saas" | "onpremise";

export type ResourceQuotas = {
  maxUsers: number;
  maxDocuments: number;
  maxStorageGb: number;
  maxRequestsPerMinute: number;
  maxRunbooksPerMonth: number;
};

export type MultiTenantConfig = {
  enabled: boolean;
  sharedDatabase: boolean;
  schemaPerTenant: boolean;
  schemaPrefix: string;
  strategy: "shared-db-schema-per-tenant" | "single-tenant";
  quotas: ResourceQuotas | null;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
};

const rawMode = String(process.env.DEPLOYMENT_MODE || "saas").toLowerCase();
export const deploymentMode: DeploymentMode = rawMode === "onpremise" ? "onpremise" : "saas";

const quotas: ResourceQuotas = {
  maxUsers: parsePositiveInt(process.env.TENANT_MAX_USERS, 50),
  maxDocuments: parsePositiveInt(process.env.TENANT_MAX_DOCUMENTS, 5000),
  maxStorageGb: parsePositiveInt(process.env.TENANT_MAX_STORAGE_GB, 200),
  maxRequestsPerMinute: parsePositiveInt(process.env.TENANT_MAX_RPM, 1200),
  maxRunbooksPerMonth: parsePositiveInt(process.env.TENANT_MAX_RUNBOOKS_PER_MONTH, 200),
};

const schemaPrefix = process.env.TENANT_SCHEMA_PREFIX || "tenant";

const multiTenantConfig: MultiTenantConfig = deploymentMode === "saas"
  ? {
      enabled: true,
      sharedDatabase: true,
      schemaPerTenant: true,
      schemaPrefix,
      strategy: "shared-db-schema-per-tenant",
      quotas,
    }
  : {
      enabled: false,
      sharedDatabase: false,
      schemaPerTenant: false,
      schemaPrefix,
      strategy: "single-tenant",
      quotas: null,
    };

const resolveLicensePath = (): string => {
  if (process.env.LICENSE_FILE_PATH) {
    return path.resolve(process.env.LICENSE_FILE_PATH);
  }

  const primary = path.resolve(process.cwd(), "config");
  const fallback = path.resolve(process.cwd(), "backend", "config");
  const baseDir = fs.existsSync(primary) ? primary : fallback;
  return path.join(baseDir, "license.json");
};

export const deploymentConfig = {
  mode: deploymentMode,
  multiTenant: multiTenantConfig,
  autoUpdateEnabled:
    deploymentMode === "saas"
      ? parseBoolean(process.env.AUTO_UPDATE_ENABLED, true)
      : false,
  license: {
    enabled: deploymentMode === "onpremise",
    filePath: resolveLicensePath(),
  },
};

export function buildTenantSchemaName(tenantId: string): string {
  const normalized = tenantId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `${multiTenantConfig.schemaPrefix}_${normalized || "tenant"}`;
}

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { deploymentConfig } from "../config/deployment.js";

export type LicenseFile = {
  licenseId: string;
  issuedAt: string;
  deploymentMode: "onpremise";
};

const isValidLicense = (data: unknown): data is LicenseFile => {
  if (!data || typeof data !== "object") return false;
  const record = data as LicenseFile;
  return (
    typeof record.licenseId === "string" &&
    typeof record.issuedAt === "string" &&
    record.deploymentMode === "onpremise"
  );
};

const ensureDirectory = (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

export function ensureOnPremiseLicense(): LicenseFile | null {
  if (!deploymentConfig.license.enabled) {
    return null;
  }

  const filePath = deploymentConfig.license.filePath;
  ensureDirectory(filePath);

  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (isValidLicense(data)) {
        return data;
      }
    } catch {
      // ignore malformed license and regenerate
    }
  }

  const license: LicenseFile = {
    licenseId: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    deploymentMode: "onpremise",
  };

  fs.writeFileSync(filePath, JSON.stringify(license, null, 2), "utf-8");
  return license;
}

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { deploymentConfig } = require("../config/deployment");

const isValidLicense = (data) => {
  if (!data || typeof data !== "object") return false;
  return (
    typeof data.licenseId === "string" &&
    typeof data.issuedAt === "string" &&
    data.deploymentMode === "onpremise"
  );
};

const ensureDirectory = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

function ensureOnPremiseLicense() {
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

  const license = {
    licenseId: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    deploymentMode: "onpremise",
  };

  fs.writeFileSync(filePath, JSON.stringify(license, null, 2), "utf-8");
  return license;
}

module.exports = {
  ensureOnPremiseLicense,
};

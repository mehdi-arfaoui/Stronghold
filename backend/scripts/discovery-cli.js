#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const API_URL = process.env.STRONGHOLD_API_URL || "http://localhost:4000";
const API_KEY = process.env.STRONGHOLD_API_KEY;

function parseArgs(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = args[i + 1];
    if (value && !value.startsWith("--")) {
      result[key] = value;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function usage() {
  console.log(`
Stronghold discovery CLI

Usage:
  node scripts/discovery-cli.js run --ip-ranges "10.0.0.0/24,10.0.1.0/24" --cloud "aws,azure"
  node scripts/discovery-cli.js import --file ./export.json

Env:
  STRONGHOLD_API_URL (default http://localhost:4000)
  STRONGHOLD_API_KEY (required)
`);
}

async function apiFetch(pathname, options = {}) {
  if (!API_KEY) {
    throw new Error("STRONGHOLD_API_KEY manquant");
  }
  const url = `${API_URL}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "x-api-key": API_KEY,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function runDiscovery(args) {
  const rangesRaw = args["ip-ranges"] || args["ipRanges"];
  if (!rangesRaw) {
    throw new Error("Veuillez fournir --ip-ranges");
  }
  const ipRanges = rangesRaw.split(",").map((entry) => entry.trim()).filter(Boolean);
  const cloudRaw = args["cloud"] || args["cloud-providers"];
  const cloudProviders = cloudRaw
    ? cloudRaw.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [];
  const payload = { ipRanges, cloudProviders };
  const result = await apiFetch("/discovery/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function importDiscovery(args) {
  const filePath = args.file;
  if (!filePath) {
    throw new Error("Veuillez fournir --file");
  }
  const resolved = path.resolve(process.cwd(), filePath);
  const buffer = fs.readFileSync(resolved);
  const form = new FormData();
  form.append("file", new Blob([buffer]), path.basename(resolved));
  const result = await apiFetch("/discovery/import", {
    method: "POST",
    body: form,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  if (command === "run") {
    await runDiscovery(args);
    return;
  }

  if (command === "import") {
    await importDiscovery(args);
    return;
  }

  console.error(`Commande inconnue: ${command}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

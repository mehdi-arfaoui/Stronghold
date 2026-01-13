#!/usr/bin/env node
const args = process.argv.slice(2);

function readArg(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
}

const backendUrl = readArg("--backend") || process.env.STRONGHOLD_BACKEND_URL;
const apiKey = readArg("--api-key") || process.env.STRONGHOLD_API_KEY;
const repoUrl = readArg("--repo");
const filePath = readArg("--file");
const ref = readArg("--ref") || "main";

if (!backendUrl || !apiKey || !repoUrl || !filePath) {
  console.error(
    "Usage: node backend/scripts/import-github-discovery.mjs --backend <url> --api-key <key> --repo <repoUrl> --file <path> [--ref <ref>]"
  );
  process.exit(1);
}

async function run() {
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/discovery/github-import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ repoUrl, filePath, ref }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Import GitHub échoué: ${response.status} - ${text}`);
    process.exit(1);
  }

  const result = await response.json();
  console.log("Import GitHub terminé:", JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error("Erreur lors de l'import GitHub:", error instanceof Error ? error.message : error);
  process.exit(1);
});

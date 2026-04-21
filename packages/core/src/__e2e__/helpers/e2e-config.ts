import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface E2EConfig {
  readonly configPath: string;
  readonly prodAccountId: string;
  readonly stagingAccountId: string;
  readonly region: string;
  readonly prodProfile: string;
  readonly stagingProfile: string;
}

/**
 * Loads the E2E configuration from environment variables.
 * Returns null when STRONGHOLD_E2E is not explicitly enabled.
 */
export function getE2EConfig(): E2EConfig | null {
  if (process.env.STRONGHOLD_E2E !== 'true') {
    return null;
  }

  const prodAccountId = process.env.STRONGHOLD_E2E_PROD_ACCOUNT;
  const stagingAccountId = process.env.STRONGHOLD_E2E_STAGING_ACCOUNT;

  if (!prodAccountId || !stagingAccountId) {
    throw new Error(
      'STRONGHOLD_E2E=true but STRONGHOLD_E2E_PROD_ACCOUNT or STRONGHOLD_E2E_STAGING_ACCOUNT is missing.',
    );
  }

  return {
    configPath: resolveE2EConfigPath(),
    prodAccountId,
    stagingAccountId,
    region: process.env.STRONGHOLD_E2E_REGION ?? 'eu-west-3',
    prodProfile: process.env.STRONGHOLD_E2E_PROD_PROFILE ?? 'stronghold-test-prod',
    stagingProfile: process.env.STRONGHOLD_E2E_STAGING_PROFILE ?? 'stronghold-test-staging',
  };
}

function resolveE2EConfigPath(): string {
  const explicit = process.env.STRONGHOLD_E2E_CONFIG;
  if (explicit) {
    return path.resolve(explicit);
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirectory = path.dirname(currentFilePath);
  const repositoryRoot = path.resolve(currentDirectory, '../../../../../');
  const candidates = [
    path.resolve(repositoryRoot, 'infra/test-multi-account/stronghold-test-config.yml'),
    path.resolve(repositoryRoot, '.stronghold/config.yml'),
  ];

  const existingCandidate = candidates.find((candidate) => fs.existsSync(candidate));
  return existingCandidate ?? candidates[0];
}

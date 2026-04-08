import fs from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import {
  DEFAULT_STRONGHOLD_CONFIG_PATH,
  STRONGHOLD_CONFIG_VERSION,
  type StrongholdAccountConfig,
  type StrongholdConfig,
  type StrongholdConfigDefaults,
} from './config-types.js';

type ConfigRecord = Record<string, unknown>;

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
  'access_key_id',
  'secret_access_key',
  'session_token',
  'credentials',
]);

export class StrongholdConfigValidationError extends Error {
  public readonly filePath: string;
  public readonly issues: readonly string[];

  public constructor(filePath: string, issues: readonly string[]) {
    super(`Invalid Stronghold config at ${filePath}:\n- ${issues.join('\n- ')}`);
    this.name = 'StrongholdConfigValidationError';
    this.filePath = filePath;
    this.issues = issues;
  }
}

export function loadStrongholdConfig(
  filePath = DEFAULT_STRONGHOLD_CONFIG_PATH,
): StrongholdConfig | null {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  const contents = fs.readFileSync(resolvedPath, 'utf8');
  return parseStrongholdConfig(contents, resolvedPath);
}

export function parseStrongholdConfig(
  contents: string,
  filePath = DEFAULT_STRONGHOLD_CONFIG_PATH,
): StrongholdConfig {
  const document = parseDocument(contents);
  if (document.errors.length > 0) {
    throw new StrongholdConfigValidationError(
      filePath,
      document.errors.map((error) => error.message),
    );
  }

  return validateStrongholdConfig(document.toJSON() as unknown, filePath);
}

export function validateStrongholdConfig(
  value: unknown,
  filePath = DEFAULT_STRONGHOLD_CONFIG_PATH,
): StrongholdConfig {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new StrongholdConfigValidationError(filePath, ['Config file must contain a YAML object.']);
  }

  const version = readInteger(value.version);
  if (version !== STRONGHOLD_CONFIG_VERSION) {
    issues.push(
      `version must be ${STRONGHOLD_CONFIG_VERSION}. Received ${String(value.version ?? 'undefined')}.`,
    );
  }

  const defaults = value.defaults == null ? undefined : readDefaults(value.defaults, 'defaults', issues);
  const accounts = value.accounts == null ? undefined : readAccounts(value.accounts, 'accounts', issues);

  if (issues.length > 0) {
    throw new StrongholdConfigValidationError(filePath, issues);
  }

  return {
    version: STRONGHOLD_CONFIG_VERSION,
    ...(defaults ? { defaults } : {}),
    ...(accounts ? { accounts } : {}),
  };
}

function readDefaults(
  value: unknown,
  pathLabel: string,
  issues: string[],
): StrongholdConfigDefaults | undefined {
  if (!isRecord(value)) {
    issues.push(`${pathLabel} must be an object.`);
    return undefined;
  }

  rejectCredentialKeys(value, pathLabel, issues);

  const regions = readStringArray(value.regions, `${pathLabel}.regions`, issues);
  const allRegions = readOptionalBoolean(
    value.all_regions ?? value.allRegions,
    `${pathLabel}.all_regions`,
    issues,
  );
  const concurrency = readOptionalInteger(value.concurrency, 1, 16, `${pathLabel}.concurrency`, issues);
  const scannerTimeout = readOptionalInteger(
    value.scanner_timeout ?? value.scannerTimeout,
    10,
    300,
    `${pathLabel}.scanner_timeout`,
    issues,
  );

  return {
    ...(regions ? { regions } : {}),
    ...(allRegions !== undefined ? { allRegions } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(scannerTimeout !== undefined ? { scannerTimeout } : {}),
  };
}

function readAccounts(
  value: unknown,
  pathLabel: string,
  issues: string[],
): Readonly<Record<string, StrongholdAccountConfig>> | undefined {
  if (!isRecord(value)) {
    issues.push(`${pathLabel} must be an object keyed by account name.`);
    return undefined;
  }

  const accounts: Record<string, StrongholdAccountConfig> = {};

  for (const [accountName, accountValue] of Object.entries(value)) {
    if (!isRecord(accountValue)) {
      issues.push(`${pathLabel}.${accountName} must be an object.`);
      continue;
    }

    rejectCredentialKeys(accountValue, `${pathLabel}.${accountName}`, issues);

    const profile = readOptionalString(accountValue.profile);
    const roleArn = readOptionalString(accountValue.role_arn ?? accountValue.roleArn);
    const externalId = readOptionalString(accountValue.external_id ?? accountValue.externalId);
    const regions = readStringArray(
      accountValue.regions,
      `${pathLabel}.${accountName}.regions`,
      issues,
    );
    const allRegions = readOptionalBoolean(
      accountValue.all_regions ?? accountValue.allRegions,
      `${pathLabel}.${accountName}.all_regions`,
      issues,
    );

    accounts[accountName] = {
      ...(profile ? { profile } : {}),
      ...(roleArn ? { roleArn } : {}),
      ...(externalId ? { externalId } : {}),
      ...(regions ? { regions } : {}),
      ...(allRegions !== undefined ? { allRegions } : {}),
    };
  }

  return accounts;
}

function rejectCredentialKeys(value: ConfigRecord, pathLabel: string, issues: string[]): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_CREDENTIAL_KEYS.has(key)) {
      issues.push(`${pathLabel}.${key} is not allowed. Store account selection only, never credentials.`);
    }
  }
}

function readOptionalInteger(
  value: unknown,
  min: number,
  max: number,
  pathLabel: string,
  issues: string[],
): number | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    issues.push(`${pathLabel} must be an integer between ${min} and ${max}.`);
    return undefined;
  }

  return value;
}

function readOptionalBoolean(
  value: unknown,
  pathLabel: string,
  issues: string[],
): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    issues.push(`${pathLabel} must be a boolean.`);
    return undefined;
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringArray(
  value: unknown,
  pathLabel: string,
  issues: string[],
): readonly string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push(`${pathLabel} must be an array of strings.`);
    return undefined;
  }

  const entries = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);

  if (entries.length !== value.length) {
    issues.push(`${pathLabel} must contain only non-empty strings.`);
    return undefined;
  }

  return entries;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function isRecord(value: unknown): value is ConfigRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

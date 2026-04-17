import fs from 'node:fs';
import path from 'node:path';

import Ajv, { type ErrorObject } from 'ajv';
import { parseDocument } from 'yaml';

import {
  DEFAULT_STRONGHOLD_CONFIG_PATH,
  STRONGHOLD_CONFIG_VERSION,
  type StrongholdConfig,
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

const KEY_ALIASES = new Map([
  ['all_regions', 'allRegions'],
  ['account_concurrency', 'accountConcurrency'],
  ['scanner_timeout', 'scannerTimeout'],
  ['scan_timeout_ms', 'scanTimeoutMs'],
  ['role_arn', 'roleArn'],
  ['external_id', 'externalId'],
  ['account_id', 'accountId'],
  ['profile_name', 'profileName'],
  ['session_name', 'sessionName'],
  ['role_name', 'roleName'],
  ['sso_profile_name', 'ssoProfileName'],
]);

const CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: {
      type: 'integer',
      const: STRONGHOLD_CONFIG_VERSION,
    },
    defaults: {
      type: 'object',
      additionalProperties: false,
      properties: {
        regions: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        allRegions: { type: 'boolean' },
        concurrency: { type: 'integer', minimum: 1, maximum: 16 },
        accountConcurrency: { type: 'integer', minimum: 1, maximum: 16 },
        scannerTimeout: { type: 'integer', minimum: 10, maximum: 300 },
        scanTimeoutMs: { type: 'integer', minimum: 1_000 },
      },
    },
    accounts: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          profile: { type: 'string', minLength: 1 },
          roleArn: { type: 'string', minLength: 1 },
          externalId: { type: 'string', minLength: 1 },
          regions: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
          allRegions: { type: 'boolean' },
          scanTimeoutMs: { type: 'integer', minimum: 1_000 },
        },
      },
    },
    aws: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profile: { type: 'string', minLength: 1 },
        region: { type: 'string', minLength: 1 },
        accounts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['accountId'],
            properties: {
              accountId: {
                type: 'string',
                pattern: '^\\d{12}$',
              },
              alias: { type: 'string', minLength: 1 },
              partition: {
                type: 'string',
                enum: ['aws', 'aws-cn', 'aws-us-gov'],
              },
              region: { type: 'string', minLength: 1 },
              regions: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
              },
              allRegions: { type: 'boolean' },
              scanTimeoutMs: { type: 'integer', minimum: 1_000 },
              auth: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'profileName'],
                    properties: {
                      kind: { const: 'profile' },
                      profileName: { type: 'string', minLength: 1 },
                    },
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind'],
                    properties: {
                      kind: { const: 'assume-role' },
                      roleArn: { type: 'string', minLength: 1 },
                      sessionName: { type: 'string', minLength: 1 },
                      externalId: { type: 'string', minLength: 1 },
                    },
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'ssoProfileName', 'roleName'],
                    properties: {
                      kind: { const: 'sso' },
                      ssoProfileName: { type: 'string', minLength: 1 },
                      roleName: { type: 'string', minLength: 1 },
                      accountId: {
                        type: 'string',
                        pattern: '^\\d{12}$',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});
const validateConfigDocument = ajv.compile<StrongholdConfig>(CONFIG_SCHEMA);

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
  if (!isRecord(value)) {
    throw new StrongholdConfigValidationError(filePath, ['Config file must contain a YAML object.']);
  }

  const normalized = normalizeConfigValue(value);
  if (!validateConfigDocument(normalized)) {
    throw new StrongholdConfigValidationError(
      filePath,
      formatSchemaErrors(validateConfigDocument.errors ?? []),
    );
  }

  const config = normalized as StrongholdConfig;
  return {
    version: STRONGHOLD_CONFIG_VERSION,
    ...(config.defaults ? { defaults: config.defaults } : {}),
    ...(config.accounts ? { accounts: config.accounts } : {}),
    ...(config.aws ? { aws: config.aws } : {}),
  };
}

function isRecord(value: unknown): value is ConfigRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeConfigValue(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalized: ConfigRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = KEY_ALIASES.get(key) ?? key;
    normalized[normalizedKey] = normalizeConfigValue(entry);
  }

  return normalized;
}

function formatSchemaErrors(errors: readonly ErrorObject[]): readonly string[] {
  const issues = errors
    .filter((error) => error.keyword !== 'if')
    .map((error) => formatSchemaError(error));

  return Array.from(new Set(issues));
}

function formatSchemaError(error: ErrorObject): string {
  const basePath = toPathLabel(error.instancePath);

  if (error.keyword === 'additionalProperties') {
    const additionalProperty = String((error.params as { additionalProperty: string }).additionalProperty);
    const pathLabel = basePath ? `${basePath}.${additionalProperty}` : additionalProperty;
    if (FORBIDDEN_CREDENTIAL_KEYS.has(additionalProperty)) {
      return `${pathLabel} is not allowed. Store account selection only, never credentials.`;
    }
    return `${pathLabel} is not allowed.`;
  }

  if (error.keyword === 'required') {
    const missingProperty = String((error.params as { missingProperty: string }).missingProperty);
    const pathLabel = basePath ? `${basePath}.${missingProperty}` : missingProperty;
    return `${pathLabel} is required.`;
  }

  const pathLabel = basePath || 'config';
  return `${pathLabel} ${error.message ?? 'is invalid.'}`;
}

function toPathLabel(instancePath: string): string {
  if (!instancePath) {
    return '';
  }

  return instancePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => (/^\d+$/u.test(segment) ? `[${segment}]` : segment))
    .reduce((result, segment) => {
      if (segment.startsWith('[')) {
        return `${result}${segment}`;
      }
      return result ? `${result}.${segment}` : segment;
    }, '');
}

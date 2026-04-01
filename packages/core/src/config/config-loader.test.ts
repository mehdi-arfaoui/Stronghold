import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  StrongholdConfigValidationError,
  loadStrongholdConfig,
  parseStrongholdConfig,
} from './config-loader.js';

describe('loadStrongholdConfig', () => {
  it('returns null when the config file does not exist', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-config-'));

    expect(loadStrongholdConfig(path.join(directory, 'missing.yml'))).toBeNull();
  });
});

describe('parseStrongholdConfig', () => {
  it('parses a valid complete config', () => {
    const config = parseStrongholdConfig(`
version: 1
defaults:
  regions:
    - eu-west-1
    - us-east-1
  concurrency: 7
  scanner_timeout: 90
accounts:
  production:
    profile: production
    role_arn: arn:aws:iam::123456789012:role/StrongholdReadOnly
    external_id: ext-123
    regions:
      - eu-west-1
`);

    expect(config.defaults).toEqual({
      regions: ['eu-west-1', 'us-east-1'],
      concurrency: 7,
      scannerTimeout: 90,
    });
    expect(config.accounts?.production).toEqual({
      profile: 'production',
      roleArn: 'arn:aws:iam::123456789012:role/StrongholdReadOnly',
      externalId: 'ext-123',
      regions: ['eu-west-1'],
    });
  });

  it('parses a valid minimal config', () => {
    const config = parseStrongholdConfig(`
version: 1
accounts:
  sandbox:
    profile: sandbox
`);

    expect(config.accounts?.sandbox).toEqual({
      profile: 'sandbox',
    });
  });

  it('rejects an invalid version', () => {
    expect(() => parseStrongholdConfig('version: 2')).toThrow(StrongholdConfigValidationError);
  });

  it('rejects credential fields', () => {
    expect(() =>
      parseStrongholdConfig(`
version: 1
accounts:
  prod:
    access_key_id: AKIA_NOT_ALLOWED
`),
    ).toThrow(/not allowed/);
  });
});

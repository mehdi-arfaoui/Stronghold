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
  all_regions: false
  concurrency: 7
  account_concurrency: 4
  scanner_timeout: 90
  scan_timeout_ms: 900000
accounts:
  production:
    profile: production
    role_arn: arn:aws:iam::123456789012:role/StrongholdReadOnly
    external_id: ext-123
    regions:
      - eu-west-1
    all_regions: false
    scan_timeout_ms: 1200000
`);

    expect(config.defaults).toEqual({
      regions: ['eu-west-1', 'us-east-1'],
      allRegions: false,
      concurrency: 7,
      accountConcurrency: 4,
      scannerTimeout: 90,
      scanTimeoutMs: 900000,
    });
    expect(config.accounts?.production).toEqual({
      profile: 'production',
      roleArn: 'arn:aws:iam::123456789012:role/StrongholdReadOnly',
      externalId: 'ext-123',
      regions: ['eu-west-1'],
      allRegions: false,
      scanTimeoutMs: 1200000,
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

  it('parses all-regions flags when present', () => {
    const config = parseStrongholdConfig(`
version: 1
defaults:
  all_regions: true
accounts:
  default:
    profile: production
    all_regions: true
`);

    expect(config.defaults?.allRegions).toBe(true);
    expect(config.accounts?.default?.allRegions).toBe(true);
  });

  it('parses the new aws config schema', () => {
    const config = parseStrongholdConfig(`
aws:
  profile: management
  region: eu-west-3
  accounts:
    - account_id: "111122223333"
      alias: prod
      scan_timeout_ms: 600000
      auth:
        kind: profile
        profile_name: prod-profile
    - account_id: "777788889999"
      alias: data
      region: us-east-1
      auth:
        kind: sso
        sso_profile_name: corp-sso
        role_name: ReadOnlyAccess
`);

    expect(config).toMatchObject({
      version: 1,
      aws: {
        profile: 'management',
        region: 'eu-west-3',
        accounts: [
          {
            accountId: '111122223333',
            alias: 'prod',
            scanTimeoutMs: 600000,
            auth: {
              kind: 'profile',
              profileName: 'prod-profile',
            },
          },
          {
            accountId: '777788889999',
            alias: 'data',
            region: 'us-east-1',
            auth: {
              kind: 'sso',
              ssoProfileName: 'corp-sso',
              roleName: 'ReadOnlyAccess',
            },
          },
        ],
      },
    });
  });

  it('defaults the version when omitted', () => {
    const config = parseStrongholdConfig(`
aws:
  profile: production
  region: eu-west-3
`);

    expect(config.version).toBe(1);
    expect(config.aws).toEqual({
      profile: 'production',
      region: 'eu-west-3',
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

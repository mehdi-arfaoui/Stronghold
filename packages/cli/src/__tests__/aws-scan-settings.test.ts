import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../errors/cli-error.js';
import { resolveAwsScanSettings } from '../config/aws-scan-settings.js';
import type { ScanCommandOptions } from '../config/options.js';

function createOptions(
  overrides: Partial<ScanCommandOptions> = {},
): ScanCommandOptions {
  return {
    provider: 'aws',
    allRegions: false,
    output: 'summary',
    save: true,
    verbose: false,
    ...overrides,
  };
}

describe('resolveAwsScanSettings', () => {
  it('applies CLI flags over account config, config defaults, and hardcoded defaults', () => {
    const settings = resolveAwsScanSettings(
      createOptions({
        account: 'production',
        profile: 'cli-profile',
        roleArn: 'arn:aws:iam::111122223333:role/CliRole',
        externalId: 'cli-external-id',
        region: ['us-east-1'],
        concurrency: 9,
        scannerTimeout: 120,
      }),
      {
        config: {
          version: 1,
          defaults: {
            regions: ['eu-west-1'],
            concurrency: 6,
            scannerTimeout: 75,
          },
          accounts: {
            production: {
              profile: 'account-profile',
              roleArn: 'arn:aws:iam::111122223333:role/AccountRole',
              externalId: 'account-external-id',
              regions: ['ap-southeast-1'],
            },
          },
        },
      },
    );

    expect(settings).toEqual({
      allRegions: false,
      explicitRegions: ['us-east-1'],
      accountName: 'production',
      profile: 'cli-profile',
      roleArn: 'arn:aws:iam::111122223333:role/CliRole',
      externalId: 'cli-external-id',
      concurrency: 9,
      scannerTimeout: 120,
    });
  });

  it('uses account and default config values when CLI flags are absent', () => {
    const settings = resolveAwsScanSettings(
      createOptions({
        account: 'sandbox',
      }),
      {
        config: {
          version: 1,
          defaults: {
            regions: ['eu-central-1'],
            concurrency: 7,
            scannerTimeout: 90,
          },
          accounts: {
            sandbox: {
              profile: 'sandbox',
              regions: ['eu-west-1'],
            },
          },
        },
      },
    );

    expect(settings).toEqual({
      allRegions: false,
      explicitRegions: ['eu-west-1'],
      accountName: 'sandbox',
      profile: 'sandbox',
      concurrency: 7,
      scannerTimeout: 90,
    });
  });

  it('keeps explicit CLI regions over account config regions', () => {
    const settings = resolveAwsScanSettings(
      createOptions({
        account: 'production',
        region: ['us-west-2'],
      }),
      {
        config: {
          version: 1,
          accounts: {
            production: {
              profile: 'production',
              regions: ['eu-west-1'],
            },
          },
        },
      },
    );

    expect(settings.explicitRegions).toEqual(['us-west-2']);
  });

  it('falls back to hardcoded defaults when no config values are provided', () => {
    const settings = resolveAwsScanSettings(createOptions(), {
      config: {
        version: 1,
      },
    });

    expect(settings.concurrency).toBe(5);
    expect(settings.scannerTimeout).toBe(60);
  });

  it('uses the default account config automatically when present', () => {
    const settings = resolveAwsScanSettings(createOptions(), {
      config: {
        version: 1,
        defaults: {
          regions: ['eu-central-1'],
        },
        accounts: {
          default: {
            profile: 'production',
            regions: ['eu-west-1'],
          },
        },
      },
    });

    expect(settings).toEqual({
      allRegions: false,
      explicitRegions: ['eu-west-1'],
      accountName: 'default',
      profile: 'production',
      concurrency: 5,
      scannerTimeout: 60,
    });
  });

  it('uses all_regions from config when no explicit region is provided', () => {
    const settings = resolveAwsScanSettings(
      createOptions(),
      {
        config: {
          version: 1,
          defaults: {
            allRegions: true,
          },
        },
      },
    );

    expect(settings).toEqual({
      allRegions: true,
      concurrency: 5,
      scannerTimeout: 60,
    });
  });

  it('rejects account selection when the config file is missing', () => {
    expect(() =>
      resolveAwsScanSettings(createOptions({ account: 'production' }), { config: null }),
    ).toThrow(ConfigurationError);
  });
});

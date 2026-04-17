import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SsoAuthProvider } from './sso-auth-provider.js';

const SSO_TARGET = {
  accountId: '777788889999',
  partition: 'aws',
  region: 'us-east-1',
  hint: {
    kind: 'sso',
    ssoProfileName: 'corp-sso',
    accountId: '777788889999',
    roleName: 'ReadOnlyAccess',
  },
} as const;

describe('SsoAuthProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns credentials when the SSO cache is valid', async () => {
    const homeDirectory = createAwsHome({
      config: [
        '[profile corp-sso]',
        'sso_session = corp',
        'sso_account_id = 777788889999',
        'sso_role_name = ReadOnlyAccess',
        '',
        '[sso-session corp]',
        'sso_start_url = https://stronghold.awsapps.com/start',
        'sso_region = eu-west-1',
      ].join('\n'),
      cache: [
        {
          startUrl: 'https://stronghold.awsapps.com/start',
          expiresAt: '2099-04-16T12:00:00.000Z',
        },
      ],
    });
    vi.spyOn(os, 'homedir').mockReturnValue(homeDirectory);
    const provider = new SsoAuthProvider({
      fromSsoFactory: vi.fn().mockReturnValue(
        vi.fn().mockResolvedValue({
          accessKeyId: 'ASIA_SSO',
          secretAccessKey: 'secret',
          sessionToken: 'token',
          expiration: new Date('2099-04-16T11:00:00.000Z'),
        }) as never,
      ),
    });

    await expect(provider.canHandle(SSO_TARGET)).resolves.toBe(true);
    await expect(provider.getCredentials(SSO_TARGET)).resolves.toMatchObject({
      accessKeyId: 'ASIA_SSO',
      sessionToken: 'token',
    });
  });

  it('returns false when the SSO cache is expired', async () => {
    const homeDirectory = createAwsHome({
      config: [
        '[profile corp-sso]',
        'sso_start_url = https://stronghold.awsapps.com/start',
        'sso_region = eu-west-1',
        'sso_account_id = 777788889999',
        'sso_role_name = ReadOnlyAccess',
      ].join('\n'),
      cache: [
        {
          startUrl: 'https://stronghold.awsapps.com/start',
          expiresAt: '2000-04-16T08:00:00.000Z',
        },
      ],
    });
    vi.spyOn(os, 'homedir').mockReturnValue(homeDirectory);

    const provider = new SsoAuthProvider();

    await expect(provider.canHandle(SSO_TARGET)).resolves.toBe(false);
  });

  it('returns false when no SSO profile is configured for the account', async () => {
    const homeDirectory = createAwsHome({
      config: '',
      cache: [],
    });
    vi.spyOn(os, 'homedir').mockReturnValue(homeDirectory);

    const provider = new SsoAuthProvider();

    await expect(provider.canHandle(SSO_TARGET)).resolves.toBe(false);
  });
});

function createAwsHome(input: {
  readonly config: string;
  readonly cache: readonly Record<string, unknown>[];
}): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-sso-'));
  const awsDirectory = path.join(directory, '.aws');
  const cacheDirectory = path.join(awsDirectory, 'sso', 'cache');
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(path.join(awsDirectory, 'config'), input.config, 'utf8');
  input.cache.forEach((entry, index) => {
    fs.writeFileSync(
      path.join(cacheDirectory, `cache-${index}.json`),
      JSON.stringify(entry, null, 2),
      'utf8',
    );
  });
  return directory;
}

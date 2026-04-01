import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assumeAwsRole,
  buildAssumeRoleSessionName,
  DEFAULT_ASSUME_ROLE_SESSION_DURATION_SECONDS,
} from './assume-role.js';

describe('assumeAwsRole', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns temporary credentials from STS', async () => {
    const send = vi
      .spyOn(STSClient.prototype, 'send')
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'ASIA_TEST',
          SecretAccessKey: 'secret',
          SessionToken: 'token',
        },
      });

    await expect(
      assumeAwsRole({
        region: 'eu-west-1',
        roleArn: 'arn:aws:iam::123456789012:role/StrongholdReadOnly',
        externalId: 'ext-123',
        sessionName: 'stronghold-scan-test',
      }),
    ).resolves.toEqual({
      accessKeyId: 'ASIA_TEST',
      secretAccessKey: 'secret',
      sessionToken: 'token',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(AssumeRoleCommand);
    expect((command as AssumeRoleCommand).input).toMatchObject({
      RoleArn: 'arn:aws:iam::123456789012:role/StrongholdReadOnly',
      RoleSessionName: 'stronghold-scan-test',
      DurationSeconds: DEFAULT_ASSUME_ROLE_SESSION_DURATION_SECONDS,
      ExternalId: 'ext-123',
    });
  });

  it('fails when STS does not return credentials', async () => {
    vi.spyOn(STSClient.prototype, 'send').mockResolvedValueOnce({});

    await expect(
      assumeAwsRole({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/StrongholdReadOnly',
      }),
    ).rejects.toThrow(/did not return temporary credentials/i);
  });
});

describe('buildAssumeRoleSessionName', () => {
  it('creates a stable, AWS-compatible session name', () => {
    expect(buildAssumeRoleSessionName(new Date('2026-04-01T18:45:30.000Z'))).toBe(
      'stronghold-scan-20260401T184530Z',
    );
  });
});

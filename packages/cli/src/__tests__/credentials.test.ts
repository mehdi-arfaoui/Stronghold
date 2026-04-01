import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

import {
  buildDiscoveryCredentials,
  resolveAwsExecutionContext,
  resolveAwsRegions,
  verifyAwsCredentials,
} from '../config/credentials.js';

describe('credentials', () => {
  afterEach(() => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_REGION;
    delete process.env.AWS_PROFILE;
    vi.restoreAllMocks();
  });

  it('detects credentials from environment variables', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    process.env.AWS_SESSION_TOKEN = 'token';

    expect(buildDiscoveryCredentials().aws).toEqual({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
      sessionToken: 'token',
    });
  });

  it('builds profile-based discovery credentials without copying environment secrets', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_ENV';
    process.env.AWS_SECRET_ACCESS_KEY = 'env-secret';

    expect(
      buildDiscoveryCredentials({
        profile: 'production',
        region: 'eu-west-1',
        includeEnvironmentCredentials: false,
      }).aws,
    ).toEqual({
      profile: 'production',
      region: 'eu-west-1',
    });
  });

  it('returns a clear error when no credentials are available', async () => {
    vi.spyOn(STSClient.prototype, 'send').mockRejectedValueOnce(new Error('No providers'));

    await expect(verifyAwsCredentials()).rejects.toThrow(/No AWS credentials found/);
  });

  it('returns a clear error when a selected profile is unavailable', async () => {
    vi.spyOn(STSClient.prototype, 'send').mockRejectedValueOnce(
      new Error('Could not resolve credentials using profile: nonexistent'),
    );

    await expect(verifyAwsCredentials({ profile: 'nonexistent' }, { profile: 'nonexistent' })).rejects.toThrow(
      /profile 'nonexistent'/i,
    );
  });

  it('detects the region from environment variables', async () => {
    process.env.AWS_DEFAULT_REGION = 'eu-west-1';

    await expect(resolveAwsRegions({ allRegions: false })).resolves.toEqual(['eu-west-1']);
  });

  it('returns a clear error when no region is configured', async () => {
    await expect(resolveAwsRegions({ allRegions: false })).rejects.toThrow(/No AWS region specified/);
  });

  it('parses multiple regions from explicit input', async () => {
    await expect(
      resolveAwsRegions({
        explicitRegions: ['eu-west-1', 'us-east-1'],
        allRegions: false,
      }),
    ).resolves.toEqual(['eu-west-1', 'us-east-1']);
  });

  it('resolves assume-role execution context with profile metadata', async () => {
    const send = vi.spyOn(STSClient.prototype, 'send');
    send
      .mockImplementationOnce(async (command) => {
        expect(command).toBeInstanceOf(AssumeRoleCommand);
        return {
          Credentials: {
            AccessKeyId: 'ASIA_TEST',
            SecretAccessKey: 'secret',
            SessionToken: 'token',
          },
        };
      })
      .mockImplementationOnce(async (command) => {
        expect(command).toBeInstanceOf(GetCallerIdentityCommand);
        return {
          Account: '123456789012',
          Arn: 'arn:aws:sts::123456789012:assumed-role/StrongholdReadOnly/session',
          UserId: 'AROATEST:session',
        };
      });

    const context = await resolveAwsExecutionContext({
      profile: 'production',
      roleArn: 'arn:aws:iam::123456789012:role/StrongholdReadOnly',
      externalId: 'ext-123',
      explicitRegions: ['eu-west-1'],
      allRegions: false,
      accountName: 'production',
    });

    expect(context).toMatchObject({
      regions: ['eu-west-1'],
      authMode: 'profile+assume-role',
      profile: 'production',
      roleArn: 'arn:aws:iam::123456789012:role/StrongholdReadOnly',
      accountName: 'production',
    });
    expect(context.credentials.aws).toMatchObject({
      accessKeyId: 'ASIA_TEST',
      secretAccessKey: 'secret',
      sessionToken: 'token',
    });
  });

  it('surfaces assume-role failures clearly', async () => {
    vi.spyOn(STSClient.prototype, 'send').mockRejectedValueOnce(
      Object.assign(new Error('Access denied'), {
        name: 'AccessDeniedException',
      }),
    );

    await expect(
      resolveAwsExecutionContext({
        roleArn: 'arn:aws:iam::123456789012:role/StrongholdReadOnly',
        explicitRegions: ['eu-west-1'],
        allRegions: false,
      }),
    ).rejects.toThrow(/Unable to assume role .* access denied/i);
  });
});

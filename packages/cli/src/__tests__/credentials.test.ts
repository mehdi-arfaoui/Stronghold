import { afterEach, describe, expect, it, vi } from 'vitest';
import { STSClient } from '@aws-sdk/client-sts';

import {
  buildDiscoveryCredentials,
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

  it('returns a clear error when no credentials are available', async () => {
    vi.spyOn(STSClient.prototype, 'send').mockRejectedValueOnce(new Error('No providers'));

    await expect(verifyAwsCredentials()).rejects.toThrow(/No AWS credentials found/);
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
});

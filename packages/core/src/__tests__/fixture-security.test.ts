import { describe, expect, it } from 'vitest';

import {
  detectFixtureLeaks,
  sanitizeFixtureValue,
} from '../__fixtures__/fixture-security.js';

describe('fixture security', () => {
  it('sanitizes bucket identifiers, KMS identifiers, emails, hosts, and IPs consistently', () => {
    const raw = {
      type: 'OBJECT_STORAGE',
      name: 'customer-data-archive',
      arn: 'arn:aws:s3:::customer-data-archive',
      metadata: {
        sourceType: 'S3_BUCKET',
        bucketName: 'customer-data-archive',
        bucketArn: 'arn:aws:s3:::customer-data-archive',
        kmsKeyId: 'arn:aws:kms:eu-west-1:123456789012:key/123e4567-e89b-12d3-a456-426614174000',
        contactEmail: 'ops-team@example.com',
        endpoint: 'https://vault.platform.internal/health',
        privateIp: '10.10.10.5',
      },
    };

    const sanitized = sanitizeFixtureValue(raw);

    expect(sanitized.name).toMatch(/^sh-bucket-/);
    expect(sanitized.arn).toContain('arn:aws:s3:::sh-bucket-');
    expect(sanitized.metadata.bucketName).toBe(sanitized.name);
    expect(sanitized.metadata.bucketArn).toBe(sanitized.arn);
    expect(sanitized.metadata.kmsKeyId).toContain('arn:aws:kms:eu-west-1:****9012:key/sh-kms-');
    expect(sanitized.metadata.contactEmail).toMatch(/^sh-user-[a-f0-9]+@example\.invalid$/);
    expect(sanitized.metadata.endpoint).toContain('https://sh-host-');
    expect(sanitized.metadata.endpoint).toContain('.example.internal/health');
    expect(sanitized.metadata.privateIp).toBe('10.***.***.**');
    expect(sanitizeFixtureValue(sanitized)).toEqual(sanitized);
    expect(detectFixtureLeaks(sanitized)).toEqual([]);
  });

  it('detects likely leaks that remain in fixture payloads', () => {
    const leaks = detectFixtureLeaks({
      accountId: '123456789012',
      bucketName: 'customer-data-archive',
      bucketArn: 'arn:aws:s3:::customer-data-archive',
      ownerEmail: 'owner@example.com',
      endpoint: 'https://ip-10-0-0-5.ec2.internal',
      publicIp: '54.10.11.12',
      kmsKeyId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(leaks.map((leak) => leak.kind)).toEqual(
      expect.arrayContaining([
        'accountId',
        'bucketName',
        'arn',
        'email',
        'internalHostname',
        'ip',
        'kmsKeyIdentifier',
      ]),
    );
  });
});

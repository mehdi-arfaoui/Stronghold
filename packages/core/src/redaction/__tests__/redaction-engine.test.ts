import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { redact, redactObject } from '../index.js';

describe('redaction-engine', () => {
  it('redacts AWS account IDs inside ARNs', () => {
    expect(redact('arn:aws:rds:eu-west-1:123456789012:db:payments-primary')).toBe(
      'arn:aws:rds:eu-west-1:****9012:db:payments****',
    );
  });

  it('redacts ARN resource identifiers without masking service or region', () => {
    expect(redact('arn:aws:lambda:us-east-1:123456789012:function:orders-processor')).toBe(
      'arn:aws:lambda:us-east-1:****9012:function:orders-p****',
    );
  });

  it('redacts private IP addresses while keeping the first octet', () => {
    expect(redact('10.20.30.40 and 192.168.1.22 and 172.16.4.7')).toBe(
      '10.***.***.** and 192.***.***.** and 172.***.***.**',
    );
  });

  it('redacts public IP addresses completely', () => {
    expect(redact('8.8.8.8')).toBe('***.***.***.***');
  });

  it('redacts security group identifiers', () => {
    expect(redact('sg-0abc1234def56789')).toBe('sg-****6789');
  });

  it('redacts subnet identifiers', () => {
    expect(redact('subnet-0abc1234')).toBe('subnet-****1234');
  });

  it('redacts VPC identifiers', () => {
    expect(redact('vpc-0abc1234')).toBe('vpc-****1234');
  });

  it('redacts instance identifiers', () => {
    expect(redact('i-0abc1234def56789')).toBe('i-****6789');
  });

  it('redacts AWS access key IDs', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA****');
  });

  it('redacts secret-like values after an equals sign or colon', () => {
    expect(redact('token=abc1234567890defghijklmnop')).toBe('token=****');
    expect(redact('secret: abc1234567890defghijklmnop')).toBe('secret: ****');
  });

  it('supports full and none levels', () => {
    expect(redact('arn:aws:s3:::orders-bucket', { level: 'none' })).toBe(
      'arn:aws:s3:::orders-bucket',
    );
    expect(
      redact('arn:aws:rds:eu-west-1:123456789012:db:payments-primary 10.20.30.40', {
        level: 'full',
      }),
    ).toBe('arn:aws:rds:eu-west-1:****:**** ***.***.***.***');
  });

  it('redacts nested objects and arrays without mutating the original object', () => {
    const original = {
      report: {
        resources: ['sg-0abc1234def56789', '10.10.1.12'],
      },
    };

    const redacted = redactObject(original);

    expect(redacted).toEqual({
      report: {
        resources: ['sg-****6789', '10.***.***.**'],
      },
    });
    expect(original.report.resources[0]).toBe('sg-0abc1234def56789');
  });

  it('redacts an object with 10,000 keys in under 100ms', () => {
    const input = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `key-${index}`,
        `arn:aws:rds:eu-west-1:123456789012:db:orders-${index}`,
      ]),
    );

    const startedAt = performance.now();
    const output = redactObject(input);
    const duration = performance.now() - startedAt;

    expect(output['key-42']).toBe('arn:aws:rds:eu-west-1:****9012:db:orders-4****');
    expect(duration).toBeLessThan(100);
  });

  it('honors preserve exclusions', () => {
    const arn = 'arn:aws:rds:eu-west-1:123456789012:db:payments-primary';

    expect(redact(arn, { preserve: [arn] })).toBe(arn);
  });

  it('does not redact non-sensitive service names, regions, or instance types', () => {
    expect(redact('Service rds in eu-west-1 uses db.r5.large')).toBe(
      'Service rds in eu-west-1 uses db.r5.large',
    );
  });

  it('does not double-redact identifiers that are already masked', () => {
    expect(redact('arn:aws:rds:eu-west-1:****9012:db:payments**** sg-****6789')).toBe(
      'arn:aws:rds:eu-west-1:****9012:db:payments**** sg-****6789',
    );
  });

  it('supports additional custom patterns', () => {
    expect(redact('customer-id=tenant-1234', { customPatterns: [/tenant-\d+/] })).toBe(
      'customer-id=****',
    );
  });
});

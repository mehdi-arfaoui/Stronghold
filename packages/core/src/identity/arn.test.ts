import { describe, expect, it } from 'vitest';

import {
  ArnParseError,
  extractAccountId,
  formatArn,
  parseArn,
  type ParsedArn,
  tryParseArn,
} from './arn.js';

describe('parseArn', () => {
  it('parses an EC2 instance ARN', () => {
    expect(parseArn('arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123')).toEqual({
      raw: 'arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123',
      partition: 'aws',
      service: 'ec2',
      region: 'us-east-1',
      accountId: '123456789012',
      resourceType: 'instance',
      resourceId: 'i-0abc123',
    });
  });

  it('parses an RDS ARN', () => {
    expect(parseArn('arn:aws:rds:eu-west-3:123456789012:db:my-database')).toMatchObject({
      service: 'rds',
      region: 'eu-west-3',
      accountId: '123456789012',
      resourceType: 'db',
      resourceId: 'my-database',
    });
  });

  it('parses a Lambda ARN', () => {
    expect(parseArn('arn:aws:lambda:us-east-1:123456789012:function:my-function')).toMatchObject({
      service: 'lambda',
      region: 'us-east-1',
      accountId: '123456789012',
      resourceType: 'function',
      resourceId: 'my-function',
    });
  });

  it('parses an S3 bucket ARN with no region and no account', () => {
    expect(parseArn('arn:aws:s3:::my-bucket')).toEqual({
      raw: 'arn:aws:s3:::my-bucket',
      partition: 'aws',
      service: 's3',
      region: null,
      accountId: null,
      resourceType: null,
      resourceId: 'my-bucket',
    });
  });

  it('parses an IAM role ARN with no region', () => {
    expect(parseArn('arn:aws:iam::123456789012:role/MyRole')).toMatchObject({
      service: 'iam',
      region: null,
      accountId: '123456789012',
      resourceType: 'role',
      resourceId: 'MyRole',
    });
  });

  it('parses a CloudFront ARN with no region', () => {
    expect(
      parseArn('arn:aws:cloudfront::123456789012:distribution/EDFDVBD6EXAMPLE'),
    ).toMatchObject({
      service: 'cloudfront',
      region: null,
      accountId: '123456789012',
      resourceType: 'distribution',
      resourceId: 'EDFDVBD6EXAMPLE',
    });
  });

  it('keeps IAM role paths in the resource id', () => {
    expect(parseArn('arn:aws:iam::123456789012:role/path/to/MyRole')).toMatchObject({
      resourceType: 'role',
      resourceId: 'path/to/MyRole',
    });
  });

  it('supports alternate partitions', () => {
    expect(parseArn('arn:aws-cn:ec2:cn-north-1:123456789012:instance/i-0abc123')).toMatchObject({
      partition: 'aws-cn',
      region: 'cn-north-1',
      service: 'ec2',
    });
  });

  it('keeps colons inside resource ids', () => {
    expect(
      parseArn(
        'arn:aws:states:us-east-1:123456789012:execution:MyStateMachine:exec-id-with-colons',
      ),
    ).toMatchObject({
      service: 'states',
      resourceType: 'execution',
      resourceId: 'MyStateMachine:exec-id-with-colons',
    });
  });

  it('returns null for invalid ARNs in tryParseArn', () => {
    expect(tryParseArn('not-an-arn')).toBeNull();
  });

  it('formats parsed ARNs back to their canonical raw value', () => {
    const parsed = parseArn('arn:aws:iam::123456789012:role/path/to/MyRole');
    expect(formatArn(parsed)).toBe(parsed.raw);
    expect(parseArn(formatArn(parsed))).toEqual(parsed);
  });

  it('formats colon-style parsed ARNs back to their canonical raw value', () => {
    const parsed = parseArn('arn:aws:rds:eu-west-3:123456789012:db:orders');
    expect(formatArn(parsed)).toBe(parsed.raw);
    expect(parseArn(formatArn(parsed))).toEqual(parsed);
  });

  it('formats resource-only ARNs without adding a resource type', () => {
    const parsed: ParsedArn = {
      raw: 'not-a-roundtrippable-raw-value',
      partition: 'aws',
      service: 's3',
      region: null,
      accountId: null,
      resourceType: null,
      resourceId: 'my-bucket',
    };

    expect(formatArn(parsed)).toBe('arn:aws:s3:::my-bucket');
  });

  it('falls back to slash formatting when the resource id contains a path', () => {
    const parsed: ParsedArn = {
      raw: 'opaque',
      partition: 'aws',
      service: 'iam',
      region: null,
      accountId: '123456789012',
      resourceType: 'role',
      resourceId: 'path/to/MyRole',
    };

    expect(formatArn(parsed)).toBe('arn:aws:iam::123456789012:role/path/to/MyRole');
  });

  it('falls back to slash formatting for known slash-style resource types', () => {
    const parsed: ParsedArn = {
      raw: 'opaque',
      partition: 'aws',
      service: 'route53',
      region: null,
      accountId: '123456789012',
      resourceType: 'hostedzone',
      resourceId: 'Z1234567890',
    };

    expect(formatArn(parsed)).toBe('arn:aws:route53::123456789012:hostedzone/Z1234567890');
  });

  it('falls back to colon formatting for non slash-style resource types', () => {
    const parsed: ParsedArn = {
      raw: 'opaque',
      partition: 'aws',
      service: 'lambda',
      region: 'us-east-1',
      accountId: '123456789012',
      resourceType: 'function',
      resourceId: 'my-function',
    };

    expect(formatArn(parsed)).toBe(
      'arn:aws:lambda:us-east-1:123456789012:function:my-function',
    );
  });

  it('extracts account ids without a full parse', () => {
    expect(extractAccountId('arn:aws:rds:eu-west-1:123456789012:db:orders')).toBe('123456789012');
    expect(extractAccountId('arn:aws:s3:::orders-bucket')).toBeNull();
  });

  it('returns null when extractAccountId sees a malformed ARN', () => {
    expect(extractAccountId('not-an-arn')).toBeNull();
    expect(extractAccountId('arn:aws:rds:eu-west-1:not-numeric:db:orders')).toBeNull();
    expect(extractAccountId('arn:aws:rds:eu-west-1')).toBeNull();
  });

  it.each([
    '',
    'aws:rds:eu-west-1:123456789012:db:orders',
    'arn:aws:rds:eu-west-1:123456789012',
    'arn:aws-iso:rds:eu-west-1:123456789012:db:orders',
    'arn:aws:rds:eu-west-1:not-numeric:db:orders',
    'arn:aws:rds:eu-west-1:12345:db:orders',
    'arn:aws::eu-west-1:123456789012:db:orders',
    'arn:aws:rds:eu-west-1:123456789012:',
    'arn:aws:iam::123456789012:/MyRole',
    'arn:aws:rds:eu-west-1:123456789012:db:',
  ])('rejects invalid ARN %j', (value) => {
    expect(() => parseArn(value)).toThrow(ArnParseError);
  });
});

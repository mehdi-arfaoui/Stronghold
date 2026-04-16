import { describe, expect, it } from 'vitest';

import {
  InvalidResourceError,
  createResource,
} from './discovery.js';

describe('createResource', () => {
  it('creates a resource and derives identity fields from its ARN', () => {
    const resource = createResource({
      source: 'aws',
      arn: 'arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123',
      name: 'orders-api',
      type: 'EC2',
      metadata: { region: 'us-east-1' },
    });

    expect(resource).toMatchObject({
      arn: 'arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123',
      service: 'ec2',
      region: 'us-east-1',
      resourceType: 'instance',
      resourceId: 'i-0abc123',
      account: {
        accountId: '123456789012',
        partition: 'aws',
      },
    });
  });

  it('uses the scan account context when the ARN omits the account id', () => {
    const resource = createResource({
      source: 'aws',
      arn: 'arn:aws:s3:::orders-bucket',
      name: 'orders-bucket',
      type: 'S3_BUCKET',
      account: {
        accountId: '123456789012',
      },
      metadata: { region: 'eu-west-1' },
    });

    expect(resource.account.accountId).toBe('123456789012');
    expect(resource.region).toBeNull();
    expect(resource.resourceId).toBe('orders-bucket');
  });

  it('throws InvalidResourceError for an invalid ARN', () => {
    expect(() =>
      createResource({
        source: 'aws',
        arn: 'invalid-arn',
        name: 'broken',
        type: 'EC2',
      }),
    ).toThrow(InvalidResourceError);
  });

  it('treats matching ARNs as identical identities', () => {
    const left = createResource({
      source: 'aws',
      arn: 'arn:aws:rds:eu-west-1:123456789012:db:orders',
      name: 'orders',
      type: 'RDS',
    });
    const right = createResource({
      source: 'aws',
      arn: 'arn:aws:rds:eu-west-1:123456789012:db:orders',
      name: 'orders-copy',
      type: 'RDS',
    });

    expect(left.arn).toBe(right.arn);
    expect(left.account.accountId).toBe(right.account.accountId);
  });
});

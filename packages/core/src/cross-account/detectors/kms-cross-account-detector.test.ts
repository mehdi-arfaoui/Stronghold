import { describe, expect, it } from 'vitest';

import { KmsCrossAccountDetector } from './kms-cross-account-detector.js';
import {
  addTestNode,
  createAccountResults,
  createTestGraph,
} from '../test-helpers.js';

describe('KmsCrossAccountDetector', () => {
  it('marks cross-account Decrypt access from key policy as critical', () => {
    const graph = createTestGraph();
    addRole(graph, '444455556666', 'db-reader');
    addKmsKey(graph, '111122223333', 'key-1', {
      keyPolicy: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Sid: 'AllowDecrypt',
          Effect: 'Allow',
          Action: ['kms:Decrypt', 'kms:DescribeKey'],
          Principal: {
            AWS: 'arn:aws:iam::444455556666:role/db-reader',
          },
        },
      }),
    });

    const result = new KmsCrossAccountDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'kms_cross_account_grant',
      completeness: 'complete',
      drImpact: 'critical',
      sourceArn: 'arn:aws:iam::444455556666:role/db-reader',
      targetArn: 'arn:aws:kms:eu-west-1:111122223333:key/key-1',
    });
  });

  it('downgrades Encrypt-only key policy access to degraded', () => {
    const graph = createTestGraph();
    addRole(graph, '444455556666', 'writer-role');
    addKmsKey(graph, '111122223333', 'key-2', {
      keyPolicy: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Sid: 'AllowEncrypt',
          Effect: 'Allow',
          Action: 'kms:Encrypt',
          Principal: {
            AWS: 'arn:aws:iam::444455556666:role/writer-role',
          },
        },
      }),
    });

    const result = new KmsCrossAccountDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.drImpact).toBe('degraded');
  });

  it('creates grant-based edges with grant metadata', () => {
    const graph = createTestGraph();
    addRole(graph, '444455556666', 'analytics-role');
    addKmsKey(graph, '111122223333', 'key-3', {
      grants: [
        {
          GrantId: 'grant-1',
          GranteePrincipal: 'arn:aws:iam::444455556666:role/analytics-role',
          Operations: ['Decrypt', 'GenerateDataKey'],
          Constraints: {
            EncryptionContextEquals: {
              service: 'analytics',
            },
          },
        },
      ],
    });

    const result = new KmsCrossAccountDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.metadata).toMatchObject({
      kind: 'kms_cross_account_grant',
      grantId: 'grant-1',
      granteePrincipal: 'arn:aws:iam::444455556666:role/analytics-role',
      operations: ['Decrypt', 'GenerateDataKey'],
      accessSource: 'grant',
    });
  });

  it('ignores same-account key access', () => {
    const graph = createTestGraph();
    addRole(graph, '111122223333', 'local-role');
    addKmsKey(graph, '111122223333', 'key-4', {
      keyPolicy: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'kms:Decrypt',
          Principal: {
            AWS: 'arn:aws:iam::111122223333:role/local-role',
          },
        },
      }),
    });

    const result = new KmsCrossAccountDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('exposes rotation-disabled metadata on cross-account dependencies', () => {
    const graph = createTestGraph();
    addRole(graph, '444455556666', 'shared-role');
    addKmsKey(graph, '111122223333', 'key-5', {
      keyRotationEnabled: false,
      keyPolicy: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'kms:Decrypt',
          Principal: {
            AWS: 'arn:aws:iam::444455556666:role/shared-role',
          },
        },
      }),
    });

    const result = new KmsCrossAccountDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.metadata).toMatchObject({
      kind: 'kms_cross_account_grant',
      keyRotationEnabled: false,
    });
  });

  it('works in policy-only mode when grants are not present', () => {
    const graph = createTestGraph();
    addRole(graph, '444455556666', 'policy-only-role');
    addKmsKey(graph, '111122223333', 'key-6', {
      keyPolicy: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: ['kms:Encrypt', 'kms:GenerateDataKey*'],
          Principal: {
            AWS: 'arn:aws:iam::444455556666:role/policy-only-role',
          },
        },
      }),
    });

    const result = new KmsCrossAccountDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.metadata).toMatchObject({
      kind: 'kms_cross_account_grant',
      accessSource: 'key_policy',
      operations: ['Encrypt', 'GenerateDataKey'],
    });
  });

  it('deduplicates multiple grants to the same account and key', () => {
    const graph = createTestGraph();
    addRole(graph, '444455556666', 'batch-role');
    addKmsKey(graph, '111122223333', 'key-7', {
      grants: [
        {
          GrantId: 'grant-a',
          GranteePrincipal: 'arn:aws:iam::444455556666:role/batch-role',
          Operations: ['Encrypt'],
        },
        {
          GrantId: 'grant-b',
          GranteePrincipal: 'arn:aws:iam::444455556666:role/batch-role',
          Operations: ['Decrypt'],
          RetiringPrincipal: 'arn:aws:iam::111122223333:role/kms-admin',
        },
      ],
    });

    const result = new KmsCrossAccountDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      drImpact: 'critical',
    });
    expect(result[0]?.metadata).toMatchObject({
      kind: 'kms_cross_account_grant',
      operations: ['Encrypt', 'Decrypt'],
      isRetiring: true,
      relatedGrantIds: ['grant-b'],
    });
  });
});

function addRole(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  roleName: string,
): void {
  addTestNode(graph, {
    arn: `arn:aws:iam::${accountId}:role/${roleName}`,
    accountId,
    name: roleName,
    sourceType: 'IAM_ROLE',
    metadata: { roleName },
  });
}

function addKmsKey(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  keyId: string,
  metadata: Record<string, unknown>,
): void {
  addTestNode(graph, {
    arn: `arn:aws:kms:eu-west-1:${accountId}:key/${keyId}`,
    accountId,
    name: keyId,
    sourceType: 'KMS_KEY',
    metadata: {
      keyId,
      ...metadata,
    },
  });
}

function toPolicyDocument(policy: Record<string, unknown>): string {
  return JSON.stringify(policy);
}

import { describe, expect, it } from 'vitest';

import { IamAssumeRoleDetector } from './iam-assume-role-detector.js';
import {
  addTestNode,
  createAccountResults,
  createTestGraph,
} from '../test-helpers.js';

describe('IamAssumeRoleDetector', () => {
  it('creates a unidirectional edge for a cross-account trust policy', () => {
    const graph = createTestGraph();
    addRole(graph, '111122223333', 'target-role', {
      AssumeRolePolicyDocument: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'sts:AssumeRole',
          Principal: {
            AWS: 'arn:aws:iam::444455556666:role/source-role',
          },
        },
      }),
    });
    addRole(graph, '444455556666', 'source-role');

    const result = new IamAssumeRoleDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'iam_assume_role',
      direction: 'unidirectional',
      completeness: 'complete',
      sourceArn: 'arn:aws:iam::444455556666:role/source-role',
      targetArn: 'arn:aws:iam::111122223333:role/target-role',
      drImpact: 'critical',
    });
  });

  it('ignores same-account trust relationships', () => {
    const graph = createTestGraph();
    addRole(graph, '111122223333', 'target-role', {
      AssumeRolePolicyDocument: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'sts:AssumeRole',
          Principal: {
            AWS: 'arn:aws:iam::111122223333:role/local-role',
          },
        },
      }),
    });
    addRole(graph, '111122223333', 'local-role');

    const result = new IamAssumeRoleDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('creates edges to every scanned account for wildcard principals without conditions', () => {
    const graph = createTestGraph();
    addRole(graph, '111122223333', 'open-role', {
      AssumeRolePolicyDocument: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'sts:AssumeRole',
          Principal: '*',
        },
      }),
    });
    addAccountRoot(graph, '444455556666');
    addAccountRoot(graph, '777788889999');

    const result = new IamAssumeRoleDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666', '777788889999']),
    );

    expect(result).toHaveLength(2);
    expect(result.every((edge) => edge.metadata.kind === 'iam_assume_role' && edge.metadata.isWildcardPrincipal)).toBe(true);
    expect(result.map((edge) => edge.sourceAccountId).sort()).toEqual([
      '444455556666',
      '777788889999',
    ]);
  });

  it('creates conditional edges for wildcard principals protected by ExternalId', () => {
    const graph = createTestGraph();
    addRole(graph, '111122223333', 'external-id-role', {
      AssumeRolePolicyDocument: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'sts:AssumeRole',
          Principal: '*',
          Condition: {
            StringEquals: {
              'sts:ExternalId': 'partner-123',
            },
          },
        },
      }),
    });
    addAccountRoot(graph, '444455556666');

    const result = new IamAssumeRoleDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.metadata).toMatchObject({
      kind: 'iam_assume_role',
      isWildcardPrincipal: true,
      conditionKeys: ['sts:ExternalId'],
    });
  });

  it('ignores service-linked roles', () => {
    const graph = createTestGraph();
    addTestNode(graph, {
      arn: 'arn:aws:iam::111122223333:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing',
      accountId: '111122223333',
      sourceType: 'IAM_ROLE',
      metadata: {
        roleName: 'AWSServiceRoleForElasticLoadBalancing',
        path: '/aws-service-role/elasticloadbalancing.amazonaws.com/',
        AssumeRolePolicyDocument: toPolicyDocument({
          Version: '2012-10-17',
          Statement: {
            Effect: 'Allow',
            Action: 'sts:AssumeRole',
            Principal: {
              Service: 'elasticloadbalancing.amazonaws.com',
            },
          },
        }),
      },
    });

    const result = new IamAssumeRoleDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('returns a partial edge when the trusted account is not present in the graph', () => {
    const graph = createTestGraph();
    addRole(graph, '111122223333', 'target-role', {
      AssumeRolePolicyDocument: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: ['sts:AssumeRole', 'sts:TagSession'],
          Principal: {
            AWS: 'arn:aws:iam::999900001111:role/external-role',
          },
        },
      }),
    });

    const result = new IamAssumeRoleDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      completeness: 'partial',
      missingAccountId: '999900001111',
      sourceArn: 'arn:aws:iam::999900001111:role/external-role',
    });
  });

  it('only honors allow statements in multi-statement policies', () => {
    const graph = createTestGraph();
    addRole(graph, '111122223333', 'target-role', {
      AssumeRolePolicyDocument: toPolicyDocument({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Deny',
            Action: 'sts:AssumeRole',
            Principal: {
              AWS: 'arn:aws:iam::777788889999:role/denied-role',
            },
          },
          {
            Effect: 'Allow',
            Action: 'sts:AssumeRole',
            Principal: {
              AWS: 'arn:aws:iam::444455556666:role/allowed-role',
            },
          },
        ],
      }),
    });
    addRole(graph, '444455556666', 'allowed-role');
    addRole(graph, '777788889999', 'denied-role');

    const result = new IamAssumeRoleDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666', '777788889999']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.sourceArn).toBe('arn:aws:iam::444455556666:role/allowed-role');
  });

  it('creates only direct edges for assume-role chains', () => {
    const graph = createTestGraph();
    addRole(graph, '111122223333', 'role-a', {
      AssumeRolePolicyDocument: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'sts:AssumeRole',
          Principal: {
            AWS: 'arn:aws:iam::444455556666:role/role-b',
          },
        },
      }),
    });
    addRole(graph, '444455556666', 'role-b', {
      AssumeRolePolicyDocument: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'sts:AssumeRole',
          Principal: {
            AWS: 'arn:aws:iam::777788889999:role/role-c',
          },
        },
      }),
    });
    addRole(graph, '777788889999', 'role-c');

    const result = new IamAssumeRoleDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666', '777788889999']),
    );

    expect(result).toHaveLength(2);
    expect(result.map((edge) => `${edge.sourceArn}->${edge.targetArn}`)).toEqual([
      'arn:aws:iam::444455556666:role/role-b->arn:aws:iam::111122223333:role/role-a',
      'arn:aws:iam::777788889999:role/role-c->arn:aws:iam::444455556666:role/role-b',
    ]);
  });
});

function addRole(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  roleName: string,
  metadata: Record<string, unknown> = {},
): void {
  addTestNode(graph, {
    arn: `arn:aws:iam::${accountId}:role/${roleName}`,
    accountId,
    name: roleName,
    sourceType: 'IAM_ROLE',
    metadata: {
      roleName,
      ...metadata,
    },
  });
}

function addAccountRoot(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
): void {
  addTestNode(graph, {
    arn: `arn:aws:iam::${accountId}:root`,
    accountId,
    name: `root-${accountId}`,
    sourceType: 'ACCOUNT_PRINCIPAL',
    metadata: {},
  });
}

function toPolicyDocument(policy: Record<string, unknown>): string {
  return JSON.stringify(policy);
}

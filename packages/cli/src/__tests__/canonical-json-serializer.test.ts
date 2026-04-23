import { describe, expect, it } from 'vitest';

import type { CrossAccountEdge } from '@stronghold-dr/core';

import { serializeCanonicalScanJson } from '../output/canonical-json-serializer.js';
import type {
  CanonicalMultiAccountScanResult,
  SingleAccountScanResult,
} from '../output/canonical-json-types.js';
import { createDemoResults } from './test-utils.js';

describe('serializeCanonicalScanJson', () => {
  it('produces canonical format from single-account result', async () => {
    const result: SingleAccountScanResult = {
      kind: 'single-account',
      results: await createDemoResults('minimal'),
      account: {
        accountId: '111122223333',
        alias: 'default',
        region: 'eu-west-3',
        durationMs: 1_500,
      },
    };

    const json = serializeCanonicalScanJson(result);

    expect(json.scan.accounts).toHaveLength(1);
    expect(json.scan.accounts[0]?.status).toBe('success');
    expect(json.graph.crossAccount.edges).toEqual([]);
    expect(json.graph.crossAccount.summary.total).toBe(0);
    expect(json.nodes).toBeUndefined();
    expect(json.edges).toBeUndefined();
  });

  it('produces canonical format from multi-account result', async () => {
    const results = await createDemoResults('minimal');
    const edge = buildCrossAccountEdge(results.nodes[0]?.id, results.nodes[1]?.id);
    const result: CanonicalMultiAccountScanResult = {
      kind: 'multi-account',
      results,
      accounts: [
        {
          accountId: '111122223333',
          alias: 'prod',
          region: 'eu-west-1',
          status: 'success',
          resourceCount: 2,
          findingCount: 1,
          durationMs: 1_200,
        },
        {
          accountId: '444455556666',
          alias: 'data',
          region: 'eu-west-1',
          status: 'success',
          resourceCount: 3,
          findingCount: 2,
          durationMs: 1_400,
        },
      ],
      errors: [],
      crossAccount: {
        edges: [edge],
        summary: {
          total: 1,
          byKind: { vpc_peering: 1 },
          complete: 1,
          partial: 0,
          critical: 1,
          degraded: 0,
          informational: 0,
        },
      },
      summary: {
        totalAccounts: 2,
        successfulAccounts: 2,
        failedAccounts: 0,
        totalResources: 5,
        resourcesByAccount: {
          '111122223333': 2,
          '444455556666': 3,
        },
        totalFindings: 3,
        findingsByAccount: {
          '111122223333': 1,
          '444455556666': 2,
        },
        crossAccountEdges: 1,
      },
    };

    const json = serializeCanonicalScanJson(result);

    expect(json.scan.accounts.length).toBeGreaterThan(1);
    expect(json.graph.crossAccount.edges).toHaveLength(1);
    expect(json.graph.crossAccount.summary.total).toBe(1);
  });

  it('has identical structure in both cases', async () => {
    const single = serializeCanonicalScanJson({
      kind: 'single-account',
      results: await createDemoResults('minimal'),
    });
    const results = await createDemoResults('minimal');
    const multi = serializeCanonicalScanJson({
      kind: 'multi-account',
      results,
      accounts: [],
      errors: [],
      crossAccount: {
        edges: [],
        summary: {
          total: 0,
          byKind: {},
          complete: 0,
          partial: 0,
          critical: 0,
          degraded: 0,
          informational: 0,
        },
      },
      summary: {
        totalAccounts: 0,
        successfulAccounts: 0,
        failedAccounts: 0,
        totalResources: 0,
        resourcesByAccount: {},
        totalFindings: 0,
        findingsByAccount: {},
        crossAccountEdges: 0,
      },
    });

    expect(Object.keys(single)).toEqual(Object.keys(multi));
    expect(Object.keys(single.scan)).toEqual(Object.keys(multi.scan));
    expect(Object.keys(single.graph)).toEqual(Object.keys(multi.graph));
  });
});

function buildCrossAccountEdge(
  sourceArn: string | undefined,
  targetArn: string | undefined,
): CrossAccountEdge {
  if (!sourceArn || !targetArn) {
    throw new Error('Demo scenario must include at least two graph nodes.');
  }

  return {
    sourceArn,
    sourceAccountId: '111122223333',
    targetArn,
    targetAccountId: '444455556666',
    kind: 'vpc_peering',
    direction: 'bidirectional',
    drImpact: 'critical',
    completeness: 'complete',
    metadata: {
      kind: 'vpc_peering',
      peeringConnectionId: 'pcx-123',
      requesterVpcId: 'vpc-1111',
      accepterVpcId: 'vpc-2222',
      status: 'active',
    },
  };
}

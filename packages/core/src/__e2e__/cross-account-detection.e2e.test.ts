import { beforeAll, describe, expect, it } from 'vitest';

import type { CrossAccountEdge, MultiAccountScanResult } from '../index.js';
import { getE2EConfig } from './helpers/e2e-config.js';
import { runE2EScan } from './helpers/e2e-scan-runner.js';

const config = getE2EConfig();
const describeE2E = config ? describe : describe.skip;

describeE2E('Cross-Account Detection E2E', () => {
  let result: MultiAccountScanResult;

  beforeAll(async () => {
    result = await runE2EScan(config!.configPath);
  }, 300_000);

  it('detects VPC peering between prod and staging', () => {
    const peeringEdge = findEdge(result, 'vpc_peering', ({ sourceAccountId, targetAccountId }) =>
      [sourceAccountId, targetAccountId].sort().join(':') ===
      [config!.prodAccountId, config!.stagingAccountId].sort().join(':'),
    );

    expect(peeringEdge).toBeDefined();
    expect(peeringEdge?.direction).toBe('bidirectional');
    expect(peeringEdge?.drImpact).toBe('critical');
    expect(peeringEdge?.completeness).toBe('complete');
  });

  it('detects IAM cross-account AssumeRole', () => {
    const iamEdge = findEdge(
      result,
      'iam_assume_role',
      ({ sourceAccountId, targetAccountId }) =>
        sourceAccountId === config!.stagingAccountId &&
        targetAccountId === config!.prodAccountId,
    );

    expect(iamEdge).toBeDefined();
    expect(iamEdge?.direction).toBe('unidirectional');
    expect(iamEdge?.drImpact).toBe('critical');
    expect(iamEdge?.completeness).toBe('complete');
  });

  it('detects KMS cross-account grant', () => {
    const kmsEdge = findEdge(
      result,
      'kms_cross_account_grant',
      ({ sourceAccountId, targetAccountId }) =>
        sourceAccountId === config!.stagingAccountId &&
        targetAccountId === config!.prodAccountId,
    );

    expect(kmsEdge).toBeDefined();
    expect(kmsEdge?.drImpact).toBe('critical');
    expect(kmsEdge?.completeness).toBe('complete');
    if (kmsEdge?.metadata.kind === 'kms_cross_account_grant') {
      expect(kmsEdge.metadata.operations).toContain('Decrypt');
    }
  });

  it('detects Route53 shared private hosted zone', () => {
    const route53Edge = findEdge(
      result,
      'route53_shared_zone',
      ({ sourceAccountId, targetAccountId }) =>
        sourceAccountId === config!.stagingAccountId &&
        targetAccountId === config!.prodAccountId,
    );

    expect(route53Edge).toBeDefined();
    expect(route53Edge?.direction).toBe('unidirectional');
    expect(['degraded', 'critical']).toContain(route53Edge?.drImpact);
    expect(route53Edge?.completeness).toBe('complete');
  });

  it('does not create a cross-account edge for the application role trusted by EC2', () => {
    const badEdge = result.crossAccount.edges.find(
      (edge) =>
        edge.kind === 'iam_assume_role' &&
        edge.targetArn.includes('StrongholdTestAppRole'),
    );

    expect(badEdge).toBeUndefined();
  });

  it('reports an accurate cross-account summary', () => {
    const summary = result.crossAccount.summary;

    expect(summary.total).toBeGreaterThanOrEqual(4);
    expect(summary.complete).toBeGreaterThanOrEqual(4);
    expect(summary.partial).toBe(0);
    expect(summary.critical).toBeGreaterThanOrEqual(3);
    expect(summary.byKind.get('vpc_peering')).toBeGreaterThanOrEqual(1);
    expect(summary.byKind.get('iam_assume_role')).toBeGreaterThanOrEqual(1);
    expect(summary.byKind.get('kms_cross_account_grant')).toBeGreaterThanOrEqual(1);
    expect(summary.byKind.get('route53_shared_zone')).toBeGreaterThanOrEqual(1);
  });

  it('materializes complete edges into the merged graph', () => {
    const completeEdges = result.crossAccount.edges.filter(
      (edge) => edge.completeness === 'complete',
    );

    expect(completeEdges.length).toBeGreaterThan(0);
    for (const edge of completeEdges) {
      expect(result.mergedGraph.hasEdge(buildCrossAccountGraphKey(edge))).toBe(true);
    }
  });
});

function findEdge(
  result: MultiAccountScanResult,
  kind: CrossAccountEdge['kind'],
  matcher: (edge: CrossAccountEdge) => boolean,
): CrossAccountEdge | undefined {
  return result.crossAccount.edges.find(
    (edge) => edge.kind === kind && matcher(edge),
  );
}

function buildCrossAccountGraphKey(edge: CrossAccountEdge): string {
  return `${edge.sourceArn}->${edge.targetArn}:cross_account`;
}

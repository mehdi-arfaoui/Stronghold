import { beforeAll, describe, expect, it } from 'vitest';

import type { MultiAccountScanResult } from '../orchestration/types.js';
import {
  EXPECTED_ABSENT_EDGES,
  EXPECTED_COMPLETE_EDGES,
} from '../__fixtures__/multi-account/cross-account-scenarios.fixture.js';
import {
  PROD_ACCOUNT_CONTEXT,
  PROD_ACCOUNT_ID,
  STAGING_ACCOUNT_CONTEXT,
  STAGING_ACCOUNT_ID,
} from '../__fixtures__/multi-account/constants.js';
import {
  buildProdAccountEdges,
  buildProdAccountResources,
} from '../__fixtures__/multi-account/prod-account.fixture.js';
import {
  buildStagingAccountEdges,
  buildStagingAccountResources,
} from '../__fixtures__/multi-account/staging-account.fixture.js';
import {
  expectCompleteEdgesInGraph,
  expectCrossAccountEdge,
} from './helpers/assertions.js';
import { runSyntheticMultiAccountScan } from './helpers/synthetic-scan-runner.js';

describe('Cross-Account Detection (synthetic)', () => {
  let result: MultiAccountScanResult;

  beforeAll(async () => {
    result = await runSyntheticMultiAccountScan({
      accounts: new Map([
        [
          PROD_ACCOUNT_ID,
          {
            resources: buildProdAccountResources(),
            edges: buildProdAccountEdges(),
            accountContext: PROD_ACCOUNT_CONTEXT,
          },
        ],
        [
          STAGING_ACCOUNT_ID,
          {
            resources: buildStagingAccountResources(),
            edges: buildStagingAccountEdges(),
            accountContext: STAGING_ACCOUNT_CONTEXT,
          },
        ],
      ]),
    });
  });

  describe('expected cross-account edges', () => {
    for (const expected of EXPECTED_COMPLETE_EDGES) {
      it(`detects ${expected.kind} (${expected.sourceAccountId} -> ${expected.targetAccountId})`, () => {
        expectCrossAccountEdge(result, expected);
      });
    }
  });

  describe('negative controls', () => {
    it('does not create an edge for the service-linked style IAM role', () => {
      const appRoleEdge = result.crossAccount.edges.find(
        (edge) =>
          edge.kind === EXPECTED_ABSENT_EDGES.noServiceLinkedIam.kind &&
          edge.targetArn.includes('StrongholdTestAppRole'),
      );

      expect(appRoleEdge, EXPECTED_ABSENT_EDGES.noServiceLinkedIam.description).toBeUndefined();
    });

    it('does not create a staging-owned KMS dependency for the unencrypted staging bucket', () => {
      const stagingOwnedKmsEdges = result.crossAccount.edges.filter(
        (edge) =>
          edge.kind === EXPECTED_ABSENT_EDGES.noStagingOwnedKmsEdge.kind &&
          edge.targetAccountId === STAGING_ACCOUNT_ID,
      );

      expect(
        stagingOwnedKmsEdges,
        EXPECTED_ABSENT_EDGES.noStagingOwnedKmsEdge.description,
      ).toHaveLength(0);
    });

    it('produces zero RAM edges', () => {
      const ramEdges = result.crossAccount.edges.filter(
        (edge) => edge.kind === EXPECTED_ABSENT_EDGES.noRamEdges.kind,
      );

      expect(ramEdges, EXPECTED_ABSENT_EDGES.noRamEdges.description).toHaveLength(0);
    });

    it('produces zero VPC endpoint shared edges', () => {
      const endpointEdges = result.crossAccount.edges.filter(
        (edge) => edge.kind === EXPECTED_ABSENT_EDGES.noVpcEndpointEdges.kind,
      );

      expect(
        endpointEdges,
        EXPECTED_ABSENT_EDGES.noVpcEndpointEdges.description,
      ).toHaveLength(0);
    });
  });

  describe('deduplication', () => {
    it('materializes the shared VPC peering as exactly one edge', () => {
      const peeringEdges = result.crossAccount.edges.filter(
        (edge) => edge.kind === 'vpc_peering',
      );

      expect(peeringEdges).toHaveLength(1);
    });
  });

  describe('graph materialization', () => {
    it('adds all complete edges to the merged graph', () => {
      expectCompleteEdgesInGraph(result);
    });
  });

  describe('summary accuracy', () => {
    it('keeps the summary in sync with detected edges', () => {
      const summary = result.crossAccount.summary;

      expect(summary.total).toBe(result.crossAccount.edges.length);
      expect(summary.complete).toBe(
        result.crossAccount.edges.filter((edge) => edge.completeness === 'complete').length,
      );
      expect(summary.partial).toBe(0);
      expect(summary.critical).toBeGreaterThanOrEqual(4);
    });

    it('tracks counts for every detected kind', () => {
      const detectedKinds = new Set(result.crossAccount.edges.map((edge) => edge.kind));

      for (const kind of detectedKinds) {
        expect(result.crossAccount.summary.byKind.get(kind)).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('metadata integrity', () => {
    it('captures the Decrypt operation on the KMS edge', () => {
      const kmsEdge = result.crossAccount.edges.find(
        (edge) => edge.kind === 'kms_cross_account_grant',
      );

      expect(kmsEdge).toBeDefined();
      if (kmsEdge?.metadata.kind === 'kms_cross_account_grant') {
        expect(kmsEdge.metadata.operations).toContain('Decrypt');
      }
    });

    it('marks IAM trust edges as non service-linked', () => {
      const iamEdge = result.crossAccount.edges.find(
        (edge) => edge.kind === 'iam_assume_role',
      );

      expect(iamEdge).toBeDefined();
      if (iamEdge?.metadata.kind === 'iam_assume_role') {
        expect(iamEdge.metadata.roleArn).toContain(PROD_ACCOUNT_ID);
        expect(iamEdge.metadata.isServiceLinked).toBe(false);
      }
    });
  });
});

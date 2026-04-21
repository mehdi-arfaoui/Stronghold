import type { CrossAccountDependencyKind } from '../../cross-account/types.js';
import { PROD_ACCOUNT_ID, STAGING_ACCOUNT_ID } from './constants.js';

export interface ExpectedCrossAccountEdge {
  readonly kind: CrossAccountDependencyKind;
  readonly sourceAccountId: string;
  readonly targetAccountId: string;
  readonly direction: 'unidirectional' | 'bidirectional';
  readonly drImpact: 'critical' | 'degraded' | 'informational';
  readonly completeness: 'complete' | 'partial';
}

/**
 * Expected edges align with the real detector implementations:
 * - IAM/KMS source = trusted principal or grantee
 * - Route53 source = associated VPC owner
 * - Transit gateway source = attachment owner
 */
export const EXPECTED_COMPLETE_EDGES: readonly ExpectedCrossAccountEdge[] = [
  {
    kind: 'vpc_peering',
    sourceAccountId: PROD_ACCOUNT_ID,
    targetAccountId: STAGING_ACCOUNT_ID,
    direction: 'bidirectional',
    drImpact: 'critical',
    completeness: 'complete',
  },
  {
    kind: 'transit_gateway',
    sourceAccountId: STAGING_ACCOUNT_ID,
    targetAccountId: PROD_ACCOUNT_ID,
    direction: 'unidirectional',
    drImpact: 'critical',
    completeness: 'complete',
  },
  {
    kind: 'iam_assume_role',
    sourceAccountId: STAGING_ACCOUNT_ID,
    targetAccountId: PROD_ACCOUNT_ID,
    direction: 'unidirectional',
    drImpact: 'critical',
    completeness: 'complete',
  },
  {
    kind: 'kms_cross_account_grant',
    sourceAccountId: STAGING_ACCOUNT_ID,
    targetAccountId: PROD_ACCOUNT_ID,
    direction: 'unidirectional',
    drImpact: 'critical',
    completeness: 'complete',
  },
  {
    kind: 'route53_shared_zone',
    sourceAccountId: STAGING_ACCOUNT_ID,
    targetAccountId: PROD_ACCOUNT_ID,
    direction: 'unidirectional',
    drImpact: 'degraded',
    completeness: 'complete',
  },
];

export const EXPECTED_ABSENT_EDGES = {
  noServiceLinkedIam: {
    kind: 'iam_assume_role' as const,
    description: 'The service-linked style application role must not create a cross-account edge.',
  },
  noStagingOwnedKmsEdge: {
    kind: 'kms_cross_account_grant' as const,
    description: 'The unencrypted staging bucket must not create a staging-owned KMS dependency.',
  },
  noVpcEndpointEdges: {
    kind: 'vpc_endpoint_shared' as const,
    description: 'No VPC endpoint fixtures are present, so the detector should stay silent.',
  },
  noRamEdges: {
    kind: 'ram_share' as const,
    description: 'RAM share fixtures are intentionally absent; the detector should return zero edges.',
  },
} as const;

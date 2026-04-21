export const CROSS_ACCOUNT_DEPENDENCY_KINDS = [
  'vpc_peering',
  'transit_gateway',
  'route53_shared_zone',
  'vpc_endpoint_shared',
  'iam_assume_role',
  'kms_cross_account_grant',
  'ram_share',
] as const;

/**
 * Type d'une dependance cross-account detectee.
 */
export type CrossAccountDependencyKind =
  (typeof CROSS_ACCOUNT_DEPENDENCY_KINDS)[number];

export type CrossAccountDependencyDirection =
  | 'unidirectional'
  | 'bidirectional';

export type CrossAccountDrImpact =
  | 'critical'
  | 'degraded'
  | 'informational';

export type CrossAccountEdgeCompleteness =
  | 'complete'
  | 'partial';

export interface CrossAccountRelatedDetection {
  readonly kind: CrossAccountDependencyKind;
  readonly identity: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

type CrossAccountEdgeMetadataBase = {
  readonly detectedByKinds?: readonly CrossAccountDependencyKind[];
  readonly relatedDetections?: readonly CrossAccountRelatedDetection[];
};

/**
 * Metadata specifique a chaque type de dependance.
 */
export type CrossAccountEdgeMetadata =
  | (CrossAccountEdgeMetadataBase & {
      readonly kind: 'vpc_peering';
      readonly peeringConnectionId: string;
      readonly requesterVpcId: string;
      readonly accepterVpcId: string;
      readonly status: string;
    })
  | (CrossAccountEdgeMetadataBase & {
      readonly kind: 'transit_gateway';
      readonly tgwId: string;
      readonly attachmentId: string;
      readonly attachmentType: string;
    })
  | (CrossAccountEdgeMetadataBase & {
      readonly kind: 'route53_shared_zone';
      readonly hostedZoneId: string;
      readonly zoneName: string;
      readonly vpcAssociationId: string;
    })
  | (CrossAccountEdgeMetadataBase & {
      readonly kind: 'vpc_endpoint_shared';
      readonly endpointId: string;
      readonly serviceName: string;
      readonly vpcId: string;
    })
  | (CrossAccountEdgeMetadataBase & {
      readonly kind: 'iam_assume_role';
      readonly roleArn: string;
      readonly trustedPrincipal: string;
      readonly conditionKeys: readonly string[];
      readonly isServiceLinked: boolean;
      readonly sessionPolicyMayRestrict?: boolean;
      readonly organizationWide?: boolean;
      readonly isWildcardPrincipal?: boolean;
    })
  | (CrossAccountEdgeMetadataBase & {
      readonly kind: 'kms_cross_account_grant';
      readonly keyArn: string;
      readonly grantId: string;
      readonly granteePrincipal: string;
      readonly operations: readonly string[];
      readonly isRetiring: boolean;
      readonly constraints?: {
        readonly encryptionContextSubset?: Readonly<Record<string, string>>;
        readonly encryptionContextEquals?: Readonly<Record<string, string>>;
      };
      readonly accessSource?: 'grant' | 'key_policy';
      readonly keyRotationEnabled?: boolean;
      readonly relatedGrantIds?: readonly string[];
    })
  | (CrossAccountEdgeMetadataBase & {
      readonly kind: 'ram_share';
      readonly shareArn: string;
      readonly resourceArn: string;
      readonly resourceType: string;
      readonly principalAccountId: string;
      readonly status: string;
      readonly organizationWide?: boolean;
      readonly relatedShareArns?: readonly string[];
    });

/**
 * Un edge cross-account detecte.
 */
export interface CrossAccountEdge {
  readonly sourceArn: string;
  readonly sourceAccountId: string;
  readonly targetArn: string;
  readonly targetAccountId: string;
  readonly kind: CrossAccountDependencyKind;
  readonly direction: CrossAccountDependencyDirection;
  readonly drImpact: CrossAccountDrImpact;
  readonly metadata: CrossAccountEdgeMetadata;
  readonly completeness: CrossAccountEdgeCompleteness;
  readonly missingAccountId?: string;
}

export interface CrossAccountDetectionSummary {
  readonly total: number;
  readonly byKind: ReadonlyMap<CrossAccountDependencyKind, number>;
  readonly complete: number;
  readonly partial: number;
  readonly critical: number;
  readonly degraded: number;
  readonly informational: number;
}

export interface CrossAccountDetectionResult {
  readonly edges: readonly CrossAccountEdge[];
  readonly summary: CrossAccountDetectionSummary;
}

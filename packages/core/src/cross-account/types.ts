export const CROSS_ACCOUNT_DEPENDENCY_KINDS = [
  'vpc_peering',
  'transit_gateway',
  'route53_shared_zone',
  'vpc_endpoint_shared',
] as const;

/**
 * Type d'une dépendance cross-account détectée.
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

/**
 * Metadata spécifique à chaque type de dépendance.
 */
export type CrossAccountEdgeMetadata =
  | {
      readonly kind: 'vpc_peering';
      readonly peeringConnectionId: string;
      readonly requesterVpcId: string;
      readonly accepterVpcId: string;
      readonly status: string;
    }
  | {
      readonly kind: 'transit_gateway';
      readonly tgwId: string;
      readonly attachmentId: string;
      readonly attachmentType: string;
    }
  | {
      readonly kind: 'route53_shared_zone';
      readonly hostedZoneId: string;
      readonly zoneName: string;
      readonly vpcAssociationId: string;
    }
  | {
      readonly kind: 'vpc_endpoint_shared';
      readonly endpointId: string;
      readonly serviceName: string;
      readonly vpcId: string;
    };

/**
 * Un edge cross-account détecté.
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

import type { GraphInstance } from '../graph/graph-instance.js';
import type {
  AccountScanResult,
  MultiAccountScanResult,
} from '../orchestration/types.js';
import { EdgeType } from '../types/infrastructure.js';
import { IamAssumeRoleDetector } from './detectors/iam-assume-role-detector.js';
import { KmsCrossAccountDetector } from './detectors/kms-cross-account-detector.js';
import { RamShareDetector } from './detectors/ram-share-detector.js';
import { Route53SharedZoneDetector } from './detectors/route53-shared-zone-detector.js';
import { TransitGatewayDetector } from './detectors/transit-gateway-detector.js';
import { VpcEndpointSharedDetector } from './detectors/vpc-endpoint-shared-detector.js';
import { VpcPeeringDetector } from './detectors/vpc-peering-detector.js';
import {
  CROSS_ACCOUNT_DEPENDENCY_KINDS,
  type CrossAccountDependencyDirection,
  type CrossAccountDependencyKind,
  type CrossAccountDetectionResult,
  type CrossAccountDrImpact,
  type CrossAccountEdge,
  type CrossAccountEdgeMetadata,
  type CrossAccountRelatedDetection,
} from './types.js';

export interface SingleDetector {
  readonly kind: CrossAccountDependencyKind;
  detect(
    mergedGraph: GraphInstance,
    accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[];
}

/**
 * Orchestre tous les cross-account detectors sur le graphe unifie.
 */
export class CrossAccountDetector {
  private readonly detectors: readonly SingleDetector[];

  public constructor(options?: {
    readonly enabledKinds?: readonly CrossAccountDependencyKind[];
  }) {
    const enabledKinds = new Set(
      options?.enabledKinds ?? CROSS_ACCOUNT_DEPENDENCY_KINDS,
    );
    this.detectors = [
      new VpcPeeringDetector(),
      new TransitGatewayDetector(),
      new Route53SharedZoneDetector(),
      new VpcEndpointSharedDetector(),
      new IamAssumeRoleDetector(),
      new KmsCrossAccountDetector(),
      new RamShareDetector(),
    ].filter((detector) => enabledKinds.has(detector.kind));
  }

  public detect(
    mergedGraph: GraphInstance,
    scanResult: MultiAccountScanResult,
  ): CrossAccountDetectionResult {
    const detectedEdgesByPair = new Map<string, CrossAccountEdge>();

    for (const detector of this.detectors) {
      for (const edge of detector.detect(mergedGraph, scanResult.accounts)) {
        const pairKey = buildPairKey(edge);
        const existing = detectedEdgesByPair.get(pairKey);
        detectedEdgesByPair.set(
          pairKey,
          existing ? mergeEdges(existing, edge) : withDetectedKinds(edge),
        );
      }
    }

    const detectedEdges = [...detectedEdgesByPair.values()];
    for (const edge of detectedEdges) {
      materializeEdge(mergedGraph, edge);
    }

    return {
      edges: detectedEdges,
      summary: summarizeEdges(detectedEdges),
    };
  }
}

export function createEmptyCrossAccountDetectionResult(): CrossAccountDetectionResult {
  return {
    edges: [],
    summary: summarizeEdges([]),
  };
}

function materializeEdge(
  mergedGraph: GraphInstance,
  edge: CrossAccountEdge,
): void {
  if (edge.completeness !== 'complete') {
    return;
  }

  const graphEdgeKey = buildGraphEdgeKey(edge);
  if (mergedGraph.hasEdge(graphEdgeKey)) {
    return;
  }

  mergedGraph.addEdgeWithKey(graphEdgeKey, edge.sourceArn, edge.targetArn, {
    type: EdgeType.CROSS_ACCOUNT,
    confidence: 1,
    confirmed: true,
    inferenceMethod: 'cross_account_detector',
    provenance: 'inferred',
    kind: edge.kind,
    direction: edge.direction,
    drImpact: edge.drImpact,
    completeness: edge.completeness,
    sourceAccountId: edge.sourceAccountId,
    targetAccountId: edge.targetAccountId,
    missingAccountId: edge.missingAccountId,
    metadata: edge.metadata,
  });
}

function summarizeEdges(
  edges: readonly CrossAccountEdge[],
): CrossAccountDetectionResult['summary'] {
  const byKind = new Map<CrossAccountDependencyKind, number>(
    CROSS_ACCOUNT_DEPENDENCY_KINDS.map((kind) => [kind, 0] as const),
  );
  let complete = 0;
  let partial = 0;
  let critical = 0;
  let degraded = 0;
  let informational = 0;

  for (const edge of edges) {
    byKind.set(edge.kind, (byKind.get(edge.kind) ?? 0) + 1);
    if (edge.completeness === 'complete') {
      complete += 1;
    } else {
      partial += 1;
    }

    if (edge.drImpact === 'critical') {
      critical += 1;
    } else if (edge.drImpact === 'degraded') {
      degraded += 1;
    } else {
      informational += 1;
    }
  }

  return {
    total: edges.length,
    byKind,
    complete,
    partial,
    critical,
    degraded,
    informational,
  };
}

function withDetectedKinds(edge: CrossAccountEdge): CrossAccountEdge {
  return {
    ...edge,
    metadata: {
      ...edge.metadata,
      detectedByKinds: edge.metadata.detectedByKinds ?? [edge.kind],
    },
  };
}

function mergeEdges(
  existing: CrossAccountEdge,
  incoming: CrossAccountEdge,
): CrossAccountEdge {
  const existingKinds = existing.metadata.detectedByKinds ?? [existing.kind];
  const incomingKinds = incoming.metadata.detectedByKinds ?? [incoming.kind];
  const detectedByKinds = [...new Set([
    ...existingKinds,
    ...incomingKinds,
  ])];

  return {
    ...existing,
    direction: mergeDirection(existing.direction, incoming.direction),
    drImpact: mergeImpact(existing.drImpact, incoming.drImpact),
    completeness:
      existing.completeness === 'complete' || incoming.completeness === 'complete'
        ? 'complete'
        : 'partial',
    missingAccountId:
      existing.completeness === 'complete' || incoming.completeness === 'complete'
        ? undefined
        : existing.missingAccountId ?? incoming.missingAccountId,
    metadata: mergeMetadata(
      existing.metadata,
      incoming.metadata,
      detectedByKinds,
    ),
  };
}

function mergeMetadata(
  existing: CrossAccountEdgeMetadata,
  incoming: CrossAccountEdgeMetadata,
  detectedByKinds: readonly CrossAccountDependencyKind[],
): CrossAccountEdgeMetadata {
  const relatedDetections = mergeRelatedDetections(existing, incoming);

  switch (existing.kind) {
    case 'vpc_peering':
      return {
        ...existing,
        detectedByKinds,
        relatedDetections,
      };
    case 'transit_gateway':
      return {
        ...existing,
        detectedByKinds,
        relatedDetections,
      };
    case 'route53_shared_zone':
      return {
        ...existing,
        detectedByKinds,
        relatedDetections,
      };
    case 'vpc_endpoint_shared':
      return {
        ...existing,
        detectedByKinds,
        relatedDetections,
      };
    case 'iam_assume_role':
      if (incoming.kind !== 'iam_assume_role') {
        return {
          ...existing,
          detectedByKinds,
          relatedDetections,
        };
      }

      return {
        ...existing,
        detectedByKinds,
        relatedDetections,
        conditionKeys: [...new Set([
          ...existing.conditionKeys,
          ...incoming.conditionKeys,
        ])].sort(),
        organizationWide:
          existing.organizationWide || incoming.organizationWide,
        isWildcardPrincipal:
          existing.isWildcardPrincipal || incoming.isWildcardPrincipal,
      };
    case 'kms_cross_account_grant':
      if (incoming.kind !== 'kms_cross_account_grant') {
        return {
          ...existing,
          detectedByKinds,
          relatedDetections,
        };
      }

      return {
        ...existing,
        detectedByKinds,
        relatedDetections,
        operations: [...new Set([
          ...existing.operations,
          ...incoming.operations,
        ])],
        isRetiring: existing.isRetiring || incoming.isRetiring,
        constraints: mergeConstraints(existing.constraints, incoming.constraints),
        keyRotationEnabled:
          existing.keyRotationEnabled ?? incoming.keyRotationEnabled,
        relatedGrantIds: mergeUniqueValues(
          existing.relatedGrantIds,
          existing.grantId,
          incoming.relatedGrantIds,
          incoming.grantId,
        ),
      };
    case 'ram_share':
      if (incoming.kind !== 'ram_share') {
        return {
          ...existing,
          detectedByKinds,
          relatedDetections,
        };
      }

      return {
        ...existing,
        detectedByKinds,
        relatedDetections,
        organizationWide:
          existing.organizationWide || incoming.organizationWide,
        relatedShareArns: mergeUniqueValues(
          existing.relatedShareArns,
          existing.shareArn,
          incoming.relatedShareArns,
          incoming.shareArn,
        ),
      };
  }
}

function mergeRelatedDetections(
  existing: CrossAccountEdgeMetadata,
  incoming: CrossAccountEdgeMetadata,
): readonly CrossAccountRelatedDetection[] | undefined {
  const merged = new Map<string, CrossAccountRelatedDetection>();

  for (const related of existing.relatedDetections ?? []) {
    merged.set(`${related.kind}:${related.identity}`, related);
  }
  for (const related of incoming.relatedDetections ?? []) {
    merged.set(`${related.kind}:${related.identity}`, related);
  }

  const existingIdentity = getMetadataIdentity(existing);
  const incomingIdentity = getMetadataIdentity(incoming);
  if (existing.kind !== incoming.kind || existingIdentity !== incomingIdentity) {
    const detection = createRelatedDetection(incoming, incomingIdentity);
    merged.set(`${detection.kind}:${detection.identity}`, detection);
  }

  return merged.size > 0 ? [...merged.values()] : undefined;
}

function createRelatedDetection(
  metadata: CrossAccountEdgeMetadata,
  identity: string,
): CrossAccountRelatedDetection {
  return {
    kind: metadata.kind,
    identity,
    metadata: serializeMetadata(metadata),
  };
}

function serializeMetadata(
  metadata: CrossAccountEdgeMetadata,
): Readonly<Record<string, unknown>> {
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'detectedByKinds' || key === 'relatedDetections') {
      continue;
    }
    serialized[key] = value;
  }
  return serialized;
}

function mergeConstraints(
  left:
    | {
        readonly encryptionContextSubset?: Readonly<Record<string, string>>;
        readonly encryptionContextEquals?: Readonly<Record<string, string>>;
      }
    | undefined,
  right:
    | {
        readonly encryptionContextSubset?: Readonly<Record<string, string>>;
        readonly encryptionContextEquals?: Readonly<Record<string, string>>;
      }
    | undefined,
) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const encryptionContextSubset = mergeStringMaps(
    left.encryptionContextSubset,
    right.encryptionContextSubset,
  );
  const encryptionContextEquals = mergeStringMaps(
    left.encryptionContextEquals,
    right.encryptionContextEquals,
  );

  return {
    ...(encryptionContextSubset ? { encryptionContextSubset } : {}),
    ...(encryptionContextEquals ? { encryptionContextEquals } : {}),
  };
}

function mergeStringMaps(
  left: Readonly<Record<string, string>> | undefined,
  right: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (!left && !right) {
    return undefined;
  }

  return {
    ...(left ?? {}),
    ...(right ?? {}),
  };
}

function mergeUniqueValues(
  left: readonly string[] | undefined,
  leftCurrent: string,
  right: readonly string[] | undefined,
  rightCurrent: string,
): readonly string[] | undefined {
  const values = [...new Set([
    ...(left ?? []),
    leftCurrent,
    ...(right ?? []),
    rightCurrent,
  ])].filter((value) => value !== leftCurrent);

  return values.length > 0 ? values : undefined;
}

function mergeDirection(
  left: CrossAccountDependencyDirection,
  right: CrossAccountDependencyDirection,
): CrossAccountDependencyDirection {
  return left === 'bidirectional' || right === 'bidirectional'
    ? 'bidirectional'
    : 'unidirectional';
}

function mergeImpact(
  left: CrossAccountDrImpact,
  right: CrossAccountDrImpact,
): CrossAccountDrImpact {
  const order: Record<CrossAccountDrImpact, number> = {
    informational: 0,
    degraded: 1,
    critical: 2,
  };

  return order[left] >= order[right] ? left : right;
}

function buildGraphEdgeKey(edge: CrossAccountEdge): string {
  return `${edge.sourceArn}->${edge.targetArn}:cross_account`;
}

function buildPairKey(edge: CrossAccountEdge): string {
  return `${edge.sourceArn}:${edge.targetArn}`;
}

function getMetadataIdentity(metadata: CrossAccountEdgeMetadata): string {
  switch (metadata.kind) {
    case 'vpc_peering':
      return metadata.peeringConnectionId;
    case 'transit_gateway':
      return metadata.attachmentId;
    case 'route53_shared_zone':
      return metadata.vpcAssociationId;
    case 'vpc_endpoint_shared':
      return metadata.endpointId;
    case 'iam_assume_role':
      return `${metadata.roleArn}:${metadata.trustedPrincipal}`;
    case 'kms_cross_account_grant':
      return metadata.grantId;
    case 'ram_share':
      return `${metadata.shareArn}:${metadata.resourceArn}:${metadata.principalAccountId}`;
  }
}

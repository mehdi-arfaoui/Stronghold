import type { GraphInstance } from '../graph/graph-instance.js';
import type {
  AccountScanResult,
  MultiAccountScanResult,
} from '../orchestration/types.js';
import { EdgeType } from '../types/infrastructure.js';
import { Route53SharedZoneDetector } from './detectors/route53-shared-zone-detector.js';
import { TransitGatewayDetector } from './detectors/transit-gateway-detector.js';
import { VpcEndpointSharedDetector } from './detectors/vpc-endpoint-shared-detector.js';
import { VpcPeeringDetector } from './detectors/vpc-peering-detector.js';
import {
  CROSS_ACCOUNT_DEPENDENCY_KINDS,
  type CrossAccountDependencyKind,
  type CrossAccountDetectionResult,
  type CrossAccountEdge,
} from './types.js';

export interface SingleDetector {
  readonly kind: CrossAccountDependencyKind;
  detect(
    mergedGraph: GraphInstance,
    accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[];
}

/**
 * Orchestre tous les cross-account detectors sur le graphe unifié.
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
    ].filter((detector) => enabledKinds.has(detector.kind));
  }

  public detect(
    mergedGraph: GraphInstance,
    scanResult: MultiAccountScanResult,
  ): CrossAccountDetectionResult {
    const detectedEdges: CrossAccountEdge[] = [];
    const seenEdges = new Set<string>();

    for (const detector of this.detectors) {
      for (const edge of detector.detect(mergedGraph, scanResult.accounts)) {
        const edgeIdentity = buildEdgeIdentity(edge);
        if (seenEdges.has(edgeIdentity)) {
          continue;
        }

        seenEdges.add(edgeIdentity);
        detectedEdges.push(edge);
        materializeEdge(mergedGraph, edge);
      }
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

function buildGraphEdgeKey(edge: CrossAccountEdge): string {
  return `${edge.sourceArn}->${edge.targetArn}:cross_account:${getMetadataIdentity(edge)}`;
}

function buildEdgeIdentity(edge: CrossAccountEdge): string {
  return `${edge.kind}:${edge.sourceArn}:${edge.targetArn}:${getMetadataIdentity(edge)}`;
}

function getMetadataIdentity(edge: CrossAccountEdge): string {
  switch (edge.metadata.kind) {
    case 'vpc_peering':
      return edge.metadata.peeringConnectionId;
    case 'transit_gateway':
      return edge.metadata.attachmentId;
    case 'route53_shared_zone':
      return edge.metadata.vpcAssociationId;
    case 'vpc_endpoint_shared':
      return edge.metadata.endpointId;
  }
}

import type { GraphInstance } from '../../graph/graph-instance.js';
import type { AccountScanResult } from '../../orchestration/types.js';
import type { SingleDetector } from '../cross-account-detector.js';
import type { CrossAccountEdge } from '../types.js';
import {
  buildCrossAccountCompleteness,
  buildEc2Arn,
  buildLookupKey,
  collectNodes,
  getMetadata,
  getNodeAccountId,
  getNodePartition,
  getNodeRegion,
  isRecord,
  readRecordArray,
  readString,
} from './detector-utils.js';

export class VpcPeeringDetector implements SingleDetector {
  public readonly kind = 'vpc_peering' as const;

  public detect(
    mergedGraph: GraphInstance,
    _accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const vpcLookup = buildVpcLookup(mergedGraph);
    const edges: CrossAccountEdge[] = [];
    const seenConnections = new Set<string>();

    for (const peeringNode of collectNodes(mergedGraph, ['vpc-peering-connection'])) {
      const metadata = getMetadata(peeringNode.attrs);
      const peeringConnectionId =
        readString(metadata.peeringConnectionId) ??
        readString(metadata.connectionId) ??
        readString(metadata.vpcPeeringConnectionId);
      if (!peeringConnectionId || seenConnections.has(peeringConnectionId)) {
        continue;
      }

      const status = readPeeringStatus(metadata);
      if (status !== 'active') {
        continue;
      }

      const requesterOwnerId =
        readString(metadata.requesterOwnerId) ??
        readString(metadata.requesterVpcOwnerId);
      const accepterOwnerId =
        readString(metadata.accepterOwnerId) ??
        readString(metadata.accepterVpcOwnerId);
      const requesterVpcId =
        readString(metadata.requesterVpcId) ??
        readString(metadata.requesterVpcIdentifier);
      const accepterVpcId =
        readString(metadata.accepterVpcId) ??
        readString(metadata.accepterVpcIdentifier);
      if (
        !requesterOwnerId ||
        !accepterOwnerId ||
        !requesterVpcId ||
        !accepterVpcId ||
        requesterOwnerId === accepterOwnerId
      ) {
        continue;
      }

      seenConnections.add(peeringConnectionId);

      const partition = getNodePartition(peeringNode.arn, peeringNode.attrs);
      const requesterRegion =
        readString(metadata.requesterRegion) ??
        getNodeRegion(peeringNode.arn, peeringNode.attrs);
      const accepterRegion =
        readString(metadata.accepterRegion) ??
        getNodeRegion(peeringNode.arn, peeringNode.attrs);
      const requesterArn =
        vpcLookup.get(buildLookupKey(requesterOwnerId, requesterVpcId)) ??
        buildEc2Arn(partition, requesterRegion, requesterOwnerId, 'vpc', requesterVpcId);
      const accepterArn =
        vpcLookup.get(buildLookupKey(accepterOwnerId, accepterVpcId)) ??
        buildEc2Arn(partition, accepterRegion, accepterOwnerId, 'vpc', accepterVpcId);

      edges.push(
        buildCrossAccountCompleteness(mergedGraph, {
          sourceArn: requesterArn,
          sourceAccountId: requesterOwnerId,
          targetArn: accepterArn,
          targetAccountId: accepterOwnerId,
          kind: 'vpc_peering',
          direction: 'bidirectional',
          drImpact: inferPeeringImpact(metadata),
          metadata: {
            kind: 'vpc_peering',
            peeringConnectionId,
            requesterVpcId,
            accepterVpcId,
            status,
          },
        }),
      );
    }

    return edges;
  }
}

function buildVpcLookup(graph: GraphInstance): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const node of collectNodes(graph, ['vpc'])) {
    const accountId = getNodeAccountId(node.attrs);
    const metadata = getMetadata(node.attrs);
    const vpcId =
      readString(metadata.vpcId) ??
      readString(node.attrs.resourceId) ??
      readString(metadata.resourceId);
    if (!accountId || !vpcId) {
      continue;
    }

    lookup.set(buildLookupKey(accountId, vpcId), node.arn);
  }
  return lookup;
}

function readPeeringStatus(metadata: Record<string, unknown>): string | null {
  const direct =
    readString(metadata.status) ??
    readString(metadata.statusCode);
  if (direct) {
    return direct.toLowerCase();
  }

  if (!isRecord(metadata.status)) {
    return null;
  }

  return readString(metadata.status.Code)?.toLowerCase() ?? null;
}

function inferPeeringImpact(
  metadata: Record<string, unknown>,
): CrossAccountEdge['drImpact'] {
  // Heuristic: once route tables actively reference the peering, it is part of
  // the data path and should be treated as DR-critical.
  const routeTableIds = readStringArrayCandidate(metadata.routeTableIds);
  const routeUsageCount =
    readNumericCandidate(metadata.routeUsageCount) ??
    readNumericCandidate(metadata.routeCount);
  const routes = readRecordArray(metadata.routes);

  return routeTableIds.length > 0 || routes.length > 0 || (routeUsageCount ?? 0) > 0
    ? 'critical'
    : 'informational';
}

function readStringArrayCandidate(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null);
}

function readNumericCandidate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

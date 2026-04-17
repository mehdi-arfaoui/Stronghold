import type { GraphInstance } from '../../graph/graph-instance.js';
import type { AccountScanResult } from '../../orchestration/types.js';
import type { SingleDetector } from '../cross-account-detector.js';
import type { CrossAccountEdge } from '../types.js';
import {
  buildCrossAccountCompleteness,
  buildEc2Arn,
  buildLookupKey,
  collectNodes,
  detectEnvironmentLabel,
  getMetadata,
  getNodeAccountId,
  getNodeName,
  getNodePartition,
  getNodeRegion,
  getNodeTags,
  isMonitoringLike,
  readString,
} from './detector-utils.js';

export class TransitGatewayDetector implements SingleDetector {
  public readonly kind = 'transit_gateway' as const;

  public detect(
    mergedGraph: GraphInstance,
    _accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const tgwLookup = buildTransitGatewayLookup(mergedGraph);
    const edges: CrossAccountEdge[] = [];

    for (const attachmentNode of collectNodes(mergedGraph, ['transit-gateway-attachment'])) {
      const metadata = getMetadata(attachmentNode.attrs);
      const attachmentId =
        readString(metadata.attachmentId) ??
        readString(metadata.transitGatewayAttachmentId) ??
        readString(attachmentNode.attrs.resourceId);
      const tgwId =
        readString(metadata.tgwId) ??
        readString(metadata.transitGatewayId);
      const attachmentOwnerId = getNodeAccountId(attachmentNode.attrs);
      const tgwOwnerId =
        readString(metadata.tgwOwnerId) ??
        readString(metadata.transitGatewayOwnerId);
      if (
        !attachmentId ||
        !tgwId ||
        !attachmentOwnerId ||
        !tgwOwnerId ||
        attachmentOwnerId === tgwOwnerId ||
        isInactiveAttachment(metadata)
      ) {
        continue;
      }

      const partition = getNodePartition(attachmentNode.arn, attachmentNode.attrs);
      const region = getNodeRegion(attachmentNode.arn, attachmentNode.attrs);
      const targetArn =
        tgwLookup.get(buildLookupKey(tgwOwnerId, tgwId)) ??
        buildEc2Arn(partition, region, tgwOwnerId, 'transit-gateway', tgwId);
      const targetAttrs = mergedGraph.hasNode(targetArn)
        ? mergedGraph.getNodeAttributes(targetArn)
        : null;

      edges.push(
        buildCrossAccountCompleteness(mergedGraph, {
          sourceArn: attachmentNode.arn,
          sourceAccountId: attachmentOwnerId,
          targetArn,
          targetAccountId: tgwOwnerId,
          kind: 'transit_gateway',
          direction: 'unidirectional',
          drImpact: inferTransitGatewayImpact(attachmentNode.attrs, targetAttrs, metadata),
          metadata: {
            kind: 'transit_gateway',
            tgwId,
            attachmentId,
            attachmentType:
              readString(metadata.attachmentType) ??
              readString(metadata.resourceType) ??
              'unknown',
          },
        }),
      );
    }

    return edges;
  }
}

function buildTransitGatewayLookup(graph: GraphInstance): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const node of collectNodes(graph, ['transit-gateway'])) {
    const accountId = getNodeAccountId(node.attrs);
    const metadata = getMetadata(node.attrs);
    const tgwId =
      readString(metadata.tgwId) ??
      readString(metadata.transitGatewayId) ??
      readString(node.attrs.resourceId);
    if (!accountId || !tgwId) {
      continue;
    }

    lookup.set(buildLookupKey(accountId, tgwId), node.arn);
  }
  return lookup;
}

function inferTransitGatewayImpact(
  attachmentAttrs: Record<string, unknown>,
  targetAttrs: Record<string, unknown> | null,
  metadata: Record<string, unknown>,
): CrossAccountEdge['drImpact'] {
  if (!hasActiveRouteTable(metadata)) {
    return 'informational';
  }

  const attachmentTags = getNodeTags(attachmentAttrs);
  const targetTags = targetAttrs ? getNodeTags(targetAttrs) : {};
  const tagValues = [
    ...Object.values(attachmentTags),
    ...Object.values(targetTags),
  ];
  const names = [
    getNodeName(attachmentAttrs),
    targetAttrs ? getNodeName(targetAttrs) : null,
    readString(metadata.attachmentType),
  ];

  // Heuristic: monitoring and logging transit fabrics are useful context but
  // rarely block the primary recovery path.
  if (isMonitoringLike([...names, ...tagValues])) {
    return 'informational';
  }

  // Heuristic: non-production environment labels usually indicate a degraded
  // dependency rather than a hard recovery blocker.
  const environment = detectEnvironmentLabel([
    ...names,
    ...tagValues,
  ]);
  if (environment === 'nonproduction') {
    return 'degraded';
  }

  return 'critical';
}

function hasActiveRouteTable(metadata: Record<string, unknown>): boolean {
  const associationState =
    readString(metadata.associationState) ??
    readString(metadata.routeTableAssociationState);
  if (associationState?.toLowerCase() === 'associated') {
    return true;
  }

  return (
    readString(metadata.routeTableId) !== null ||
    readString(metadata.transitGatewayRouteTableId) !== null
  );
}

function isInactiveAttachment(metadata: Record<string, unknown>): boolean {
  const state = (
    readString(metadata.state) ??
    readString(metadata.status)
  )?.toLowerCase();

  return state === 'deleted' || state === 'deleting' || state === 'failed' || state === 'rejected';
}

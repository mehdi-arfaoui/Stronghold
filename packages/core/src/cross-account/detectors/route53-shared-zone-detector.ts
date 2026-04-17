import type { GraphInstance } from '../../graph/graph-instance.js';
import type { AccountScanResult } from '../../orchestration/types.js';
import type { SingleDetector } from '../cross-account-detector.js';
import type { CrossAccountEdge } from '../types.js';
import {
  buildCrossAccountCompleteness,
  buildEc2Arn,
  buildLookupKey,
  buildRoute53HostedZoneArn,
  collectNodes,
  getMetadata,
  getNodeAccountId,
  getNodeName,
  getNodePartition,
  getNodeRegion,
  isDataServiceLike,
  readBoolean,
  readNumber,
  readRecordArray,
  readString,
  readStringArray,
} from './detector-utils.js';

export class Route53SharedZoneDetector implements SingleDetector {
  public readonly kind = 'route53_shared_zone' as const;

  public detect(
    mergedGraph: GraphInstance,
    _accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const vpcLookup = buildVpcLookup(mergedGraph);
    const edges: CrossAccountEdge[] = [];

    for (const zoneNode of collectNodes(mergedGraph, ['hostedzone'])) {
      const metadata = getMetadata(zoneNode.attrs);
      if (!(readBoolean(metadata.isPrivate) ?? readBoolean(metadata.privateZone) ?? false)) {
        continue;
      }

      const zoneAccountId = getNodeAccountId(zoneNode.attrs);
      const hostedZoneId =
        readString(metadata.hostedZoneId) ??
        readString(zoneNode.attrs.resourceId);
      if (!zoneAccountId || !hostedZoneId) {
        continue;
      }

      const partition = getNodePartition(zoneNode.arn, zoneNode.attrs);
      const zoneArn = mergedGraph.hasNode(zoneNode.arn)
        ? zoneNode.arn
        : buildRoute53HostedZoneArn(partition, hostedZoneId);

      for (const association of readAssociations(metadata)) {
        const vpcId = readString(association.vpcId);
        const vpcAccountId =
          readString(association.vpcOwnerId) ??
          readString(association.accountId);
        if (!vpcId || !vpcAccountId || vpcAccountId === zoneAccountId) {
          continue;
        }

        const vpcRegion =
          readString(association.vpcRegion) ??
          readString(association.region) ??
          getNodeRegion(zoneNode.arn, zoneNode.attrs);
        const vpcArn =
          vpcLookup.get(buildLookupKey(vpcAccountId, vpcId)) ??
          buildEc2Arn(partition, vpcRegion, vpcAccountId, 'vpc', vpcId);

        edges.push(
          buildCrossAccountCompleteness(mergedGraph, {
            sourceArn: vpcArn,
            sourceAccountId: vpcAccountId,
            targetArn: zoneArn,
            targetAccountId: zoneAccountId,
            kind: 'route53_shared_zone',
            direction: 'unidirectional',
            drImpact: inferSharedZoneImpact(zoneNode.attrs, metadata),
            metadata: {
              kind: 'route53_shared_zone',
              hostedZoneId,
              zoneName: readString(metadata.name) ?? getNodeName(zoneNode.attrs) ?? hostedZoneId,
              vpcAssociationId:
                readString(association.vpcAssociationId) ??
                `${hostedZoneId}:${vpcId}`,
            },
          }),
        );
      }
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
      readString(node.attrs.resourceId);
    if (!accountId || !vpcId) {
      continue;
    }

    lookup.set(buildLookupKey(accountId, vpcId), node.arn);
  }
  return lookup;
}

function readAssociations(
  metadata: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  return [
    ...readRecordArray(metadata.vpcAssociations),
    ...readRecordArray(metadata.associatedVpcs),
    ...readRecordArray(metadata.vpcs),
  ];
}

function inferSharedZoneImpact(
  zoneAttrs: Record<string, unknown>,
  metadata: Record<string, unknown>,
): CrossAccountEdge['drImpact'] {
  const recordCount = readNumber(metadata.recordCount) ?? 0;
  const criticalHints = [
    getNodeName(zoneAttrs),
    readString(metadata.name),
    ...extractRecordHints(metadata),
  ];

  // Heuristic: larger private zones usually underpin service discovery and
  // internal endpoint routing, so outages tend to become recovery blockers.
  if (recordCount > 10 || isDataServiceLike(criticalHints)) {
    return 'critical';
  }

  return 'degraded';
}

function extractRecordHints(metadata: Record<string, unknown>): readonly string[] {
  return [
    ...readStringArray(metadata.recordNames),
    ...readStringArray(metadata.recordSetNames),
  ];
}

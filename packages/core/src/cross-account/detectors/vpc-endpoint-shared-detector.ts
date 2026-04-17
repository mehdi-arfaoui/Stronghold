import type { GraphInstance } from '../../graph/graph-instance.js';
import type { AccountScanResult } from '../../orchestration/types.js';
import type { SingleDetector } from '../cross-account-detector.js';
import type { CrossAccountEdge } from '../types.js';
import {
  buildArn,
  buildCrossAccountCompleteness,
  buildEc2Arn,
  buildLookupKey,
  collectNodes,
  getMetadata,
  getNodeAccountId,
  getNodeName,
  getNodePartition,
  getNodeRegion,
  getNodeTags,
  isDataServiceLike,
  isMonitoringLike,
  readString,
} from './detector-utils.js';

export class VpcEndpointSharedDetector implements SingleDetector {
  public readonly kind = 'vpc_endpoint_shared' as const;

  public detect(
    mergedGraph: GraphInstance,
    _accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const vpcLookup = buildVpcLookup(mergedGraph);
    const serviceLookup = buildServiceLookup(mergedGraph);
    const edges: CrossAccountEdge[] = [];

    for (const endpointNode of collectNodes(mergedGraph, ['vpc-endpoint'])) {
      const metadata = getMetadata(endpointNode.attrs);
      const endpointType =
        readString(metadata.endpointType) ??
        readString(metadata.vpcEndpointType) ??
        readString(metadata.type);
      if (endpointType?.toLowerCase() !== 'interface') {
        continue;
      }

      const endpointId =
        readString(metadata.endpointId) ??
        readString(metadata.vpcEndpointId) ??
        readString(endpointNode.attrs.resourceId);
      const consumerAccountId = getNodeAccountId(endpointNode.attrs);
      const vpcId = readString(metadata.vpcId);
      const serviceName = readString(metadata.serviceName);
      const providerAccountId =
        readString(metadata.serviceOwnerId) ??
        extractAccountIdFromServiceName(serviceName);
      if (
        !endpointId ||
        !consumerAccountId ||
        !vpcId ||
        !serviceName ||
        !providerAccountId ||
        providerAccountId === consumerAccountId
      ) {
        continue;
      }

      const partition = getNodePartition(endpointNode.arn, endpointNode.attrs);
      const region = getNodeRegion(endpointNode.arn, endpointNode.attrs);
      const serviceId = extractServiceId(serviceName);
      const sourceArn =
        vpcLookup.get(buildLookupKey(consumerAccountId, vpcId)) ??
        buildEc2Arn(partition, region, consumerAccountId, 'vpc', vpcId);
      const targetArn =
        serviceLookup.get(buildLookupKey(providerAccountId, serviceId)) ??
        buildArn({
          partition,
          service: 'ec2',
          region,
          accountId: providerAccountId,
          resourceType: 'vpc-endpoint-service',
          resourceId: serviceId,
        });
      const targetAttrs = mergedGraph.hasNode(targetArn)
        ? mergedGraph.getNodeAttributes(targetArn)
        : null;

      edges.push(
        buildCrossAccountCompleteness(mergedGraph, {
          sourceArn,
          sourceAccountId: consumerAccountId,
          targetArn,
          targetAccountId: providerAccountId,
          kind: 'vpc_endpoint_shared',
          direction: 'unidirectional',
          drImpact: inferVpcEndpointImpact(endpointNode.attrs, targetAttrs, serviceName),
          metadata: {
            kind: 'vpc_endpoint_shared',
            endpointId,
            serviceName,
            vpcId,
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
      readString(node.attrs.resourceId);
    if (!accountId || !vpcId) {
      continue;
    }

    lookup.set(buildLookupKey(accountId, vpcId), node.arn);
  }
  return lookup;
}

function buildServiceLookup(graph: GraphInstance): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const node of collectNodes(graph, ['vpc-endpoint-service'])) {
    const accountId = getNodeAccountId(node.attrs);
    const metadata = getMetadata(node.attrs);
    const serviceId =
      readString(metadata.serviceId) ??
      readString(metadata.vpcEndpointServiceId) ??
      readString(node.attrs.resourceId);
    if (!accountId || !serviceId) {
      continue;
    }

    lookup.set(buildLookupKey(accountId, serviceId), node.arn);
  }
  return lookup;
}

function inferVpcEndpointImpact(
  endpointAttrs: Record<string, unknown>,
  serviceAttrs: Record<string, unknown> | null,
  serviceName: string,
): CrossAccountEdge['drImpact'] {
  const tagValues = Object.values(getNodeTags(endpointAttrs));
  const serviceTagValues = serviceAttrs ? Object.values(getNodeTags(serviceAttrs)) : [];
  const names = [
    getNodeName(endpointAttrs),
    serviceAttrs ? getNodeName(serviceAttrs) : null,
    serviceName,
  ];

  // Heuristic: PrivateLink services that look like data-plane backends are
  // recovery critical because they usually gate application reads and writes.
  if (isDataServiceLike([...names, ...tagValues, ...serviceTagValues])) {
    return 'critical';
  }

  // Heuristic: observability-only services degrade operations, but they are
  // rarely the direct blocker for restoring customer traffic.
  if (isMonitoringLike([...names, ...tagValues, ...serviceTagValues])) {
    return 'degraded';
  }

  return 'degraded';
}

function extractAccountIdFromServiceName(serviceName: string | null): string | null {
  if (!serviceName) {
    return null;
  }

  const match = serviceName.match(/\b(\d{12})\b/);
  return match?.[1] ?? null;
}

function extractServiceId(serviceName: string): string {
  const match = serviceName.match(/vpce-svc-[a-z0-9-]+/i);
  if (match?.[0]) {
    return match[0];
  }

  const segments = serviceName.split('.');
  return segments[segments.length - 1] ?? serviceName;
}

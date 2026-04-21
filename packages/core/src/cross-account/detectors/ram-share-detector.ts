import type { GraphInstance } from '../../graph/graph-instance.js';
import { tryParseArn } from '../../identity/index.js';
import type { AccountScanResult } from '../../orchestration/types.js';
import type { SingleDetector } from '../cross-account-detector.js';
import type { CrossAccountEdge } from '../types.js';
import {
  buildCrossAccountCompleteness,
  buildIamRootArn,
  buildLookupKey,
  collectNodes,
  getMetadata,
  getNodeAccountId,
  getNodePartition,
  readRecordArray,
  readString,
} from './detector-utils.js';

interface ResolvedRamPrincipal {
  readonly accountId: string;
  readonly organizationWide: boolean;
}

const RAM_SOURCE_TYPES = new Set(['ram_resource_share']);
const ACTIVE_SHARE_STATUSES = new Set(['associated', 'associating']);

export class RamShareDetector implements SingleDetector {
  public readonly kind = 'ram_share' as const;

  public detect(
    mergedGraph: GraphInstance,
    accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const scannedAccountIds = new Set(
      accountResults.map((result) => result.account.accountId),
    );
    const attachmentLookup = buildTransitGatewayAttachmentLookup(mergedGraph);
    const edges = new Map<string, CrossAccountEdge>();

    for (const shareNode of collectNodes(mergedGraph, ['ram-resource-share', 'resource-share'])) {
      if (!isRamShareNode(shareNode.arn, shareNode.attrs)) {
        continue;
      }

      const metadata = getMetadata(shareNode.attrs);
      const shareAccountId = getNodeAccountId(shareNode.attrs);
      const shareArn =
        readString(metadata.resourceShareArn) ??
        readString(metadata.shareArn) ??
        shareNode.arn;
      if (!shareAccountId || !shareArn || isInactiveStatus(readString(metadata.status))) {
        continue;
      }

      const partition = getNodePartition(shareNode.arn, shareNode.attrs);
      for (const principal of resolvePrincipals(metadata, shareAccountId, scannedAccountIds)) {
        for (const resource of readSharedResources(metadata)) {
          const resourceArn =
            readString(resource.resourceArn) ??
            readString(resource.arn);
          const resourceType =
            readString(resource.resourceType) ??
            readString(resource.type) ??
            tryParseArn(resourceArn ?? '')?.resourceType;
          const status =
            readString(resource.status) ??
            readString(resource.associationStatus) ??
            readString(metadata.status) ??
            'ASSOCIATED';
          if (!resourceArn || !resourceType || !isActiveStatus(status)) {
            continue;
          }

          const sourceArns = resolveSourceArns(
            attachmentLookup,
            partition,
            principal.accountId,
            resourceArn,
            resourceType,
          );
          for (const sourceArn of sourceArns) {
            mergeRamEdge(
              edges,
              buildCrossAccountCompleteness(mergedGraph, {
                sourceArn,
                sourceAccountId: principal.accountId,
                targetArn: resourceArn,
                targetAccountId: shareAccountId,
                kind: 'ram_share',
                direction: 'unidirectional',
                drImpact: inferRamImpact(resourceType),
                metadata: {
                  kind: 'ram_share',
                  shareArn,
                  resourceArn,
                  resourceType,
                  principalAccountId: principal.accountId,
                  status,
                  ...(principal.organizationWide ? { organizationWide: true } : {}),
                },
              }),
            );
          }
        }
      }
    }

    return [...edges.values()];
  }
}

function isRamShareNode(
  nodeArn: string,
  attrs: Record<string, unknown>,
): boolean {
  const parsed = tryParseArn(nodeArn);
  if (parsed?.service === 'ram' && parsed.resourceType === 'resource-share') {
    return true;
  }

  const sourceType = readString(getMetadata(attrs).sourceType)?.toLowerCase();
  return sourceType !== undefined && RAM_SOURCE_TYPES.has(sourceType);
}

function resolvePrincipals(
  metadata: Record<string, unknown>,
  shareAccountId: string,
  scannedAccountIds: ReadonlySet<string>,
): readonly ResolvedRamPrincipal[] {
  const resolved: ResolvedRamPrincipal[] = [];
  const seen = new Set<string>();

  for (const principal of readPrincipalRecords(metadata)) {
    const rawPrincipal =
      readString(principal.principalAccountId) ??
      readString(principal.accountId) ??
      readString(principal.principal) ??
      readString(principal.principalId) ??
      readString(principal.id);
    const status =
      readString(principal.status) ??
      readString(principal.associationStatus) ??
      readString(metadata.status) ??
      'ASSOCIATED';
    if (!rawPrincipal || !isActiveStatus(status)) {
      continue;
    }

    if (/^\d{12}$/.test(rawPrincipal)) {
      addPrincipal(resolved, seen, rawPrincipal, false, shareAccountId);
      continue;
    }

    if (rawPrincipal.startsWith('o-')) {
      for (const accountId of scannedAccountIds) {
        addPrincipal(resolved, seen, accountId, true, shareAccountId);
      }
    }
  }

  return resolved;
}

function addPrincipal(
  target: ResolvedRamPrincipal[],
  seen: Set<string>,
  accountId: string,
  organizationWide: boolean,
  shareAccountId: string,
): void {
  if (accountId === shareAccountId || seen.has(accountId)) {
    return;
  }

  seen.add(accountId);
  target.push({
    accountId,
    organizationWide,
  });
}

function readPrincipalRecords(
  metadata: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const candidates = [
    metadata.principals,
    metadata.associatedPrincipals,
    metadata.principalAssociations,
    metadata.sharePrincipals,
  ];

  for (const candidate of candidates) {
    const principals = readRecordArray(candidate);
    if (principals.length > 0) {
      return principals;
    }
  }

  const directPrincipal = readString(metadata.principalAccountId);
  return directPrincipal
    ? [{ principalAccountId: directPrincipal }]
    : [];
}

function readSharedResources(
  metadata: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const candidates = [
    metadata.resources,
    metadata.sharedResources,
    metadata.resourceAssociations,
  ];

  for (const candidate of candidates) {
    const resources = readRecordArray(candidate);
    if (resources.length > 0) {
      return resources;
    }
  }

  const directResourceArn = readString(metadata.resourceArn);
  if (!directResourceArn) {
    return [];
  }

  return [{
    resourceArn: directResourceArn,
    resourceType: readString(metadata.resourceType) ?? tryParseArn(directResourceArn)?.resourceType,
    status: readString(metadata.status) ?? 'ASSOCIATED',
  }];
}

function buildTransitGatewayAttachmentLookup(
  graph: GraphInstance,
): ReadonlyMap<string, readonly string[]> {
  const lookup = new Map<string, string[]>();

  for (const node of collectNodes(graph, ['transit-gateway-attachment'])) {
    const accountId = getNodeAccountId(node.attrs);
    const metadata = getMetadata(node.attrs);
    const tgwId =
      readString(metadata.tgwId) ??
      readString(metadata.transitGatewayId);
    if (!accountId || !tgwId) {
      continue;
    }

    const key = buildLookupKey(accountId, tgwId);
    const existing = lookup.get(key) ?? [];
    existing.push(node.arn);
    lookup.set(key, existing);
  }

  return lookup;
}

function resolveSourceArns(
  attachmentLookup: ReadonlyMap<string, readonly string[]>,
  partition: string,
  principalAccountId: string,
  resourceArn: string,
  resourceType: string,
): readonly string[] {
  const parsedResource = tryParseArn(resourceArn);
  if (
    parsedResource?.service === 'ec2' &&
    normalizeType(resourceType) === 'transit-gateway'
  ) {
    const attachments = attachmentLookup.get(
      buildLookupKey(principalAccountId, parsedResource.resourceId),
    );
    if (attachments && attachments.length > 0) {
      return attachments;
    }
  }

  return [buildIamRootArn(partition, principalAccountId)];
}

function inferRamImpact(
  resourceType: string,
): CrossAccountEdge['drImpact'] {
  const normalized = normalizeType(resourceType);
  if (normalized.includes('subnet') || normalized.includes('transit-gateway')) {
    return 'critical';
  }

  if (normalized.includes('resolver-rule')) {
    return 'degraded';
  }

  return 'degraded';
}

function mergeRamEdge(
  target: Map<string, CrossAccountEdge>,
  edge: CrossAccountEdge,
): void {
  const key = `${edge.sourceArn}:${edge.targetArn}:${edge.kind}`;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, edge);
    return;
  }

  if (existing.metadata.kind !== 'ram_share' || edge.metadata.kind !== 'ram_share') {
    target.set(key, edge);
    return;
  }

  const existingMetadata = existing.metadata;
  const edgeMetadata = edge.metadata;
  const relatedShareArns = [...new Set([
    ...(existingMetadata.relatedShareArns ?? []),
    existingMetadata.shareArn,
    edgeMetadata.shareArn,
  ])].filter((shareArn) => shareArn !== existingMetadata.shareArn);

  target.set(key, {
    ...existing,
    drImpact: mergeImpact(existing.drImpact, edge.drImpact),
    metadata: {
      ...existingMetadata,
      status: existingMetadata.status,
      organizationWide:
        existingMetadata.organizationWide || edgeMetadata.organizationWide,
      relatedShareArns: relatedShareArns.length > 0 ? relatedShareArns : undefined,
    },
    completeness:
      existing.completeness === 'complete' || edge.completeness === 'complete'
        ? 'complete'
        : 'partial',
    missingAccountId:
      existing.completeness === 'complete' || edge.completeness === 'complete'
        ? undefined
        : existing.missingAccountId ?? edge.missingAccountId,
  });
}

function isActiveStatus(status: string): boolean {
  return ACTIVE_SHARE_STATUSES.has(status.trim().toLowerCase());
}

function isInactiveStatus(status: string | null): boolean {
  if (!status) {
    return false;
  }

  return status.trim().toLowerCase() === 'disassociated';
}

function normalizeType(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function mergeImpact(
  left: CrossAccountEdge['drImpact'],
  right: CrossAccountEdge['drImpact'],
): CrossAccountEdge['drImpact'] {
  const order: Record<CrossAccountEdge['drImpact'], number> = {
    informational: 0,
    degraded: 1,
    critical: 2,
  };

  return order[left] >= order[right] ? left : right;
}

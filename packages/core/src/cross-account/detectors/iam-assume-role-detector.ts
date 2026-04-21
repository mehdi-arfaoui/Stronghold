import type { GraphInstance } from '../../graph/graph-instance.js';
import { tryParseArn } from '../../identity/index.js';
import type { AccountScanResult } from '../../orchestration/types.js';
import type { SingleDetector } from '../cross-account-detector.js';
import type { CrossAccountEdge } from '../types.js';
import {
  buildCrossAccountCompleteness,
  buildPrincipalArn,
  collectNodes,
  extractAccountIdFromPrincipal,
  getMetadata,
  getNodeAccountId,
  getNodeName,
  getNodePartition,
  getNodeTags,
  isMonitoringLike,
  readConditionAccountIds,
  readConditionKeys,
  readConditionValues,
  readPolicyActions,
  readPolicyPrincipalEntries,
  readPolicyStatements,
  readRecordArray,
  readString,
  readStringArray,
} from './detector-utils.js';

interface ResolvedTrustedPrincipal {
  readonly principalArn: string;
  readonly accountId: string;
  readonly trustedPrincipal: string;
  readonly isWildcardPrincipal: boolean;
  readonly organizationWide: boolean;
}

const IAM_ROLE_SOURCE_TYPES = new Set(['iam_role']);
const ROLE_MONITORING_HINT_KEYS = [
  'roleName',
  'path',
  'description',
  'serviceName',
] as const;
const EXTERNAL_ID_CONDITION_KEYS = ['sts:externalid'] as const;
const ORGANIZATION_CONDITION_KEYS = ['aws:principalorgid'] as const;
const COMPUTE_HINTS = [
  'lambda',
  'ecs',
  'eks',
  'ec2',
  'task',
  'execution',
  'instance',
  'node',
  'cluster',
  'service-role',
] as const;

export class IamAssumeRoleDetector implements SingleDetector {
  public readonly kind = 'iam_assume_role' as const;

  public detect(
    mergedGraph: GraphInstance,
    accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const scannedAccountIds = new Set(
      accountResults.map((result) => result.account.accountId),
    );
    const policyCache = new Map<string, Record<string, unknown> | null>();
    const edges: CrossAccountEdge[] = [];

    for (const roleNode of collectNodes(mergedGraph, ['iam-role', 'role'])) {
      if (!isIamRoleNode(roleNode.arn, roleNode.attrs)) {
        continue;
      }

      const roleAccountId = getNodeAccountId(roleNode.attrs);
      if (!roleAccountId) {
        continue;
      }

      const metadata = getMetadata(roleNode.attrs);
      if (isServiceLinkedRole(roleNode.arn, roleNode.attrs, metadata)) {
        continue;
      }

      const partition = getNodePartition(roleNode.arn, roleNode.attrs);
      for (const statement of readTrustPolicyStatements(metadata, policyCache)) {
        if (!isAllowAssumeRoleStatement(statement)) {
          continue;
        }

        const condition = statement.Condition;
        const conditionKeys = readConditionKeys(condition);
        for (const principal of resolveTrustedPrincipals(
          statement.Principal,
          condition,
          partition,
          roleAccountId,
          scannedAccountIds,
        )) {
          edges.push(
            buildCrossAccountCompleteness(mergedGraph, {
              sourceArn: principal.principalArn,
              sourceAccountId: principal.accountId,
              targetArn: roleNode.arn,
              targetAccountId: roleAccountId,
              kind: 'iam_assume_role',
              direction: 'unidirectional',
              drImpact: inferRoleImpact(roleNode.attrs, metadata),
              metadata: {
                kind: 'iam_assume_role',
                roleArn: roleNode.arn,
                trustedPrincipal: principal.trustedPrincipal,
                conditionKeys,
                isServiceLinked: false,
                sessionPolicyMayRestrict: true,
                ...(principal.organizationWide ? { organizationWide: true } : {}),
                ...(principal.isWildcardPrincipal ? { isWildcardPrincipal: true } : {}),
              },
            }),
          );
        }
      }
    }

    return dedupeIamEdges(edges);
  }
}

function isIamRoleNode(
  nodeArn: string,
  attrs: Record<string, unknown>,
): boolean {
  const parsed = tryParseArn(nodeArn);
  if (parsed?.service === 'iam' && parsed.resourceType === 'role') {
    return true;
  }

  const sourceType = readString(getMetadata(attrs).sourceType)?.toLowerCase();
  return sourceType !== undefined && IAM_ROLE_SOURCE_TYPES.has(sourceType);
}

function readTrustPolicyStatements(
  metadata: Record<string, unknown>,
  cache: Map<string, Record<string, unknown> | null>,
): readonly Record<string, unknown>[] {
  // TODO: if the IAM scanner does not project the trust policy into graph
  // metadata, the detector stays silent instead of trying to infer it.
  const candidates = [
    metadata.assumeRolePolicyDocument,
    metadata.AssumeRolePolicyDocument,
    metadata.trustPolicyDocument,
    metadata.trustPolicy,
    metadata.policyDocument,
  ];

  for (const candidate of candidates) {
    const statements = readPolicyStatements(candidate, cache);
    if (statements.length > 0) {
      return statements;
    }
  }

  return [];
}

function isAllowAssumeRoleStatement(statement: Record<string, unknown>): boolean {
  const effect = readString(statement.Effect)?.toLowerCase();
  if (effect !== 'allow') {
    return false;
  }

  const actions = readPolicyActions(statement.Action ?? statement.Actions);
  return actions.some((action) => matchesAssumeRoleAction(action));
}

function matchesAssumeRoleAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  return normalized === '*' ||
    normalized === 'sts:assumerole' ||
    normalized === 'sts:*';
}

function resolveTrustedPrincipals(
  principalValue: unknown,
  conditionValue: unknown,
  partition: string,
  roleAccountId: string,
  scannedAccountIds: ReadonlySet<string>,
): readonly ResolvedTrustedPrincipal[] {
  const resolved: ResolvedTrustedPrincipal[] = [];
  const seen = new Set<string>();
  const conditionAccountIds = readConditionAccountIds(conditionValue);
  const organizationWide =
    readConditionValues(conditionValue, ORGANIZATION_CONDITION_KEYS).length > 0;
  const hasExternalId =
    readConditionValues(conditionValue, EXTERNAL_ID_CONDITION_KEYS).length > 0;

  for (const entry of readPolicyPrincipalEntries(principalValue)) {
    if (entry.type === 'service' || entry.type === 'canonical' || entry.type === 'federated') {
      continue;
    }

    if (entry.type === 'wildcard') {
      const wildcardAccounts = conditionAccountIds.length > 0
        ? conditionAccountIds
        : [...scannedAccountIds].filter((accountId) => accountId !== roleAccountId);

      if (organizationWide || hasExternalId || conditionAccountIds.length > 0 || wildcardAccounts.length > 0) {
        for (const accountId of wildcardAccounts) {
          addResolvedPrincipal(
            resolved,
            seen,
            partition,
            accountId,
            entry.value,
            true,
            organizationWide,
          );
        }
      }
      continue;
    }

    const accountId = extractAccountIdFromPrincipal(entry.value);
    if (!accountId || accountId === roleAccountId) {
      continue;
    }

    addResolvedPrincipal(
      resolved,
      seen,
      partition,
      accountId,
      entry.value,
      false,
      organizationWide,
    );
  }

  return resolved;
}

function addResolvedPrincipal(
  target: ResolvedTrustedPrincipal[],
  seen: Set<string>,
  partition: string,
  accountId: string,
  trustedPrincipal: string,
  isWildcardPrincipal: boolean,
  organizationWide: boolean,
): void {
  const principalArn = buildPrincipalArn(partition, trustedPrincipal) ??
    buildPrincipalArn(partition, accountId);
  if (!principalArn) {
    return;
  }

  const key = `${principalArn}:${trustedPrincipal}:${organizationWide}:${isWildcardPrincipal}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push({
    principalArn,
    accountId,
    trustedPrincipal,
    isWildcardPrincipal,
    organizationWide,
  });
}

function isServiceLinkedRole(
  roleArn: string,
  attrs: Record<string, unknown>,
  metadata: Record<string, unknown>,
): boolean {
  const roleName = readRoleName(roleArn, attrs, metadata);
  if (roleName?.startsWith('AWSServiceRoleFor')) {
    return true;
  }

  const path = readString(metadata.path);
  return path?.includes('/aws-service-role/') ?? false;
}

function readRoleName(
  roleArn: string,
  attrs: Record<string, unknown>,
  metadata: Record<string, unknown>,
): string | null {
  const direct =
    readString(metadata.roleName) ??
    getNodeName(attrs);
  if (direct) {
    return direct;
  }

  return tryParseArn(roleArn)?.resourceId.split('/').at(-1) ?? null;
}

function inferRoleImpact(
  attrs: Record<string, unknown>,
  metadata: Record<string, unknown>,
): CrossAccountEdge['drImpact'] {
  const hints = [
    getNodeName(attrs),
    ...ROLE_MONITORING_HINT_KEYS.map((key) => readString(metadata[key])),
    ...extractPolicyHints(metadata),
    ...Object.values(getNodeTags(attrs)),
  ];

  if (isMonitoringLike(hints)) {
    return 'degraded';
  }

  const lowerHints = hints
    .filter((hint): hint is string => hint !== null)
    .map((hint) => hint.toLowerCase());
  const isComputeLike = lowerHints.some((hint) =>
    COMPUTE_HINTS.some((token) => hint.includes(token)),
  );

  return isComputeLike ? 'critical' : 'critical';
}

function extractPolicyHints(
  metadata: Record<string, unknown>,
): readonly string[] {
  const direct = [
    ...readStringArray(metadata.policyNames),
    ...readStringArray(metadata.managedPolicies),
    ...readStringArray(metadata.managedPolicyArns),
  ];
  const structured = readRecordArray(metadata.attachedPolicies).flatMap((policy) => [
    readString(policy.policyName),
    readString(policy.policyArn),
  ].filter((value): value is string => value !== null));

  return [...direct, ...structured];
}

function dedupeIamEdges(edges: readonly CrossAccountEdge[]): CrossAccountEdge[] {
  const deduped = new Map<string, CrossAccountEdge>();

  for (const edge of edges) {
    const key = `${edge.sourceArn}:${edge.targetArn}:${edge.kind}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, edge);
      continue;
    }

    if (existing.metadata.kind !== 'iam_assume_role' || edge.metadata.kind !== 'iam_assume_role') {
      deduped.set(key, edge);
      continue;
    }

    deduped.set(key, {
      ...existing,
      drImpact: mergeImpact(existing.drImpact, edge.drImpact),
      metadata: {
        ...existing.metadata,
        conditionKeys: [...new Set([
          ...existing.metadata.conditionKeys,
          ...edge.metadata.conditionKeys,
        ])].sort(),
        organizationWide:
          existing.metadata.organizationWide || edge.metadata.organizationWide,
        isWildcardPrincipal:
          existing.metadata.isWildcardPrincipal || edge.metadata.isWildcardPrincipal,
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

  return [...deduped.values()];
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

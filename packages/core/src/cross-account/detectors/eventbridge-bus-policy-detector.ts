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
  getNodePartition,
  policyActionsInclude,
  readConditionAccountIds,
  readConditionKeys,
  readConditionValues,
  readPolicyActions,
  readPolicyPrincipalEntries,
  readPolicyStatements,
  readString,
} from './detector-utils.js';

interface ResolvedEventBridgePrincipal {
  readonly principalArn: string;
  readonly accountId: string;
  readonly trustedPrincipal: string;
  readonly organizationWide: boolean;
  readonly isWildcardPrincipal: boolean;
}

const EVENTBRIDGE_BUS_SOURCE_TYPES = new Set(['eventbridge_bus']);
const ORGANIZATION_CONDITION_KEYS = ['aws:principalorgid'] as const;

export class EventBridgeBusPolicyDetector implements SingleDetector {
  public readonly kind = 'eventbridge_bus_policy' as const;

  public detect(
    mergedGraph: GraphInstance,
    accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const scannedAccountIds = new Set(accountResults.map((result) => result.account.accountId));
    const policyCache = new Map<string, Record<string, unknown> | null>();
    const edges = new Map<string, CrossAccountEdge>();

    for (const busNode of collectNodes(mergedGraph, ['eventbridge-bus', 'event-bus'])) {
      if (!isEventBridgeBusNode(busNode.arn, busNode.attrs)) {
        continue;
      }

      const busAccountId = getNodeAccountId(busNode.attrs);
      if (!busAccountId) {
        continue;
      }

      const metadata = getMetadata(busNode.attrs);
      const partition = getNodePartition(busNode.arn, busNode.attrs);
      const statements = readEventBridgePolicyStatements(metadata, policyCache);
      for (const [index, statement] of statements.entries()) {
        if (!isAllowPutEventsStatement(statement)) {
          continue;
        }

        const actions = readPolicyActions(statement.Action ?? statement.Actions);
        const condition = statement.Condition;
        const conditionKeys = readConditionKeys(condition);
        const statementId = readString(statement.Sid) ?? String(index);

        for (const principal of resolvePolicyPrincipals(
          statement.Principal,
          condition,
          partition,
          busAccountId,
          scannedAccountIds,
        )) {
          const edge = buildCrossAccountCompleteness(mergedGraph, {
            sourceArn: principal.principalArn,
            sourceAccountId: principal.accountId,
            targetArn: busNode.arn,
            targetAccountId: busAccountId,
            kind: 'eventbridge_bus_policy',
            direction: 'unidirectional',
            drImpact: 'critical',
            metadata: {
              kind: 'eventbridge_bus_policy',
              eventBusArn: busNode.arn,
              trustedPrincipal: principal.trustedPrincipal,
              actions,
              statementId,
              conditionKeys,
              ...(principal.organizationWide ? { organizationWide: true } : {}),
              ...(principal.isWildcardPrincipal ? { isWildcardPrincipal: true } : {}),
            },
          });

          edges.set(`${edge.sourceArn}:${edge.targetArn}:${statementId}`, edge);
        }
      }
    }

    return [...edges.values()];
  }
}

function isEventBridgeBusNode(nodeArn: string, attrs: Record<string, unknown>): boolean {
  const parsed = tryParseArn(nodeArn);
  if (parsed?.service === 'events' && parsed.resourceType === 'event-bus') {
    return true;
  }

  const sourceType = readString(getMetadata(attrs).sourceType)?.toLowerCase() ?? null;
  return sourceType !== null && EVENTBRIDGE_BUS_SOURCE_TYPES.has(sourceType);
}

function readEventBridgePolicyStatements(
  metadata: Record<string, unknown>,
  cache: Map<string, Record<string, unknown> | null>,
): readonly Record<string, unknown>[] {
  const candidates = [
    metadata.policy,
    metadata.eventBusPolicy,
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

function isAllowPutEventsStatement(statement: Record<string, unknown>): boolean {
  const effect = readString(statement.Effect)?.toLowerCase();
  if (effect !== 'allow') {
    return false;
  }

  const actions = readPolicyActions(statement.Action ?? statement.Actions);
  return policyActionsInclude(actions, 'events:PutEvents');
}

function resolvePolicyPrincipals(
  principalValue: unknown,
  conditionValue: unknown,
  partition: string,
  busAccountId: string,
  scannedAccountIds: ReadonlySet<string>,
): readonly ResolvedEventBridgePrincipal[] {
  const resolved: ResolvedEventBridgePrincipal[] = [];
  const seen = new Set<string>();
  const conditionAccountIds = readConditionAccountIds(conditionValue);
  const organizationWide =
    readConditionValues(conditionValue, ORGANIZATION_CONDITION_KEYS).length > 0;

  for (const entry of readPolicyPrincipalEntries(principalValue)) {
    if (entry.type === 'service' || entry.type === 'canonical' || entry.type === 'federated') {
      continue;
    }

    if (entry.type === 'wildcard') {
      const accountIds = conditionAccountIds.length > 0
        ? conditionAccountIds
        : [...scannedAccountIds].filter((accountId) => accountId !== busAccountId);
      for (const accountId of accountIds) {
        addResolvedPrincipal(resolved, seen, partition, accountId, entry.value, organizationWide, true);
      }
      continue;
    }

    const accountId = extractAccountIdFromPrincipal(entry.value);
    if (!accountId || accountId === busAccountId) {
      continue;
    }

    addResolvedPrincipal(resolved, seen, partition, accountId, entry.value, organizationWide, false);
  }

  return resolved;
}

function addResolvedPrincipal(
  target: ResolvedEventBridgePrincipal[],
  seen: Set<string>,
  partition: string,
  accountId: string,
  trustedPrincipal: string,
  organizationWide: boolean,
  isWildcardPrincipal: boolean,
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
    organizationWide,
    isWildcardPrincipal,
  });
}

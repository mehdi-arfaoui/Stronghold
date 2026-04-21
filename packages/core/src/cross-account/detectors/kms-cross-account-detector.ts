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
  isRecord,
  readBoolean,
  readConditionAccountIds,
  readConditionEntries,
  readConditionValues,
  readPolicyActions,
  readPolicyPrincipalEntries,
  readPolicyStatements,
  readRecordArray,
  readString,
  readStringArray,
} from './detector-utils.js';

interface ResolvedKmsPrincipal {
  readonly principalArn: string;
  readonly accountId: string;
  readonly trustedPrincipal: string;
  readonly organizationWide: boolean;
}

interface KmsConstraints {
  readonly encryptionContextSubset?: Readonly<Record<string, string>>;
  readonly encryptionContextEquals?: Readonly<Record<string, string>>;
}

const KMS_KEY_SOURCE_TYPES = new Set(['kms_key']);
const KMS_ALL_OPERATIONS = [
  'Encrypt',
  'Decrypt',
  'GenerateDataKey',
  'ReEncrypt',
  'CreateGrant',
] as const;
const ORGANIZATION_CONDITION_KEYS = ['aws:principalorgid'] as const;

export class KmsCrossAccountDetector implements SingleDetector {
  public readonly kind = 'kms_cross_account_grant' as const;

  public detect(
    mergedGraph: GraphInstance,
    accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const scannedAccountIds = new Set(
      accountResults.map((result) => result.account.accountId),
    );
    const policyCache = new Map<string, Record<string, unknown> | null>();
    const edges = new Map<string, CrossAccountEdge>();

    for (const keyNode of collectNodes(mergedGraph, ['kms-key', 'key'])) {
      if (!isKmsKeyNode(keyNode.arn, keyNode.attrs)) {
        continue;
      }

      const keyAccountId = getNodeAccountId(keyNode.attrs);
      if (!keyAccountId) {
        continue;
      }

      const metadata = getMetadata(keyNode.attrs);
      const partition = getNodePartition(keyNode.arn, keyNode.attrs);
      const rotationEnabled = readRotationEnabled(metadata);

      for (const grant of readGrantRecords(metadata)) {
        const grantId =
          readString(grant.grantId) ??
          readString(grant.GrantId);
        const granteePrincipal =
          readString(grant.granteePrincipal) ??
          readString(grant.GranteePrincipal);
        const granteeAccountId = granteePrincipal
          ? extractAccountIdFromPrincipal(granteePrincipal)
          : null;
        if (!grantId || !granteePrincipal || !granteeAccountId || granteeAccountId === keyAccountId) {
          continue;
        }

        const sourceArn = buildPrincipalArn(partition, granteePrincipal) ??
          buildPrincipalArn(partition, granteeAccountId);
        if (!sourceArn) {
          continue;
        }

        mergeKmsEdge(
          edges,
          buildCrossAccountCompleteness(mergedGraph, {
            sourceArn,
            sourceAccountId: granteeAccountId,
            targetArn: keyNode.arn,
            targetAccountId: keyAccountId,
            kind: 'kms_cross_account_grant',
            direction: 'unidirectional',
            drImpact: inferKmsImpact(
              normalizeKmsOperations(grant.Operations ?? grant.operations),
            ),
            metadata: {
              kind: 'kms_cross_account_grant',
              keyArn: keyNode.arn,
              grantId,
              granteePrincipal,
              operations: normalizeKmsOperations(grant.Operations ?? grant.operations),
              isRetiring:
                readString(grant.retiringPrincipal) !== null ||
                readString(grant.RetiringPrincipal) !== null,
              constraints: readGrantConstraints(grant),
              accessSource: 'grant',
              ...(rotationEnabled === null ? {} : { keyRotationEnabled: rotationEnabled }),
            },
          }),
        );
      }

      const policyStatements = readKeyPolicyStatements(metadata, policyCache);
      for (const [index, statement] of policyStatements.entries()) {
        if (!isAllowKmsStatement(statement)) {
          continue;
        }

        const actions = readPolicyActions(statement.Action ?? statement.Actions);
        const operations = normalizeKmsOperations(actions);
        if (operations.length === 0) {
          continue;
        }

        for (const principal of resolveKmsPrincipals(
          statement.Principal,
          statement.Condition,
          partition,
          keyAccountId,
          scannedAccountIds,
        )) {
          mergeKmsEdge(
            edges,
            buildCrossAccountCompleteness(mergedGraph, {
              sourceArn: principal.principalArn,
              sourceAccountId: principal.accountId,
              targetArn: keyNode.arn,
              targetAccountId: keyAccountId,
              kind: 'kms_cross_account_grant',
              direction: 'unidirectional',
              drImpact: inferKmsImpact(operations),
              metadata: {
                kind: 'kms_cross_account_grant',
                keyArn: keyNode.arn,
                grantId: `policy:${readString(statement.Sid) ?? String(index)}`,
                granteePrincipal: principal.trustedPrincipal,
                operations,
                isRetiring: false,
                constraints: readPolicyConstraints(statement.Condition),
                accessSource: 'key_policy',
                ...(rotationEnabled === null ? {} : { keyRotationEnabled: rotationEnabled }),
              },
            }),
          );
        }
      }
    }

    return [...edges.values()];
  }
}

function isKmsKeyNode(
  nodeArn: string,
  attrs: Record<string, unknown>,
): boolean {
  const parsed = tryParseArn(nodeArn);
  if (parsed?.service === 'kms' && parsed.resourceType === 'key') {
    return true;
  }

  const sourceType = readString(getMetadata(attrs).sourceType)?.toLowerCase();
  return sourceType !== undefined && KMS_KEY_SOURCE_TYPES.has(sourceType);
}

function readRotationEnabled(metadata: Record<string, unknown>): boolean | null {
  return (
    readBoolean(metadata.rotationEnabled) ??
    readBoolean(metadata.keyRotationEnabled) ??
    readBoolean(metadata.enableKeyRotation)
  );
}

function readGrantRecords(
  metadata: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const candidates = [
    metadata.grants,
    metadata.keyGrants,
    metadata.listGrants,
    metadata.ListGrants,
  ];

  for (const candidate of candidates) {
    const grants = readRecordArray(candidate);
    if (grants.length > 0) {
      return grants;
    }
  }

  return [];
}

function readKeyPolicyStatements(
  metadata: Record<string, unknown>,
  cache: Map<string, Record<string, unknown> | null>,
): readonly Record<string, unknown>[] {
  // TODO: if the KMS scanner does not persist GetKeyPolicy output, the
  // detector falls back to grants-only mode and returns no policy edges.
  const candidates = [
    metadata.keyPolicy,
    metadata.keyPolicyDocument,
    metadata.policy,
    metadata.policyDocument,
    metadata.defaultPolicy,
  ];

  for (const candidate of candidates) {
    const statements = readPolicyStatements(candidate, cache);
    if (statements.length > 0) {
      return statements;
    }
  }

  return [];
}

function isAllowKmsStatement(statement: Record<string, unknown>): boolean {
  const effect = readString(statement.Effect)?.toLowerCase();
  if (effect !== 'allow') {
    return false;
  }

  const actions = readPolicyActions(statement.Action ?? statement.Actions);
  return normalizeKmsOperations(actions).length > 0;
}

function resolveKmsPrincipals(
  principalValue: unknown,
  conditionValue: unknown,
  partition: string,
  keyAccountId: string,
  scannedAccountIds: ReadonlySet<string>,
): readonly ResolvedKmsPrincipal[] {
  const resolved: ResolvedKmsPrincipal[] = [];
  const seen = new Set<string>();
  const conditionAccountIds = readConditionAccountIds(conditionValue);
  const organizationWide =
    readConditionValues(conditionValue, ORGANIZATION_CONDITION_KEYS).length > 0;

  for (const principal of readPolicyPrincipalEntries(principalValue)) {
    if (principal.type === 'service' || principal.type === 'canonical' || principal.type === 'federated') {
      continue;
    }

    if (principal.type === 'wildcard') {
      const wildcardAccounts = conditionAccountIds.length > 0
        ? conditionAccountIds
        : [...scannedAccountIds].filter((accountId) => accountId !== keyAccountId);

      for (const accountId of wildcardAccounts) {
        addResolvedKmsPrincipal(
          resolved,
          seen,
          partition,
          accountId,
          principal.value,
          organizationWide,
        );
      }
      continue;
    }

    const accountId = extractAccountIdFromPrincipal(principal.value);
    if (!accountId || accountId === keyAccountId) {
      continue;
    }

    addResolvedKmsPrincipal(
      resolved,
      seen,
      partition,
      accountId,
      principal.value,
      organizationWide,
    );
  }

  return resolved;
}

function addResolvedKmsPrincipal(
  target: ResolvedKmsPrincipal[],
  seen: Set<string>,
  partition: string,
  accountId: string,
  trustedPrincipal: string,
  organizationWide: boolean,
): void {
  const principalArn = buildPrincipalArn(partition, trustedPrincipal) ??
    buildPrincipalArn(partition, accountId);
  if (!principalArn) {
    return;
  }

  const key = `${principalArn}:${trustedPrincipal}:${organizationWide}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push({
    principalArn,
    accountId,
    trustedPrincipal,
    organizationWide,
  });
}

function normalizeKmsOperations(value: unknown): readonly string[] {
  const actions = [
    readString(value),
    ...readStringArray(value),
  ].filter((entry): entry is string => entry !== null);
  const operations = new Set<string>();

  for (const action of actions) {
    const normalized = action.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    if (normalized === '*' || normalized === 'kms:*') {
      for (const operation of KMS_ALL_OPERATIONS) {
        operations.add(operation);
      }
      continue;
    }

    if (normalized === 'kms:decrypt' || normalized === 'decrypt') {
      operations.add('Decrypt');
      continue;
    }

    if (normalized === 'kms:encrypt' || normalized === 'encrypt') {
      operations.add('Encrypt');
      continue;
    }

    if (normalized.startsWith('kms:generatedatakey') || normalized.startsWith('generatedatakey')) {
      operations.add('GenerateDataKey');
      continue;
    }

    if (normalized.startsWith('kms:reencrypt') || normalized.startsWith('reencrypt')) {
      operations.add('ReEncrypt');
      continue;
    }

    if (normalized === 'kms:creategrant' || normalized === 'creategrant') {
      operations.add('CreateGrant');
      continue;
    }
  }

  return [...operations];
}

function inferKmsImpact(
  operations: readonly string[],
): CrossAccountEdge['drImpact'] {
  const normalized = new Set(operations.map((operation) => operation.toLowerCase()));
  if (
    normalized.has('decrypt') ||
    normalized.has('reencrypt') ||
    normalized.has('creategrant')
  ) {
    return 'critical';
  }

  if (
    normalized.has('encrypt') ||
    normalized.has('generatedatakey')
  ) {
    return 'degraded';
  }

  return 'informational';
}

function readGrantConstraints(
  grant: Record<string, unknown>,
): KmsConstraints | undefined {
  const constraints = isRecord(grant.constraints)
    ? grant.constraints
    : isRecord(grant.Constraints)
      ? grant.Constraints
      : null;
  if (!constraints) {
    return undefined;
  }

  const encryptionContextSubset = readStringRecord(
    constraints.encryptionContextSubset ?? constraints.EncryptionContextSubset,
  );
  const encryptionContextEquals = readStringRecord(
    constraints.encryptionContextEquals ?? constraints.EncryptionContextEquals,
  );
  if (
    Object.keys(encryptionContextSubset).length === 0 &&
    Object.keys(encryptionContextEquals).length === 0
  ) {
    return undefined;
  }

  return {
    ...(Object.keys(encryptionContextSubset).length > 0
      ? { encryptionContextSubset }
      : {}),
    ...(Object.keys(encryptionContextEquals).length > 0
      ? { encryptionContextEquals }
      : {}),
  };
}

function readPolicyConstraints(
  condition: unknown,
): KmsConstraints | undefined {
  const equals: Record<string, string> = {};

  for (const [key, values] of readConditionEntries(condition).entries()) {
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey.startsWith('kms:encryptioncontext:')) {
      continue;
    }

    const contextKey = key.slice('kms:EncryptionContext:'.length);
    const firstValue = values[0];
    if (!contextKey || !firstValue) {
      continue;
    }

    equals[contextKey] = firstValue;
  }

  return Object.keys(equals).length > 0
    ? { encryptionContextEquals: equals }
    : undefined;
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = readString(entry);
    if (normalized) {
      result[key] = normalized;
    }
  }
  return result;
}

function mergeKmsEdge(
  target: Map<string, CrossAccountEdge>,
  edge: CrossAccountEdge,
): void {
  const key = `${edge.sourceArn}:${edge.targetArn}:${edge.kind}`;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, edge);
    return;
  }

  if (
    existing.metadata.kind !== 'kms_cross_account_grant' ||
    edge.metadata.kind !== 'kms_cross_account_grant'
  ) {
    target.set(key, edge);
    return;
  }

  const existingMetadata = existing.metadata;
  const edgeMetadata = edge.metadata;
  const operations = [...new Set([
    ...existingMetadata.operations,
    ...edgeMetadata.operations,
  ])];
  const relatedGrantIds = [...new Set([
    ...(existingMetadata.relatedGrantIds ?? []),
    existingMetadata.grantId,
    edgeMetadata.grantId,
  ])].filter((grantId) => grantId !== existingMetadata.grantId);

  target.set(key, {
    ...existing,
    drImpact: mergeImpact(existing.drImpact, edge.drImpact),
    metadata: {
      ...existingMetadata,
      operations,
      isRetiring: existingMetadata.isRetiring || edgeMetadata.isRetiring,
      constraints: existingMetadata.constraints ?? edgeMetadata.constraints,
      keyRotationEnabled:
        existingMetadata.keyRotationEnabled ?? edgeMetadata.keyRotationEnabled,
      relatedGrantIds: relatedGrantIds.length > 0 ? relatedGrantIds : undefined,
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

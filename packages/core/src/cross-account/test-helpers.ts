import { MultiDirectedGraph } from 'graphology';

import { createEmptyCrossAccountDetectionResult } from './cross-account-detector.js';
import type { GraphInstance } from '../graph/graph-instance.js';
import { createAccountContext, parseArn } from '../identity/index.js';
import type {
  AccountScanResult,
  MultiAccountScanResult,
} from '../orchestration/types.js';

type GraphRecord = Record<string, unknown>;

export function createTestGraph(): GraphInstance {
  return new MultiDirectedGraph<GraphRecord, GraphRecord>() as unknown as GraphInstance;
}

export function addTestNode(
  graph: GraphInstance,
  input: {
    readonly arn: string;
    readonly accountId?: string;
    readonly name?: string;
    readonly type?: string;
    readonly sourceType?: string;
    readonly region?: string | null;
    readonly tags?: Record<string, string>;
    readonly metadata?: Record<string, unknown>;
  },
): void {
  const parsed = parseArn(input.arn);
  const accountId = input.accountId ?? parsed.accountId ?? undefined;
  graph.addNode(input.arn, {
    id: input.arn,
    ...(accountId ? { accountId } : {}),
    partition: parsed.partition,
    service: parsed.service,
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    name: input.name ?? parsed.resourceId,
    type: input.type ?? 'NETWORK_DEVICE',
    provider: 'aws',
    region: input.region ?? parsed.region ?? null,
    tags: input.tags ?? {},
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      ...(accountId ? { accountId } : {}),
      partition: parsed.partition,
      resourceId: parsed.resourceId,
      region: input.region ?? parsed.region ?? undefined,
    },
  });
}

export function createAccountResults(
  accountIds: readonly string[],
): readonly AccountScanResult[] {
  return accountIds.map((accountId) => ({
    account: createAccountContext({ accountId }),
    regions: ['eu-west-1'],
    resources: [],
    findings: [],
    graph: createTestGraph(),
    scanDurationMs: 1,
    scannersExecuted: [],
    scannersSkipped: [],
  }));
}

export function createMultiAccountScanResult(
  graph: GraphInstance,
  accountIds: readonly string[],
): MultiAccountScanResult {
  return {
    accounts: createAccountResults(accountIds),
    mergedGraph: graph,
    mergedFindings: [],
    crossAccount: createEmptyCrossAccountDetectionResult(),
    errors: [],
    totalDurationMs: 1,
    summary: {
      totalAccounts: accountIds.length,
      successfulAccounts: accountIds.length,
      failedAccounts: 0,
      totalResources: 0,
      resourcesByAccount: new Map(),
      totalFindings: 0,
      findingsByAccount: new Map(),
      crossAccountEdges: 0,
    },
  };
}

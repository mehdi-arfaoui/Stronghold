import { expect } from 'vitest';

import type { MultiAccountScanResult } from '../../orchestration/types.js';
import type {
  CrossAccountDependencyKind,
  CrossAccountEdge,
} from '../../cross-account/types.js';
import type { ExpectedCrossAccountEdge } from '../../__fixtures__/multi-account/cross-account-scenarios.fixture.js';

export function expectCrossAccountEdge(
  result: MultiAccountScanResult,
  expected: ExpectedCrossAccountEdge,
): void {
  const match = result.crossAccount.edges.find(
    (edge) =>
      edge.kind === expected.kind &&
      edge.sourceAccountId === expected.sourceAccountId &&
      edge.targetAccountId === expected.targetAccountId,
  );

  expect(match).toBeDefined();
  if (!match) {
    return;
  }

  expect(match.direction).toBe(expected.direction);
  expect(match.drImpact).toBe(expected.drImpact);
  expect(match.completeness).toBe(expected.completeness);
}

export function expectNoCrossAccountEdge(
  result: MultiAccountScanResult,
  kind: CrossAccountDependencyKind,
  description: string,
): void {
  const edges = result.crossAccount.edges.filter((edge) => edge.kind === kind);
  expect(edges, description).toHaveLength(0);
}

export function expectAccountSuccess(
  result: MultiAccountScanResult,
  accountId: string,
  minResources?: number,
): void {
  const account = result.accounts.find(
    (entry) => entry.account.accountId === accountId,
  );

  expect(account).toBeDefined();
  if (account && minResources !== undefined) {
    expect(account.resources.length).toBeGreaterThanOrEqual(minResources);
  }
}

export function expectAccountFailed(
  result: MultiAccountScanResult,
  accountId: string,
  expectedPhase?: 'authentication' | 'scanning' | 'processing',
): void {
  const error = result.errors.find(
    (entry) => entry.account.accountId === accountId,
  );

  expect(error).toBeDefined();
  if (error && expectedPhase) {
    expect(error.phase).toBe(expectedPhase);
  }
}

export function expectCompleteEdgesInGraph(result: MultiAccountScanResult): void {
  const completeEdges = result.crossAccount.edges.filter(
    (edge) => edge.completeness === 'complete',
  );

  for (const edge of completeEdges) {
    expect(hasMaterializedCrossAccountEdge(result, edge)).toBe(true);
  }
}

export function expectPartialEdgesNotInGraph(result: MultiAccountScanResult): void {
  const partialEdges = result.crossAccount.edges.filter(
    (edge) => edge.completeness === 'partial',
  );

  for (const edge of partialEdges) {
    expect(hasMaterializedCrossAccountEdge(result, edge)).toBe(false);
  }
}

function hasMaterializedCrossAccountEdge(
  result: MultiAccountScanResult,
  edge: CrossAccountEdge,
): boolean {
  return (
    result.mergedGraph.hasEdge(buildCrossAccountGraphKey(edge.sourceArn, edge.targetArn)) ||
    result.mergedGraph.hasEdge(buildCrossAccountGraphKey(edge.targetArn, edge.sourceArn))
  );
}

function buildCrossAccountGraphKey(sourceArn: string, targetArn: string): string {
  return `${sourceArn}->${targetArn}:cross_account`;
}

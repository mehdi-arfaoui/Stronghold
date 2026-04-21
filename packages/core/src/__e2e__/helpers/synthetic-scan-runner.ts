import {
  CrossAccountDetector,
  createEmptyCrossAccountDetectionResult,
} from '../../cross-account/index.js';
import type { GraphInstance } from '../../graph/graph-instance.js';
import type { AccountContext } from '../../identity/index.js';
import { ScanResultMerger } from '../../orchestration/scan-result-merger.js';
import type {
  AccountScanError,
  AccountScanResult,
  Finding,
  MultiAccountScanResult,
  MultiAccountSummary,
} from '../../orchestration/types.js';
import type { Resource } from '../../types/resource.js';
import {
  buildGraphFromFixtures,
  type SyntheticFixtureEdge,
} from './graph-builder-from-fixtures.js';

export interface SyntheticAccountFixture {
  readonly resources: readonly Resource[];
  readonly edges: readonly SyntheticFixtureEdge[];
  readonly accountContext: AccountContext;
}

export interface SyntheticAccountFailure {
  readonly accountContext: AccountContext;
  readonly error: Error;
  readonly phase: 'authentication' | 'scanning' | 'processing';
}

export async function runSyntheticMultiAccountScan(options: {
  readonly accounts: ReadonlyMap<string, SyntheticAccountFixture>;
  readonly failedAccounts?: ReadonlyMap<string, SyntheticAccountFailure>;
}): Promise<MultiAccountScanResult> {
  const startedAt = Date.now();
  const requestedAccountCount =
    options.accounts.size + (options.failedAccounts?.size ?? 0);
  const accountResults = Array.from(options.accounts.values()).map((fixture) =>
    createSyntheticAccountScanResult(fixture),
  );
  const errors = Array.from(options.failedAccounts?.values() ?? []).map(
    (failure): AccountScanError => ({
      account: failure.accountContext,
      phase: failure.phase,
      error: failure.error,
      timestamp: new Date(),
    }),
  );

  const merged = new ScanResultMerger().merge(accountResults);
  const totalDurationMs = Date.now() - startedAt;
  const summary = finalizeSummary(
    merged.summary,
    accountResults.length + errors.length,
    errors.length,
  );
  const provisionalResult: MultiAccountScanResult = {
    accounts: accountResults,
    mergedGraph: merged.mergedGraph,
    mergedFindings: merged.mergedFindings,
    crossAccount: createEmptyCrossAccountDetectionResult(),
    errors,
    totalDurationMs,
    summary,
  };
  // A single requested account must behave like the legacy single-account path.
  const crossAccount =
    requestedAccountCount <= 1
      ? createEmptyCrossAccountDetectionResult()
      : new CrossAccountDetector().detect(merged.mergedGraph, provisionalResult);

  return {
    ...provisionalResult,
    crossAccount,
    summary: {
      ...summary,
      crossAccountEdges: crossAccount.summary.total,
    },
  };
}

export async function runSyntheticSingleAccountScan(options: {
  readonly resources: readonly Resource[];
  readonly edges: readonly SyntheticFixtureEdge[];
  readonly accountContext: AccountContext;
}): Promise<AccountScanResult> {
  return createSyntheticAccountScanResult({
    resources: options.resources,
    edges: options.edges,
    accountContext: options.accountContext,
  });
}

function createSyntheticAccountScanResult(
  fixture: SyntheticAccountFixture,
): AccountScanResult {
  return {
    account: fixture.accountContext,
    regions: inferRegions(fixture.resources),
    resources: fixture.resources,
    findings: [] as readonly Finding[],
    graph: buildGraphFromFixtures(fixture.resources, fixture.edges),
    scanDurationMs: 0,
    scannersExecuted: ['synthetic-fixture'],
    scannersSkipped: [],
  };
}

function inferRegions(resources: readonly Resource[]): readonly string[] {
  const regions = new Set<string>();

  for (const resource of resources) {
    const directRegion = resource.region;
    if (directRegion) {
      regions.add(directRegion);
      continue;
    }

    const metadataRegion = readMetadataRegion(resource);
    if (metadataRegion) {
      regions.add(metadataRegion);
    }
  }

  return [...regions].sort();
}

function readMetadataRegion(resource: Resource): string | null {
  const metadata = resource.metadata;
  if (!metadata) {
    return null;
  }

  const rawRegion = metadata.region;
  return typeof rawRegion === 'string' && rawRegion.length > 0 ? rawRegion : null;
}

function finalizeSummary(
  summary: MultiAccountSummary,
  totalAccounts: number,
  failedAccounts: number,
): MultiAccountSummary {
  return {
    ...summary,
    totalAccounts,
    successfulAccounts: totalAccounts - failedAccounts,
    failedAccounts,
  };
}

export function buildMergedGraphSnapshot(
  graph: GraphInstance,
): {
  readonly nodeCount: number;
  readonly edgeCount: number;
} {
  return {
    nodeCount: graph.order,
    edgeCount: graph.size,
  };
}

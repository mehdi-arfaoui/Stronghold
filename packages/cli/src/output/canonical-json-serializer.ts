import type { CrossAccountDetectionResult } from '@stronghold-dr/core';

import {
  STRONGHOLD_JSON_VERSION,
  type AccountSummary,
  type CanonicalMultiAccountScanResult,
  type CanonicalScanJsonOutput,
  type CanonicalScanSerializationInput,
  type CrossAccountJson,
  type CrossAccountSummaryJson,
  type MultiAccountScanSerializationMetadata,
  type MultiAccountSummaryJson,
  type SingleAccountScanResult,
} from './canonical-json-types.js';
import type { ScanResults } from '../storage/file-store.js';

const EMPTY_CROSS_ACCOUNT_SUMMARY: CrossAccountSummaryJson = {
  total: 0,
  byKind: {},
  complete: 0,
  partial: 0,
  critical: 0,
  degraded: 0,
  informational: 0,
};

export function serializeCanonicalScanJson(
  result: CanonicalScanSerializationInput,
): CanonicalScanJsonOutput {
  const multiAccountResult = toMultiAccountResult(result);
  const scanResults = multiAccountResult.results;

  return {
    scan: {
      version: STRONGHOLD_JSON_VERSION,
      scannedAt: scanResults.timestamp,
      durationMs: resolveDurationMs(scanResults, multiAccountResult.accounts),
      accounts: multiAccountResult.accounts,
      errors: multiAccountResult.errors,
      summary: multiAccountResult.summary,
    },
    graph: {
      nodes: scanResults.nodes,
      edges: scanResults.edges,
      crossAccount: multiAccountResult.crossAccount,
    },
    findings: selectValidationFindings(scanResults),
    services: scanResults.servicePosture?.detection.services ?? [],
    scoring: {
      validation: scanResults.validationReport.scoreBreakdown,
      governance: scanResults.governance?.score ?? null,
      services: scanResults.servicePosture?.scoring ?? null,
    },
    realityGap: scanResults.proofOfRecovery ?? null,
  };
}

export function serializeCrossAccountDetection(
  detection: CrossAccountDetectionResult,
): CrossAccountJson {
  return {
    edges: detection.edges,
    summary: {
      total: detection.summary.total,
      byKind: Object.fromEntries(
        [...detection.summary.byKind.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      complete: detection.summary.complete,
      partial: detection.summary.partial,
      critical: detection.summary.critical,
      degraded: detection.summary.degraded,
      informational: detection.summary.informational,
    },
  };
}

function toMultiAccountResult(
  result: CanonicalScanSerializationInput,
): CanonicalMultiAccountScanResult {
  if (isCanonicalMultiAccountResult(result)) {
    return result;
  }

  if (isSingleAccountResult(result)) {
    return adaptSingleAccountToMulti(result);
  }

  return adaptSingleAccountToMulti({
    kind: 'single-account',
    results: result,
  });
}

function adaptSingleAccountToMulti(
  result: SingleAccountScanResult,
): CanonicalMultiAccountScanResult {
  const findingsCount = countFindings(result.results);
  const accountId = resolveSingleAccountId(result);
  const durationMs = result.account?.durationMs ?? result.results.scanMetadata?.totalDurationMs ?? 0;
  const account: AccountSummary = {
    accountId,
    alias: result.account?.alias ?? result.results.scanMetadata?.accountName ?? null,
    region: result.account?.region ?? resolveSingleAccountRegion(result.results),
    status: 'success',
    resourceCount: result.results.nodes.length,
    findingCount: findingsCount,
    durationMs,
  };

  const summary: MultiAccountSummaryJson = {
    totalAccounts: 1,
    successfulAccounts: 1,
    failedAccounts: 0,
    totalResources: result.results.nodes.length,
    resourcesByAccount: { [accountId]: result.results.nodes.length },
    totalFindings: findingsCount,
    findingsByAccount: { [accountId]: findingsCount },
    crossAccountEdges: 0,
  };

  return {
    kind: 'multi-account',
    results: result.results,
    accounts: [account],
    errors: [],
    crossAccount: createEmptyCrossAccountJson(),
    summary,
  };
}

function isCanonicalMultiAccountResult(
  result: CanonicalScanSerializationInput,
): result is CanonicalMultiAccountScanResult {
  return isSerializationEnvelope(result) && result.kind === 'multi-account';
}

function isSingleAccountResult(
  result: CanonicalScanSerializationInput,
): result is SingleAccountScanResult {
  return isSerializationEnvelope(result) && result.kind === 'single-account';
}

function isSerializationEnvelope(
  result: CanonicalScanSerializationInput,
): result is SingleAccountScanResult | CanonicalMultiAccountScanResult {
  return 'kind' in result;
}

function resolveDurationMs(
  results: ScanResults,
  accounts: MultiAccountScanSerializationMetadata['accounts'],
): number {
  return results.scanMetadata?.totalDurationMs
    ?? accounts.reduce((sum, account) => sum + account.durationMs, 0);
}

function resolveSingleAccountId(result: SingleAccountScanResult): string {
  if (result.account?.accountId) {
    return result.account.accountId;
  }

  const nodeAccountId = result.results.nodes.find((node) => node.accountId)?.accountId;
  if (nodeAccountId) {
    return nodeAccountId;
  }

  return result.results.scanMetadata?.maskedAccountId ?? 'unknown';
}

function resolveSingleAccountRegion(results: ScanResults): string {
  return results.regions[0] ?? results.scanMetadata?.scannedRegions[0] ?? 'unknown';
}

function countFindings(results: ScanResults): number {
  return selectValidationFindings(results).length;
}

function selectValidationFindings(
  results: ScanResults,
): CanonicalScanJsonOutput['findings'] {
  return results.validationReport.results.filter((result) =>
    result.status === 'fail' || result.status === 'warn' || result.status === 'error',
  );
}

function createEmptyCrossAccountJson(): CrossAccountJson {
  return {
    edges: [],
    summary: EMPTY_CROSS_ACCOUNT_SUMMARY,
  };
}

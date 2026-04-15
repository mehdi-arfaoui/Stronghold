import { randomUUID } from 'node:crypto';

import {
  analyzeTrend,
  FileFindingLifecycleStore,
  FileHistoryStore,
  applyDebtToSnapshot,
  buildScanSnapshot,
  calculateServiceDebt,
  collectTrackedFindings,
  trackFindings,
  type FindingLifecycle,
  type FindingLifecycleDelta,
  type PostureTrend,
  type ScanSnapshot,
  type ServiceDebt,
  type ValidationReport,
  type ValidationReportWithEvidence,
} from '@stronghold-dr/core';

import type { ScanResults } from '../storage/file-store.js';
import type { StrongholdPaths } from '../storage/paths.js';

export interface LocalPostureMemoryUpdate {
  readonly currentSnapshot: ScanSnapshot | null;
  readonly previousSnapshot: ScanSnapshot | null;
  readonly lifecycleDelta: FindingLifecycleDelta | null;
  readonly currentDebt: readonly ServiceDebt[];
  readonly warning: string | null;
}

export interface LoadedPostureMemory {
  readonly snapshots: readonly ScanSnapshot[];
  readonly currentSnapshot: ScanSnapshot | null;
  readonly previousSnapshot: ScanSnapshot | null;
  readonly allLifecycles: readonly FindingLifecycle[];
  readonly activeLifecycles: readonly FindingLifecycle[];
  readonly resolvedLifecycles: readonly FindingLifecycle[];
  readonly recurrentLifecycles: readonly FindingLifecycle[];
  readonly currentDebt: readonly ServiceDebt[];
  readonly trend: PostureTrend;
  readonly warning: string | null;
}

export async function updateLocalPostureMemory(
  results: ScanResults,
  paths: StrongholdPaths,
): Promise<LocalPostureMemoryUpdate> {
  try {
    const historyStore = new FileHistoryStore(paths.historyPath);
    const lifecycleStore = new FileFindingLifecycleStore(paths.findingLifecyclesPath);
    const evidenceSummary = hasEvidenceSummary(results.validationReport)
      ? results.validationReport.evidenceSummary
      : null;
    const currentSnapshot = buildScanSnapshot({
      scanId: randomUUID(),
      timestamp: results.timestamp,
      validationReport: results.validationReport,
      totalResources: results.scanMetadata?.discoveredResourceCount ?? results.nodes.length,
      regions: results.regions,
      servicePosture: results.servicePosture,
      governance: results.governance,
      scenarioAnalysis: results.scenarioAnalysis,
      evidenceSummary,
      realityGap: results.realityGap,
      fullChainCoverage: results.fullChainCoverage,
      scanDurationMs: results.scanMetadata?.totalDurationMs,
      scannerSuccessCount: results.scanMetadata?.successfulScanners,
      scannerFailureCount: results.scanMetadata?.failedScanners,
    });
    const previousSnapshot = await historyStore.getLatest();

    await historyStore.addSnapshot(currentSnapshot);

    const trackedFindings = collectTrackedFindings(results.validationReport, results.servicePosture);
    const lifecycleDelta = await trackFindings(
      trackedFindings.map((finding) => finding.findingKey),
      historyStore,
      {
        lifecycleStore,
        currentTimestamp: results.timestamp,
        findingContextByKey: new Map(
          trackedFindings.map((finding) => [finding.findingKey, finding] as const),
        ),
      },
    );
    const activeLifecycles = await lifecycleStore.getActive(results.timestamp);
    const currentDebt = calculateServiceDebt({
      servicePosture: results.servicePosture,
      trackedFindings,
      findingLifecycles: activeLifecycles,
      previousDebt: previousSnapshot
        ? previousSnapshot.services
            .filter((service) => typeof service.debt === 'number')
            .map((service) => ({
              serviceId: service.serviceId,
              serviceName: service.serviceName,
              totalDebt: service.debt ?? 0,
              criticalDebt: 0,
              findingDebts: [],
              trend: 'stable' as const,
            }))
        : [],
    });
    const enrichedSnapshot = applyDebtToSnapshot(currentSnapshot, currentDebt);
    await historyStore.replaceLatest(enrichedSnapshot);

    return {
      currentSnapshot: enrichedSnapshot,
      previousSnapshot,
      lifecycleDelta,
      currentDebt,
      warning: null,
    };
  } catch (error) {
    return {
      currentSnapshot: null,
      previousSnapshot: null,
      lifecycleDelta: null,
      currentDebt: [],
      warning: `Unable to update posture memory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function loadLocalPostureMemory(
  scan: ScanResults,
  paths: StrongholdPaths,
): Promise<LoadedPostureMemory> {
  try {
    const historyStore = new FileHistoryStore(paths.historyPath);
    const lifecycleStore = new FileFindingLifecycleStore(paths.findingLifecyclesPath);
    const snapshots = await historyStore.getSnapshots();
    const currentSnapshot = snapshots.at(-1) ?? null;
    const previousSnapshot = snapshots.length >= 2 ? snapshots[snapshots.length - 2] ?? null : null;
    const trackedFindings = collectTrackedFindings(scan.validationReport, scan.servicePosture);
    const activeLifecycles = await lifecycleStore.getActive(scan.timestamp);
    const resolvedLifecycles = await lifecycleStore.getResolved(undefined, scan.timestamp);
    const recurrentLifecycles = await lifecycleStore.getRecurrent(scan.timestamp);
    const allLifecycles = await lifecycleStore.getAll(scan.timestamp);
    const currentDebt = calculateServiceDebt({
      servicePosture: scan.servicePosture,
      trackedFindings,
      findingLifecycles: activeLifecycles,
      previousDebt: previousSnapshot
        ? previousSnapshot.services
            .filter((service) => typeof service.debt === 'number')
            .map((service) => ({
              serviceId: service.serviceId,
              serviceName: service.serviceName,
              totalDebt: service.debt ?? 0,
              criticalDebt: 0,
              findingDebts: [],
              trend: 'stable' as const,
            }))
        : [],
    });

    return {
      snapshots,
      currentSnapshot,
      previousSnapshot,
      allLifecycles,
      activeLifecycles,
      resolvedLifecycles,
      recurrentLifecycles,
      currentDebt,
      trend: analyzeTrend(snapshots, allLifecycles, currentDebt),
      warning: null,
    };
  } catch (error) {
    return {
      snapshots: [],
      currentSnapshot: null,
      previousSnapshot: null,
      allLifecycles: [],
      activeLifecycles: [],
      resolvedLifecycles: [],
      recurrentLifecycles: [],
      currentDebt: [],
      trend: analyzeTrend([], [], []),
      warning: `Unable to load posture memory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function hasEvidenceSummary(
  report: ValidationReport,
): report is ValidationReportWithEvidence {
  return 'evidenceSummary' in report;
}

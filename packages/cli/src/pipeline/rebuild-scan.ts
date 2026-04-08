import { FileEvidenceStore } from '@stronghold-dr/core';
import type { GraphOverrides } from '@stronghold-dr/core';

import type { ScanResults } from '../storage/file-store.js';
import { runScanPipeline } from './scan-pipeline.js';
import { resolveStrongholdPaths } from '../storage/paths.js';

export async function rebuildScanResults(
  scan: ScanResults,
  graphOverrides?: GraphOverrides | null,
): Promise<ScanResults> {
  const evidence = await new FileEvidenceStore(resolveStrongholdPaths().evidencePath).getAll();
  return runScanPipeline({
    provider: scan.provider,
    regions: scan.regions,
    nodes: scan.nodes,
    edges: scan.edges,
    timestamp: scan.timestamp,
    graphOverrides,
    scanMetadata: scan.scanMetadata,
    warnings: scan.warnings,
    isDemo: scan.isDemo,
    evidence,
    ...(scan.isDemo
      ? {}
      : {
          servicesFilePath: resolveStrongholdPaths().servicesPath,
          previousAssignments: scan.servicePosture?.detection.services,
        }),
  });
}

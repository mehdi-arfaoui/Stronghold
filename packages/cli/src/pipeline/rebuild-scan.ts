import type { GraphOverrides } from '@stronghold-dr/core';

import type { ScanResults } from '../storage/file-store.js';
import { runScanPipeline } from './scan-pipeline.js';

export async function rebuildScanResults(
  scan: ScanResults,
  graphOverrides?: GraphOverrides | null,
): Promise<ScanResults> {
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
  });
}

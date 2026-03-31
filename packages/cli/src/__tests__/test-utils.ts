import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import type { DemoScenario } from '../config/options.js';
import { getDemoInfrastructure } from '../demo/demo-infrastructure.js';
import { runScanPipeline } from '../pipeline/scan-pipeline.js';

export async function createDemoResults(scenario: DemoScenario = 'minimal') {
  const demo = getDemoInfrastructure(scenario);
  return runScanPipeline({
    provider: demo.provider,
    regions: demo.regions,
    nodes: demo.nodes,
    edges: demo.edges,
    timestamp: new Date('2026-03-27T00:00:00.000Z').toISOString(),
    isDemo: true,
  });
}

export function createTempDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

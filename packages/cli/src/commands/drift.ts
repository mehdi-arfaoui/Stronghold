import { Command } from 'commander';
import { analyzeDriftImpact, detectDrift } from '@stronghold-dr/core';

import type { DriftCheckCommandOptions } from '../config/options.js';
import { writeOutput } from '../output/io.js';
import { buildGraph } from '../pipeline/graph-builder.js';
import { loadScanResults, saveScanResults } from '../storage/file-store.js';
import { resolveStrongholdPaths } from '../storage/paths.js';

export function registerDriftCommand(program: Command): void {
  const drift = program.command('drift').description('Detect DR drift between two scans');

  drift
    .command('check')
    .description('Compare a baseline and current scan')
    .option('--baseline <path>', 'Path to baseline scan')
    .option('--current <path>', 'Path to current scan')
    .option('--save-baseline', 'Promote current scan as the new baseline', false)
    .option('--verbose', 'Show detailed logs', false)
    .action(async (options: DriftCheckCommandOptions) => {
      const paths = resolveStrongholdPaths();
      const baselinePath = options.baseline ?? paths.baselineScanPath;
      const currentPath = options.current ?? paths.latestScanPath;
      const current = loadScanResults(currentPath);

      try {
        const baseline = loadScanResults(baselinePath);
        const rawDrift = detectDrift(baseline.nodes, current.nodes, {
          scanIdBefore: baseline.timestamp,
          scanIdAfter: current.timestamp,
          timestamp: new Date(current.timestamp),
        });
        const driftReport = analyzeDriftImpact(rawDrift, buildGraph(current.nodes, current.edges), {
          drpComponentIds: current.drpPlan.services.flatMap((service) =>
            service.components.map((component) => component.resourceId),
          ),
        });

        const lines = [
          `Drift detected — ${driftReport.summary.total} change${driftReport.summary.total === 1 ? '' : 's'} since baseline (${baseline.timestamp})`,
          '',
        ];
        driftReport.changes.forEach((change) => {
          lines.push(`   ${severityIcon(change.severity)} ${change.severity.toUpperCase()}: ${change.id} — ${change.resourceId}`);
          lines.push(`      ${change.description}`);
          if (change.affectedServices.length > 0) {
            lines.push(`      Impact: ${change.affectedServices.join(', ')}`);
          }
          lines.push(`      DR impact: ${change.drImpact}`);
          lines.push('');
        });
        lines.push(
          `   DRP status: ${driftReport.summary.drpStale ? '⚠️ STALE' : '✅ CURRENT'} — ${driftReport.summary.drpStale ? "regenerate with 'stronghold plan generate'" : 'baseline still matches recovery assumptions'}`,
        );

        if (options.saveBaseline) {
          saveScanResults(current, baselinePath);
          lines.push(`   Baseline updated: ${baselinePath}`);
        }

        await writeOutput(lines.join('\n'));
        if (driftReport.changes.some((change) => change.severity === 'critical')) {
          process.exitCode = 1;
        }
      } catch {
        if (options.saveBaseline) {
          saveScanResults(current, baselinePath);
          await writeOutput(`No baseline found. Saved current scan as baseline to ${baselinePath}.`);
          return;
        }

        await writeOutput(
          "No baseline found. Run 'stronghold scan' then 'stronghold drift check --save-baseline' to establish one.",
        );
        process.exitCode = 2;
      }
    });
}

function severityIcon(severity: string): string {
  if (severity === 'critical') {
    return '🔴';
  }
  if (severity === 'high') {
    return '🟡';
  }
  return '🟢';
}

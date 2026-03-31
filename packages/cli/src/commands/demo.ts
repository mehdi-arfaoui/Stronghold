import { Command } from 'commander';

import type { DemoCommandOptions } from '../config/options.js';
import { DEFAULT_DEMO_OUTPUT, DEFAULT_DEMO_SCENARIO } from '../config/options.js';
import { getDemoInfrastructure } from '../demo/demo-infrastructure.js';
import { writeOutput } from '../output/io.js';
import { renderScanSummary } from '../output/scan-summary.js';
import { formatDemoMessage } from '../output/theme.js';
import { runScanPipeline } from '../pipeline/scan-pipeline.js';
import { saveScanResults } from '../storage/file-store.js';
import { resolveStrongholdPaths } from '../storage/paths.js';

export function registerDemoCommand(program: Command): void {
  program
    .command('demo')
    .description('Run Stronghold against built-in demo infrastructure')
    .option('--scenario <name>', 'startup|enterprise|minimal', DEFAULT_DEMO_SCENARIO)
    .option('--output <format>', 'summary|json', DEFAULT_DEMO_OUTPUT)
    .option('--verbose', 'Show detailed logs', false)
    .action(async (options: DemoCommandOptions) => {
      let pendingStage: string | null = null;
      const demo = getDemoInfrastructure(options.scenario);

      if (options.output === 'summary') {
        await writeOutput(formatDemoMessage());
        await writeOutput('');
      }

      const results = await runScanPipeline({
        provider: demo.provider,
        regions: demo.regions,
        nodes: demo.nodes,
        edges: demo.edges,
        timestamp: new Date().toISOString(),
        isDemo: true,
        onStage: async (stage) => {
          const label =
            stage === 'graph'
              ? 'Building dependency graph...'
              : stage === 'validation'
                ? 'Running DR validation...'
                : 'Generating DR plan...';
          if (options.output === 'summary') {
            if (pendingStage) {
              await writeOutput(`${pendingStage} done`);
            }
            pendingStage = label;
          }
        },
      });

      if (pendingStage && options.output === 'summary') {
        await writeOutput(`${pendingStage} done`);
        await writeOutput('');
      }

      const paths = resolveStrongholdPaths();
      saveScanResults(results, paths.latestScanPath);

      if (options.output === 'json') {
        await writeOutput(JSON.stringify(results, null, 2));
        return;
      }

      await writeOutput(
        renderScanSummary(results, {
          savedPath: '.stronghold/latest-scan.json',
        }),
      );
      await writeOutput('');
      await writeOutput(
        'This was a demo. To scan your real infrastructure: stronghold scan --region <your-region>',
      );
    });
}

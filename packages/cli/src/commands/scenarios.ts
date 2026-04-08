import { Command } from 'commander';

import { CommandAuditSession, resolveAuditIdentity } from '../audit/command-audit.js';
import { writeOutput } from '../output/io.js';
import {
  getScenarioAnalysis,
  renderScenarioAnalysis,
  renderScenarioCatalog,
  renderScenarioDetail,
} from '../output/scenario-renderer.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

interface ScenarioCommandOptions {
  readonly scan?: string;
  readonly passphrase?: string;
}

interface ScenarioListCommandOptions extends ScenarioCommandOptions {
  readonly defaultOnly?: boolean;
}

export function registerScenariosCommand(program: Command): void {
  const scenarios = program
    .command('scenarios')
    .description('Display scenario coverage analysis from the latest saved scan')
    .option('--scan <path>', 'Path to scan results')
    .action(async (_, command: Command) => {
      const options = command.optsWithGlobals() as ScenarioCommandOptions;
      const audit = new CommandAuditSession('scenarios', {
        outputFormat: 'summary',
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const scan = await loadScenarioScan(options);
        const analysis = getScenarioAnalysis(scan);
        await writeOutput(
          analysis
            ? renderScenarioAnalysis(analysis, scan.timestamp)
            : `Scenario Coverage Analysis - ${scan.timestamp.slice(0, 10)}\n\nNo disruption impact scenarios were generated for this scan.`,
        );
        await audit.finish({
          status: 'success',
          resourceCount: scan.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });

  scenarios
    .command('list')
    .description('List all computed scenarios, including on-demand entries beyond the default set')
    .option('--default-only', 'Show only the default scenario set', false)
    .option('--scan <path>', 'Path to scan results')
    .action(async (_, command: Command) => {
      const options = command.optsWithGlobals() as ScenarioListCommandOptions;
      const audit = new CommandAuditSession('scenarios_list', {
        outputFormat: 'summary',
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const scan = await loadScenarioScan(options);
        const analysis = getScenarioAnalysis(scan);
        await writeOutput(
          analysis
            ? options.defaultOnly
              ? renderScenarioAnalysis(analysis, scan.timestamp)
              : renderScenarioCatalog(analysis, scan.timestamp)
            : `Scenario Coverage Analysis - ${scan.timestamp.slice(0, 10)}\n\nNo disruption impact scenarios were generated for this scan.`,
        );
        await audit.finish({
          status: 'success',
          resourceCount: scan.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });

  scenarios
    .command('show <id>')
    .description('Show the impact chain and coverage detail for a specific scenario')
    .option('--scan <path>', 'Path to scan results')
    .action(async (id: string, _options: ScenarioCommandOptions, command: Command) => {
      const options = command.optsWithGlobals() as ScenarioCommandOptions;
      const audit = new CommandAuditSession('scenarios_show', {
        outputFormat: 'summary',
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const scan = await loadScenarioScan(options);
        const analysis = getScenarioAnalysis(scan);
        const scenario = analysis?.scenarios.find((entry) => entry.id === id);
        if (!scenario) {
          throw new Error(`Scenario "${id}" was not found in the latest scan.`);
        }

        await writeOutput(renderScenarioDetail(scenario));
        await audit.finish({
          status: 'success',
          resourceCount: scenario.impact?.totalAffectedNodes ?? 0,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}

async function loadScenarioScan(
  options: ScenarioCommandOptions,
) {
  const paths = resolveStrongholdPaths();
  const scanPath =
    options.scan ??
    resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);
  const scan = await loadScanResultsWithEncryption(scanPath, {
    passphrase: options.passphrase,
  });
  return rebuildScanResults(scan);
}

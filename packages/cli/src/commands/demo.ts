import fs from 'node:fs';

import { Command } from 'commander';
import {
  generateRecommendations,
  selectTopRecommendations,
} from '@stronghold-dr/core';

import type { DemoCommandOptions } from '../config/options.js';
import {
  DEFAULT_DEMO_OUTPUT,
  DEFAULT_DEMO_SCENARIO,
  getCommandOptions,
} from '../config/options.js';
import { DEMO_CONTRACTS_YAML } from '../demo/demo-contracts.js';
import { getDemoInfrastructure } from '../demo/demo-infrastructure.js';
import { updateLocalPostureMemory } from '../history/posture-memory.js';
import {
  renderExecutiveSummary,
} from '../output/executive-summary.js';
import { writeOutput } from '../output/io.js';
import { renderRecommendationHighlights } from '../output/recommendations.js';
import { renderScanSummary } from '../output/scan-summary.js';
import { formatDemoMessage } from '../output/theme.js';
import { runScanPipeline } from '../pipeline/scan-pipeline.js';
import { saveScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolveStrongholdPaths, type StrongholdPaths } from '../storage/paths.js';
import type { ScanExecutionMetadata, ScanResults } from '../storage/file-store.js';

const DEMO_SCANNER_NAME = 'DemoFixture';

export function registerDemoCommand(program: Command): void {
  program
    .command('demo')
    .description('Run Stronghold against built-in demo infrastructure')
    .option('--scenario <name>', 'startup|enterprise|minimal', DEFAULT_DEMO_SCENARIO)
    .option('--output <format>', 'summary|json', DEFAULT_DEMO_OUTPUT)
    .option('--verbose', 'Show detailed logs', false)
    .action(async (_: DemoCommandOptions, command: Command) => {
      const options = getCommandOptions<DemoCommandOptions>(command);
      let pendingStage: string | null = null;
      const demoStartedAt = Date.now();
      const demo = getDemoInfrastructure(options.scenario);
      const paths = resolveStrongholdPaths();
      const hasExistingState = hasExistingScanState(paths);

      if (options.output === 'summary') {
        await writeOutput(formatDemoMessage());
        await writeOutput('');
        if (hasExistingState) {
          await writeOutput('Note: existing .stronghold/ state detected. Demo will use fresh data.');
          await writeOutput('Previous scan results will not be affected.');
          await writeOutput('');
        }
      }

      const pipelineResults = await runScanPipeline({
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
      const results: ScanResults = {
        ...pipelineResults,
        scanMetadata: buildDemoScanMetadata(
          pipelineResults,
          Math.max(1, Date.now() - demoStartedAt),
        ),
      };

      if (pendingStage && options.output === 'summary') {
        await writeOutput(`${pendingStage} done`);
        await writeOutput('');
      }

      await saveScanResultsWithEncryption(results, paths.latestScanPath, options);
      copyDemoContractsIfMissing(paths);
      const postureMemory = await updateLocalPostureMemory(results, paths);
      const savedPath = options.encrypt
        ? '.stronghold/latest-scan.stronghold-enc'
        : '.stronghold/latest-scan.json';
      const recommendations = generateRecommendations({
        nodes: results.nodes,
        validationReport: results.validationReport,
        drpPlan: results.drpPlan,
        isDemo: true,
        redact: options.redact,
      });
      const topRecommendations = selectTopRecommendations(recommendations);

      if (options.output === 'json') {
        await writeOutput(
          JSON.stringify(
            {
              ...results,
              recommendations,
            },
            null,
            2,
          ),
        );
        return;
      }

      await writeOutput(
        renderScanSummary(results, {
          savedPath,
          warnings: postureMemory.warning ? [postureMemory.warning] : [],
          postureDelta: {
            currentSnapshot: postureMemory.currentSnapshot,
            previousSnapshot: null,
            lifecycleDelta: null,
          },
        }),
      );
      const currentDebt =
        postureMemory.currentSnapshot?.totalDebt ??
        postureMemory.currentDebt.reduce((sum, service) => sum + service.totalDebt, 0);
      await writeOutput('');
      await writeOutput(
        renderExecutiveSummary({
          score: results.governance?.score.withAcceptances.score ?? results.validationReport.scoreBreakdown.overall,
          grade: results.governance?.score.withAcceptances.grade ?? results.validationReport.scoreBreakdown.grade,
          proofOfRecovery: results.proofOfRecovery ?? null,
          services: results.servicePosture?.services ?? [],
          scenarioAnalysis: results.scenarioAnalysis ?? null,
          scenariosCovered: results.scenarioAnalysis?.summary.covered ?? 0,
          scenariosTotal: results.scenarioAnalysis?.summary.total ?? 0,
          drDebt: currentDebt,
          drDebtChange: null,
          trend: 'first_scan',
          nextAction: topRecommendations[0] ?? null,
        }),
      );
      if (topRecommendations.length > 0) {
        await writeOutput('');
        await writeOutput(
          renderRecommendationHighlights(
            topRecommendations,
            results.governance?.score.withAcceptances.score ?? results.validationReport.score,
            'stronghold report',
            recommendations.length,
          ),
        );
      }
      await writeOutput('');
      await writeOutput(
        'This was a demo. To scan your real infrastructure: stronghold scan --region <your-region>',
      );
    });
}

function hasExistingScanState(paths: StrongholdPaths): boolean {
  return [
    paths.latestScanPath,
    paths.latestEncryptedScanPath,
    paths.baselineScanPath,
    paths.baselineEncryptedScanPath,
    paths.historyPath,
    paths.findingLifecyclesPath,
  ].some((filePath) => fs.existsSync(filePath));
}

function buildDemoScanMetadata(
  results: Pick<ScanResults, 'nodes' | 'regions'>,
  totalDurationMs: number,
): ScanExecutionMetadata {
  const scannerResults = results.regions.map((region) => ({
    scannerName: DEMO_SCANNER_NAME,
    region,
    durationMs: totalDurationMs,
    retryCount: 0,
    finalStatus: 'success' as const,
    resourceCount: results.nodes.filter(
      (node) => node.region === region || node.region === 'global',
    ).length,
  }));

  return {
    totalDurationMs,
    scannerConcurrency: 1,
    scannerTimeoutMs: 0,
    scannedRegions: [...results.regions],
    discoveredResourceCount: results.nodes.length,
    successfulScanners: scannerResults.length,
    failedScanners: 0,
    scannerResults,
  };
}

function copyDemoContractsIfMissing(paths: StrongholdPaths): void {
  if (fs.existsSync(paths.contractsPath)) {
    return;
  }

  fs.mkdirSync(paths.rootDir, { recursive: true });
  fs.writeFileSync(paths.contractsPath, DEMO_CONTRACTS_YAML, 'utf8');
}

import { readFile } from 'node:fs/promises';

import { Command } from 'commander';
import {
  analyzeFullGraph,
  deserializeDRPlan,
  generateDRPlan,
  generateRunbook,
  serializeRunbook,
  validateDRPlan,
} from '@stronghold-dr/core';

import type {
  PlanGenerateCommandOptions,
  PlanRunbookCommandOptions,
  PlanValidateCommandOptions,
} from '../config/options.js';
import { ConfigurationError } from '../errors/cli-error.js';
import { writeOutput } from '../output/io.js';
import { renderPlanDocument } from '../output/plan-renderer.js';
import { buildGraph } from '../pipeline/graph-builder.js';
import { loadScanResults } from '../storage/file-store.js';
import { resolveStrongholdPaths } from '../storage/paths.js';

export function registerPlanCommand(program: Command): void {
  const plan = program.command('plan').description('Generate and validate DRP-as-Code documents');

  plan
    .command('generate')
    .description('Generate a DR plan from the latest scan')
    .option('--output <file>', 'Write to file instead of stdout')
    .option('--format <format>', 'yaml|json', 'yaml')
    .option('--scan <path>', 'Path to scan results')
    .option('--verbose', 'Show detailed logs', false)
    .action(async (options: PlanGenerateCommandOptions) => {
      const paths = resolveStrongholdPaths();
      const scanPath = options.scan ?? paths.latestScanPath;
      const scan = loadScanResults(scanPath);
      const graph = buildGraph(scan.nodes, scan.edges);
      const analysis = await analyzeFullGraph(graph);
      const planDocument = generateDRPlan({
        graph,
        analysis,
        provider: scan.provider,
        generatedAt: new Date(scan.timestamp),
      });

      await writeOutput(renderPlanDocument(planDocument, options.format, scan), options.output);
    });

  plan
    .command('runbook')
    .description('Generate an executable DR runbook from the latest scan')
    .option('--output <file>', 'Write to file instead of stdout')
    .option('--format <format>', 'yaml|json', 'yaml')
    .option('--scan <path>', 'Path to scan results')
    .option('--component <id>', 'Generate a runbook for a specific component only')
    .option('--verbose', 'Show detailed logs', false)
    .action(async (options: PlanRunbookCommandOptions) => {
      const paths = resolveStrongholdPaths();
      const scan = loadScanResults(options.scan ?? paths.latestScanPath);
      const runbook = generateRunbook(scan.drpPlan, scan.nodes);
      const componentRunbooks = options.component
        ? runbook.componentRunbooks.filter((component) => component.componentId === options.component)
        : runbook.componentRunbooks;

      if (options.component && componentRunbooks.length === 0) {
        throw new ConfigurationError(`No runbook component found for '${options.component}'.`);
      }

      await writeOutput(
        serializeRunbook(
          {
            ...runbook,
            componentRunbooks,
          },
          options.format,
        ),
        options.output,
      );
    });

  plan
    .command('validate')
    .description('Validate a DR plan against the latest infrastructure scan')
    .requiredOption('--plan <file>', 'Path to DRP YAML')
    .option('--scan <path>', 'Path to scan results')
    .option('--verbose', 'Show detailed logs', false)
    .action(async (options: PlanValidateCommandOptions) => {
      const planContents = await readFile(options.plan, 'utf8');
      const parsed = deserializeDRPlan(planContents);
      if (!parsed.ok) {
        throw new ConfigurationError(`❌ Invalid DR plan:\n\n${parsed.errors.join('\n')}`);
      }

      const paths = resolveStrongholdPaths();
      const scan = loadScanResults(options.scan ?? paths.latestScanPath);
      const graph = buildGraph(scan.nodes, scan.edges);
      const report = validateDRPlan(parsed.value, graph);

      if (report.isValid) {
        await writeOutput('✅ DR plan is consistent with current infrastructure.');
        return;
      }

      const lines = ['❌ DR plan is inconsistent with current infrastructure.', ''];
      report.issues.forEach((issue) => {
        lines.push(`- [${issue.severity}] ${issue.code}: ${issue.description}`);
      });
      await writeOutput(lines.join('\n'));
      process.exitCode = 1;
    });
}

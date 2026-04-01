import { Command } from 'commander';
import {
  analyzeFullGraph,
  deserializeDRPlan,
  generateDRPlan,
  generateRunbook,
  redactObject,
  serializeRunbook,
  validateDRPlan,
} from '@stronghold-dr/core';

import { CommandAuditSession, collectAuditFlags, resolveAuditIdentity } from '../audit/command-audit.js';
import { addGraphOverrideOptions, resolveGraphOverrides } from '../config/graph-overrides.js';
import type {
  PlanGenerateCommandOptions,
  PlanRunbookCommandOptions,
  PlanValidateCommandOptions,
} from '../config/options.js';
import { getCommandOptions } from '../config/options.js';
import { ConfigurationError } from '../errors/cli-error.js';
import { writeError, writeOutput } from '../output/io.js';
import { renderPlanDocument } from '../output/plan-renderer.js';
import { buildGraph } from '../pipeline/graph-builder.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import {
  loadScanResultsWithEncryption,
  readTextFile,
  writeTextFile,
} from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export function registerPlanCommand(program: Command): void {
  const plan = program.command('plan').description('Generate and validate DRP-as-Code documents');

  addGraphOverrideOptions(
    plan
    .command('generate')
    .description('Generate a DR plan from the latest scan')
    .option('--output <file>', 'Write to file instead of stdout')
    .option('--format <format>', 'yaml|json', 'yaml')
    .option('--scan <path>', 'Path to scan results')
    .option('--verbose', 'Show detailed logs', false),
  ).action(async (_: PlanGenerateCommandOptions, command: Command) => {
      const options = getCommandOptions<PlanGenerateCommandOptions>(command);
      const audit = new CommandAuditSession('plan_generate', {
        outputFormat: options.format,
        ...(collectAuditFlags({
          '--redact': options.redact,
          '--encrypt': options.encrypt,
          '--verbose': options.verbose,
          '--output': Boolean(options.output),
          '--no-overrides': options.useOverrides === false,
          '--overrides': options.useOverrides !== false,
        })
          ? {
              flags: collectAuditFlags({
                '--redact': options.redact,
                '--encrypt': options.encrypt,
                '--verbose': options.verbose,
                '--output': Boolean(options.output),
                '--no-overrides': options.useOverrides === false,
                '--overrides': options.useOverrides !== false,
              }),
            }
          : {}),
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const scan = await loadLatestScan(options.scan, options.passphrase);
        const resolvedOverrides = resolveGraphOverrides(options);
        resolvedOverrides.warnings.forEach((warning) => writeError(warning));
        const effectiveScan = await rebuildScanResults(scan, resolvedOverrides.overrides);
        const graph = buildGraph(effectiveScan.nodes, effectiveScan.edges);
        const analysis = await analyzeFullGraph(graph);
        const planDocument = generateDRPlan({
          graph,
          analysis,
          provider: effectiveScan.provider,
          generatedAt: new Date(effectiveScan.timestamp),
        });
        const outputPlan = options.redact ? redactObject(planDocument) : planDocument;
        const rendered = renderPlanDocument(outputPlan, options.format, effectiveScan);

        if (!options.output) {
          await writeOutput(rendered);
        } else {
          await writeTextFile(
            rendered,
            options.output,
            options,
            'Enter passphrase to encrypt the DR plan',
          );
        }

        await audit.finish({
          status: 'success',
          resourceCount: effectiveScan.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });

  plan
    .command('runbook')
    .description('Generate an executable DR runbook from the latest scan')
    .option('--output <file>', 'Write to file instead of stdout')
    .option('--format <format>', 'yaml|json', 'yaml')
    .option('--scan <path>', 'Path to scan results')
    .option('--component <id>', 'Generate a runbook for a specific component only')
    .option('--verbose', 'Show detailed logs', false)
    .action(async (_: PlanRunbookCommandOptions, command: Command) => {
      const options = getCommandOptions<PlanRunbookCommandOptions>(command);
      const audit = new CommandAuditSession('plan_runbook', {
        outputFormat: options.format,
        ...(collectAuditFlags({
          '--redact': options.redact,
          '--verbose': options.verbose,
          '--output': Boolean(options.output),
          '--component': Boolean(options.component),
        })
          ? {
              flags: collectAuditFlags({
                '--redact': options.redact,
                '--verbose': options.verbose,
                '--output': Boolean(options.output),
                '--component': Boolean(options.component),
              }),
            }
          : {}),
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const scan = await loadLatestScan(options.scan, options.passphrase);
        const runbook = generateRunbook(scan.drpPlan, scan.nodes);
        const componentRunbooks = options.component
          ? runbook.componentRunbooks.filter(
              (component) => component.componentId === options.component,
            )
          : runbook.componentRunbooks;

        if (options.component && componentRunbooks.length === 0) {
          throw new ConfigurationError(`No runbook component found for '${options.component}'.`);
        }

        const outputRunbook = options.redact
          ? redactObject({
              ...runbook,
              componentRunbooks,
            })
          : {
              ...runbook,
              componentRunbooks,
            };

        await writeOutput(serializeRunbook(outputRunbook, options.format), options.output);
        await audit.finish({
          status: 'success',
          resourceCount: scan.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });

  plan
    .command('validate')
    .description('Validate a DR plan against the latest infrastructure scan')
    .requiredOption('--plan <file>', 'Path to DRP YAML')
    .option('--scan <path>', 'Path to scan results')
    .option('--verbose', 'Show detailed logs', false)
    .action(async (_: PlanValidateCommandOptions, command: Command) => {
      const options = getCommandOptions<PlanValidateCommandOptions>(command);
      const audit = new CommandAuditSession('plan_validate', {
        ...(collectAuditFlags({
          '--verbose': options.verbose,
        })
          ? {
              flags: collectAuditFlags({
                '--verbose': options.verbose,
              }),
            }
          : {}),
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const planContents = await readTextFile(
          options.plan,
          { passphrase: options.passphrase },
          'Enter passphrase to decrypt the DR plan',
        );
        const parsed = deserializeDRPlan(planContents);
        if (!parsed.ok) {
          throw new ConfigurationError(`❌ Invalid DR plan:\n\n${parsed.errors.join('\n')}`);
        }

        const scan = await loadLatestScan(options.scan, options.passphrase);
        const graph = buildGraph(scan.nodes, scan.edges);
        const report = validateDRPlan(parsed.value, graph);

        if (report.isValid) {
          await writeOutput('✅ DR plan is consistent with current infrastructure.');
          await audit.finish({
            status: 'success',
            resourceCount: scan.nodes.length,
          });
          return;
        }

        const lines = ['❌ DR plan is inconsistent with current infrastructure.', ''];
        report.issues.forEach((issue) => {
          lines.push(`- [${issue.severity}] ${issue.code}: ${issue.description}`);
        });
        await writeOutput(lines.join('\n'));
        process.exitCode = 1;
        await audit.finish({
          status: 'failure',
          resourceCount: scan.nodes.length,
          errorMessage: 'DR plan is inconsistent with current infrastructure.',
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}

async function loadLatestScan(scanPath: string | undefined, passphrase?: string) {
  const paths = resolveStrongholdPaths();
  const resolvedPath =
    scanPath ??
    resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);

  return loadScanResultsWithEncryption(resolvedPath, { passphrase });
}

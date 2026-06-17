import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';
import {
  buildContractEvaluationInput,
  ContractEvaluator,
  FileEvidenceStore,
  loadContracts,
  type AllContractsEvaluationResult,
  type ContractVerdict,
  type RequirementEvaluationResult,
} from '@stronghold-dr/core';

import { ConfigurationError } from '../errors/cli-error.js';
import { writeOutput } from '../output/io.js';
import { redactContractEvaluation, redactContractReason } from '../output/contracts-redaction.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';
import type { ScanResults } from '../storage/file-store.js';
import { theme } from '../output/theme.js';

const STARTER_CONTRACTS_YAML = `# Stronghold recoverability contracts.
# Replace the service name and requirements with your own recoverability targets.
version: "1"
contracts:
  - service: "payment"
    description: "Critical service DR requirements"
    enforcement: warn
    requirements:
      - scenario: region_failure
        rto: 1h
        rpo: 5m
      - scenario: az_failure
        evidence: observed
        chain_coverage: observed
`;

interface ContractsValidateOptions {
  readonly from?: string;
  readonly format?: 'json';
  readonly ci?: boolean;
  readonly passphrase?: string;
}

type DisplayVerdict = ContractVerdict;

export function registerContractsCommand(program: Command): void {
  const contracts = program
    .command('contracts')
    .description('Manage recoverability contracts');

  contracts
    .command('init')
    .description('Create a starter .stronghold/contracts.yml file')
    .action(async () => {
      const paths = resolveStrongholdPaths();
      if (fs.existsSync(paths.contractsPath)) {
        await writeOutput('contracts.yml already exists at .stronghold/contracts.yml');
        return;
      }

      fs.mkdirSync(paths.rootDir, { recursive: true });
      fs.writeFileSync(paths.contractsPath, STARTER_CONTRACTS_YAML, 'utf8');
      await writeOutput('Created .stronghold/contracts.yml');
    });

  contracts
    .command('validate')
    .description('Evaluate contracts against the latest scan and local evidence')
    .option('--from <path>', 'Scan file to validate instead of .stronghold/latest-scan.json')
    .option('--format <format>', 'Output format: json', parseContractsFormat)
    .option('--ci', 'Use CI-friendly [PASS]/[FAIL]/[UNKNOWN] labels', false)
    .action(async (_: unknown, command: Command) => {
      const options = command.optsWithGlobals() as ContractsValidateOptions;
      const paths = resolveStrongholdPaths();
      const scan = await loadScanForContracts(options, paths);
      const contractsLoadResult = await loadContracts(paths.contractsPath);

      if (contractsLoadResult.status === 'not_found') {
        throw new ConfigurationError('No contracts found. Run `stronghold contracts init`.');
      }
      if (contractsLoadResult.status === 'invalid') {
        throw new ConfigurationError(
          `Invalid contracts file: ${contractsLoadResult.errors.join('; ')}`,
        );
      }

      const evidence = await new FileEvidenceStore(paths.evidencePath).getAll();
      const evaluation = new ContractEvaluator().evaluate(
        contractsLoadResult.config.contracts,
        buildContractEvaluationInput({
          ...scan,
          evidence,
        }),
      );

      if (allContractsAreNotApplicable(evaluation)) {
        await writeOutput('No services matched your contracts. Run `stronghold services list`.');
        process.exitCode = 0;
        return;
      }

      if (options.format === 'json') {
        await writeOutput(JSON.stringify(redactContractEvaluation(evaluation), null, 2));
      } else {
        await writeOutput(renderContractsValidation(evaluation, Boolean(options.ci)));
      }

      process.exitCode = evaluation.hasEnforceableViolations ? 1 : 0;
    });
}

export function renderContractsValidation(
  evaluation: AllContractsEvaluationResult,
  ci = false,
): string {
  const lines = [`Contracts: ${evaluation.globalSummary.total} requirements evaluated`];
  for (const result of collectRequirementResults(evaluation)) {
    lines.push(`  ${formatVerdictMarker(result.verdict, ci)} ${formatRequirementLine(result, ci)}`);
  }

  if (evaluation.enforceableViolations.length > 0) {
    const count = evaluation.enforceableViolations.length;
    lines.push('');
    lines.push(
      `${ci ? '!' : theme.warn('⚠')} ${count} enforceable violation${count === 1 ? '' : 's'} - exit code 1`,
    );
  }

  return lines.join('\n');
}

async function loadScanForContracts(
  options: ContractsValidateOptions,
  paths: ReturnType<typeof resolveStrongholdPaths>,
): Promise<ScanResults> {
  const scanPath = options.from
    ? path.resolve(options.from)
    : resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);

  if (!fs.existsSync(scanPath)) {
    throw new ConfigurationError('No scan found. Run `stronghold scan` or `stronghold demo` first.');
  }

  return loadScanResultsWithEncryption(scanPath, {
    passphrase: options.passphrase,
  });
}

function allContractsAreNotApplicable(evaluation: AllContractsEvaluationResult): boolean {
  return evaluation.globalSummary.total > 0 &&
    evaluation.globalSummary.notApplicable === evaluation.globalSummary.total;
}

function collectRequirementResults(
  evaluation: AllContractsEvaluationResult,
): readonly RequirementEvaluationResult[] {
  return evaluation.contractResults.flatMap((contractResult) => contractResult.results);
}

function formatRequirementLine(
  result: RequirementEvaluationResult,
  ci: boolean,
): string {
  const scenario = result.requirement.scenario;
  return `${result.serviceName} / ${scenario}: ${formatVerdictLabel(result.verdict)} - ${formatRequirementReason(result, ci)}`;
}

function formatRequirementReason(
  result: RequirementEvaluationResult,
  ci: boolean,
): string {
  const matchingDimensions = result.dimensions.filter((dimension) =>
    result.verdict === 'met' ? true : dimension.verdict === result.verdict,
  );
  const dimensions = matchingDimensions.length > 0 ? matchingDimensions : result.dimensions;
  if (dimensions.length === 0) {
    return formatReasonText(result.summary, ci);
  }

  return dimensions
    .map((dimension) => formatReasonText(dimension.reason, ci))
    .join(', ');
}

function formatVerdictMarker(verdict: DisplayVerdict, ci: boolean): string {
  if (ci) {
    switch (verdict) {
      case 'met':
        return '[PASS]';
      case 'violated':
        return '[FAIL]';
      case 'unknown':
      case 'not_applicable':
        return '[UNKNOWN]';
    }
  }

  switch (verdict) {
    case 'met':
      return theme.pass('✓');
    case 'violated':
      return theme.fail('✗');
    case 'unknown':
    case 'not_applicable':
      return theme.warn('?');
  }
}

function formatVerdictLabel(verdict: DisplayVerdict): string {
  if (verdict === 'not_applicable') {
    return 'NOT_APPLICABLE';
  }

  return verdict.toUpperCase();
}

function formatReasonText(value: string, ci: boolean): string {
  const redacted = redactContractReason(value).replace(/\.$/u, '');
  return ci ? redacted.replace(/≤/gu, '<=') : redacted;
}

function parseContractsFormat(value: string): 'json' {
  if (value !== 'json') {
    throw new ConfigurationError('--format must be json.');
  }

  return 'json';
}

import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_GRAPH_OVERRIDES_PATH,
  loadGraphOverrides,
  renderGraphOverridesTemplate,
  type GraphOverrides,
} from '@stronghold-dr/core';
import { Command } from 'commander';

import { ConfigurationError } from '../errors/cli-error.js';
import { writeOutput } from '../output/io.js';
import {
  ENCRYPTED_FILE_EXTENSION,
  loadScanResultsWithEncryption,
} from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export interface OverridesValidateOptions {
  readonly path?: string;
  readonly scan?: string;
  readonly passphrase?: string;
}

export interface OverridesValidationResult {
  readonly valid: boolean;
  readonly structureOnly: boolean;
  readonly overridesPath: string;
  readonly scanPath: string | null;
  readonly messages: readonly string[];
}

export function registerOverridesCommand(program: Command): void {
  const overrides = program
    .command('overrides')
    .description('Initialize and validate governed graph overrides');

  overrides
    .command('init')
    .description(`Create ${DEFAULT_GRAPH_OVERRIDES_PATH} with a commented template`)
    .option('--path <path>', 'Override file path', DEFAULT_GRAPH_OVERRIDES_PATH)
    .action(async (options: { readonly path?: string }) => {
      const targetPath = resolveOverridesPath(options.path);
      if (fs.existsSync(targetPath)) {
        throw new ConfigurationError(`Overrides file already exists at ${targetPath}.`);
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, `${renderGraphOverridesTemplate()}\n`, 'utf8');
      await writeOutput(`Created overrides template at ${targetPath}.`);
    });

  overrides
    .command('validate')
    .description('Validate overrides structure and, when available, validate referenced node IDs')
    .option('--path <path>', 'Override file path', DEFAULT_GRAPH_OVERRIDES_PATH)
    .option(
      '--scan <path>',
      'Optional scan artifact path. Defaults to .stronghold/latest-scan.stronghold-enc or .stronghold/latest-scan.json if present.',
    )
    .action(async (options: OverridesValidateOptions & { readonly passphrase?: string }) => {
      const result = await validateOverridesCommand(options);
      await writeOutput(result.messages.join('\n'));
      if (!result.valid) {
        process.exitCode = 1;
      }
    });
}

export async function validateOverridesCommand(
  options: OverridesValidateOptions,
): Promise<OverridesValidationResult> {
  const overridesPath = resolveOverridesPath(options.path);
  const overrides = loadGraphOverrides(overridesPath);
  if (!overrides) {
    throw new ConfigurationError(`No overrides file found at ${overridesPath}.`);
  }

  const scanPath = options.scan ? path.resolve(options.scan) : resolveLastScanArtifactPath();
  if (!scanPath) {
    const paths = resolveStrongholdPaths();
    return {
      valid: true,
      structureOnly: true,
      overridesPath,
      scanPath: null,
      messages: [
        `Overrides file is structurally valid: ${overridesPath}`,
        `Validated structure only. No last scan artifact found at ${paths.latestEncryptedScanPath} or ${paths.latestScanPath}.`,
      ],
    };
  }

  if (!options.scan && !options.passphrase && scanPath.endsWith(ENCRYPTED_FILE_EXTENSION)) {
    return {
      valid: true,
      structureOnly: true,
      overridesPath,
      scanPath,
      messages: [
        `Overrides file is structurally valid: ${overridesPath}`,
        `Validated structure only. Skipped automatic node reference validation because the last scan artifact is encrypted and no passphrase was provided: ${scanPath}.`,
        'Provide --passphrase <string> to validate against the latest encrypted scan or --scan <path> to target a specific artifact.',
      ],
    };
  }

  const scan = await loadScanResultsWithEncryption(scanPath, {
    passphrase: options.passphrase,
  });
  const issues = collectReferenceIssues(overrides, new Set(scan.nodes.map((node) => node.id)));

  if (issues.length > 0) {
    return {
      valid: false,
      structureOnly: false,
      overridesPath,
      scanPath,
      messages: [
        `Overrides file is structurally valid but has missing node references against ${scanPath}:`,
        ...issues.map((issue) => `- ${issue}`),
      ],
    };
  }

  return {
    valid: true,
    structureOnly: false,
    overridesPath,
    scanPath,
    messages: [
      `Overrides file is valid: ${overridesPath}`,
      `Validated node references against scan artifact: ${scanPath}`,
    ],
  };
}

export function resolveLastScanArtifactPath(cwd = process.cwd()): string | null {
  const paths = resolveStrongholdPaths(cwd);
  const preferredPath = resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);

  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  if (fs.existsSync(paths.latestEncryptedScanPath)) {
    return paths.latestEncryptedScanPath;
  }

  if (fs.existsSync(paths.latestScanPath)) {
    return paths.latestScanPath;
  }

  return null;
}

function resolveOverridesPath(filePath?: string): string {
  return path.resolve(filePath ?? DEFAULT_GRAPH_OVERRIDES_PATH);
}

function collectReferenceIssues(overrides: GraphOverrides, nodeIds: ReadonlySet<string>): readonly string[] {
  const issues: string[] = [];

  for (const edge of overrides.add_edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push(`add_edges source '${edge.source}' does not exist in the scan artifact.`);
    }
    if (!nodeIds.has(edge.target)) {
      issues.push(`add_edges target '${edge.target}' does not exist in the scan artifact.`);
    }
  }

  for (const edge of overrides.remove_edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push(`remove_edges source '${edge.source}' does not exist in the scan artifact.`);
    }
    if (!nodeIds.has(edge.target)) {
      issues.push(`remove_edges target '${edge.target}' does not exist in the scan artifact.`);
    }
  }

  for (const override of overrides.criticality_overrides) {
    if (!nodeIds.has(override.node)) {
      issues.push(`criticality_overrides node '${override.node}' does not exist in the scan artifact.`);
    }
  }

  return issues;
}

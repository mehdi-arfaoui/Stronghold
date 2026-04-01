#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import {
  detectFixtureLeaks,
  sanitizeFixtureValue,
  type FixtureMeta,
} from '../packages/core/src/__fixtures__/fixture-security.ts';
import type { AwsRegionScanResult } from '../packages/core/src/index.ts';
import { resolveAwsExecutionContext } from '../packages/cli/src/config/credentials.ts';
import {
  DEFAULT_SCAN_CONCURRENCY,
  DEFAULT_SCANNER_TIMEOUT_SECONDS,
  ensureVpcIncluded,
  parseConcurrencyOption,
  parseRegionOption,
  parseScannerTimeoutOption,
  parseServiceOption,
  type ScanCommandOptions,
} from '../packages/cli/src/config/options.ts';
import { runAwsScan } from '../packages/cli/src/pipeline/aws-scan.ts';

interface CaptureCliOptions
  extends Pick<
    ScanCommandOptions,
    'allRegions' | 'concurrency' | 'profile' | 'region' | 'scannerTimeout' | 'services'
  > {
  readonly verbose: boolean;
}

interface FixtureFile {
  readonly relativePath: string;
  readonly payload: Record<string, unknown>;
}

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const FIXTURE_ROOT = path.join(ROOT_DIR, 'packages/core/src/__fixtures__/aws-real');

async function main(): Promise<void> {
  const options = parseOptions();
  const selectedServices = ensureVpcIncluded(options.services);
  const context = await resolveAwsExecutionContext({
    profile: options.profile,
    explicitRegions: options.region,
    allRegions: options.allRegions,
  });
  const capturedAt = new Date().toISOString();
  const strongholdVersion = readStrongholdVersion();

  console.log('Capturing Stronghold AWS fixtures');
  console.log(`Regions: ${context.regions.join(', ')}`);
  console.log(`Fixture output: ${FIXTURE_ROOT}`);

  const execution = await runAwsScan({
    credentials: context.credentials,
    regions: context.regions,
    services: selectedServices,
    scannerConcurrency: options.concurrency,
    scannerTimeoutMs: options.scannerTimeout * 1_000,
    hooks: {
      onRegionStart: async (region) => {
        console.log(`Scanning ${region}...`);
      },
      onRegionComplete: async (region, durationMs) => {
        console.log(`Completed ${region} in ${formatDuration(durationMs)}`);
      },
      onProgress: async (region, progress) => {
        if (!options.verbose || progress.status !== 'retrying') {
          return;
        }
        console.log(
          `[RETRY] scanner=${progress.service} region=${region} error=${progress.failureType ?? progress.error ?? 'UnknownError'} attempt=${progress.attempt ?? '?'}${progress.maxAttempts ? `/${progress.maxAttempts}` : ''} wait=${formatDuration(progress.waitMs ?? 0)}`,
        );
      },
      onStage: async (message) => {
        if (options.verbose) {
          console.log(message);
        }
      },
    },
  });

  const files = buildFixtureFiles({
    capturedAt,
    strongholdVersion,
    executionRegionResults: execution.regionResults,
    aggregateResults: execution.results,
    aggregateWarnings: execution.warnings,
  });
  const sanitizedFiles = sanitizeAndValidateFiles(files);

  writeFilesAtomically(sanitizedFiles);

  console.log(`Wrote ${sanitizedFiles.length} fixture file(s) to ${FIXTURE_ROOT}`);
  console.log(
    `Scanners captured: ${execution.scanMetadata.successfulScanners + execution.scanMetadata.failedScanners}`,
  );
}

function parseOptions(): CaptureCliOptions {
  const program = new Command();
  program
    .name('capture-fixtures')
    .description('Capture sanitized AWS fixture files for Stronghold integration testing')
    .option('--region <regions>', 'AWS region(s), comma-separated', parseRegionOption)
    .option('--all-regions', 'Capture from all enabled AWS regions', false)
    .option('--profile <profile>', 'AWS profile')
    .option('--services <services>', 'Filter services to scan', parseServiceOption)
    .option(
      '--concurrency <number>',
      'Concurrent AWS service scanners per region (1-16)',
      parseConcurrencyOption,
      DEFAULT_SCAN_CONCURRENCY,
    )
    .option(
      '--scanner-timeout <seconds>',
      'Per-scanner timeout in seconds (10-300)',
      parseScannerTimeoutOption,
      DEFAULT_SCANNER_TIMEOUT_SECONDS,
    )
    .option('--verbose', 'Show retry and stage logs', false);

  program.parse();
  return program.opts<CaptureCliOptions>();
}

function buildFixtureFiles(input: {
  readonly capturedAt: string;
  readonly strongholdVersion: string;
  readonly executionRegionResults: readonly AwsRegionScanResult[];
  readonly aggregateResults: Record<string, unknown>;
  readonly aggregateWarnings: readonly string[];
}): readonly FixtureFile[] {
  const scannerFiles = input.executionRegionResults.flatMap((regionResult) =>
    (regionResult.scannerOutputs ?? []).map((scannerOutput) => {
      const scannerName = scannerOutput.scannerResult.scannerName;
      return {
        relativePath: path.posix.join(
          regionResult.region,
          `${toFileToken(scannerName)}.json`,
        ),
        payload: {
          _meta: createMeta({
            capturedAt: input.capturedAt,
            strongholdVersion: input.strongholdVersion,
            region: regionResult.region,
          }),
          scanner: scannerName,
          region: regionResult.region,
          durationMs: scannerOutput.scannerResult.durationMs,
          retryCount: scannerOutput.scannerResult.retryCount,
          finalStatus: scannerOutput.scannerResult.finalStatus,
          ...(scannerOutput.scannerResult.failureType
            ? { failureType: scannerOutput.scannerResult.failureType }
            : {}),
          resourceCount: scannerOutput.scannerResult.resourceCount,
          warnings: [...scannerOutput.warnings],
          resources: scannerOutput.resources,
        },
      };
    }),
  );

  const aggregateFile: FixtureFile = {
    relativePath: 'aggregate.json',
    payload: {
      _meta: createMeta({
        capturedAt: input.capturedAt,
        strongholdVersion: input.strongholdVersion,
        regions: input.executionRegionResults.map((regionResult) => regionResult.region),
      }),
      regions: input.executionRegionResults.map((regionResult) => ({
        region: regionResult.region,
        durationMs: regionResult.durationMs,
        warnings: [...regionResult.warnings],
        scannerResults: regionResult.scannerResults,
      })),
      scannerFiles: scannerFiles
        .map((file) => file.relativePath)
        .sort(),
      warnings: [...input.aggregateWarnings],
      results: input.aggregateResults,
    },
  };

  return [aggregateFile, ...scannerFiles];
}

function sanitizeAndValidateFiles(files: readonly FixtureFile[]): readonly FixtureFile[] {
  return files.map((file) => {
    const sanitizedPayload = sanitizeFixtureValue(file.payload);
    const leaks = detectFixtureLeaks(sanitizedPayload);

    if (leaks.length > 0) {
      const leakSummary = leaks
        .slice(0, 10)
        .map((leak) => `${leak.kind} at ${leak.path}: ${leak.value}`)
        .join(os.EOL);
      throw new Error(
        `Sensitive data detected after redaction in ${file.relativePath}.${os.EOL}${leakSummary}`,
      );
    }

    return {
      relativePath: file.relativePath,
      payload: sanitizedPayload as Record<string, unknown>,
    };
  });
}

function writeFilesAtomically(files: readonly FixtureFile[]): void {
  const parentDir = path.dirname(FIXTURE_ROOT);
  fs.mkdirSync(parentDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(parentDir, 'aws-real.tmp-'));

  try {
    files.forEach((file) => {
      const destinationPath = path.join(tempDir, ...file.relativePath.split('/'));
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, `${JSON.stringify(file.payload, null, 2)}\n`, 'utf8');
    });

    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    fs.renameSync(tempDir, FIXTURE_ROOT);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function createMeta(input: {
  readonly capturedAt: string;
  readonly strongholdVersion: string;
  readonly region?: string;
  readonly regions?: readonly string[];
}): FixtureMeta {
  return {
    capturedAt: input.capturedAt,
    strongholdVersion: input.strongholdVersion,
    redacted: true,
    ...(input.region ? { region: input.region } : {}),
    ...(input.regions ? { regions: input.regions } : {}),
  };
}

function readStrongholdVersion(): string {
  const candidates = [
    path.join(ROOT_DIR, 'packages/cli/package.json'),
    path.join(ROOT_DIR, 'packages/core/package.json'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const contents = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: string };
    if (typeof contents.version === 'string' && contents.version.length > 0) {
      return contents.version;
    }
  }

  return 'unknown';
}

function toFileToken(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1_000).toFixed(1)}s`;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';
import {
  renderGraphAsHtml,
  type CrossAccountEdge,
  type Service,
  type WeightedValidationResult,
} from '@stronghold-dr/core';

import { CliError } from '../errors/cli-error.js';
import {
  serializeCanonicalScanJson,
} from '../output/canonical-json-serializer.js';
import type { CrossAccountJson } from '../output/canonical-json-types.js';
import { writeError, writeOutput } from '../output/io.js';
import { buildGraph } from '../pipeline/graph-builder.js';
import type { ScanResults, StoredScanEdge } from '../storage/file-store.js';

const DEFAULT_GRAPH_OUTPUT = '.stronghold/graph.html';
const DEFAULT_SCAN_INPUT = '.stronghold/latest-scan.json';
const LARGE_HTML_WARNING_BYTES = 5 * 1024 * 1024;

interface GraphCommandOptions {
  readonly output: string;
  readonly format: string;
  readonly scan: string;
  readonly includeCrossAccount: boolean;
  readonly open?: boolean;
}

interface SerializedGraphSection {
  readonly nodes: ScanResults['nodes'];
  readonly edges: ReadonlyArray<StoredScanEdge>;
  readonly crossAccount: CrossAccountJson;
}

interface LoadedGraphScan {
  readonly graph: SerializedGraphSection;
  readonly findings: readonly WeightedValidationResult[];
  readonly services: readonly Service[];
  readonly rawScanResults: ScanResults | null;
}

export function registerGraphCommand(program: Command): void {
  program
    .command('graph')
    .description('Export the DR dependency graph as HTML or JSON')
    .option('-o, --output <path>', 'output file path', DEFAULT_GRAPH_OUTPUT)
    .option('-f, --format <format>', 'output format: html | json', 'html')
    .option('--scan <path>', 'use a specific scan file', DEFAULT_SCAN_INPUT)
    .option('--include-cross-account', 'include cross-account edges', true)
    .option('--no-include-cross-account', 'exclude cross-account edges from the output')
    .option('--open', 'open HTML in default browser', false)
    .action(async (_: GraphCommandOptions, command: Command) => {
      const options = command.optsWithGlobals() as GraphCommandOptions;
      const format = options.format.toLowerCase();

      if (format !== 'html' && format !== 'json') {
        throw new CliError(`Invalid format: ${options.format}. Use 'html' or 'json'.`, 2);
      }

      const scan = await loadGraphScan(options.scan);
      if (!scan) {
        throw new CliError('No scan found. Run `stronghold scan` first.', 2);
      }

      const crossAccountEdges = options.includeCrossAccount
        ? scan.graph.crossAccount.edges
        : [];
      const output = format === 'html'
        ? renderGraphAsHtml({
            graph: buildGraph(scan.graph.nodes, scan.graph.edges),
            crossAccountEdges,
            findings: scan.findings,
            services: scan.services,
          })
        : JSON.stringify(
            {
              ...scan.graph,
              crossAccount: {
                ...scan.graph.crossAccount,
                edges: crossAccountEdges,
              },
            },
            null,
            2,
          );

      const outputPath = path.resolve(options.output);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, output, 'utf8');

      if (format === 'html' && Buffer.byteLength(output, 'utf8') > LARGE_HTML_WARNING_BYTES) {
        writeError(
          `Graph has ${scan.graph.nodes.length} nodes, the HTML file is large. Consider filtering by service.`,
        );
      }

      await writeOutput(`Graph exported to ${outputPath}`);

      if (options.open && format === 'html') {
        openOutputFile(outputPath);
      }
    });
}

async function loadGraphScan(scanPath: string): Promise<LoadedGraphScan | null> {
  const resolvedPath = path.resolve(scanPath);
  let contents: string;

  try {
    contents = await fs.readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw new CliError(`Unable to read scan file at ${resolvedPath}.`, 1, error);
  }

  const parsed = parseJson(contents, resolvedPath);
  const graph = readCanonicalGraph(parsed) ?? readRawGraph(parsed);

  if (!graph) {
    throw new CliError('Scan file does not contain a dependency graph.', 1);
  }

  const rawScanResults = readRawScanResults(parsed);
  const canonical = rawScanResults ? serializeCanonicalScanJson(rawScanResults) : null;

  return {
    graph,
    findings: readFindings(parsed) ?? canonical?.findings ?? [],
    services: readServices(parsed) ?? canonical?.services ?? [],
    rawScanResults,
  };
}

function parseJson(contents: string, filePath: string): unknown {
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new CliError(`Scan file at ${filePath} is not valid JSON.`, 1, error);
  }
}

function readCanonicalGraph(value: unknown): SerializedGraphSection | null {
  if (!isRecord(value) || !isRecord(value.graph)) {
    return null;
  }

  return readGraphSection(value.graph);
}

function readRawGraph(value: unknown): SerializedGraphSection | null {
  if (!isRecord(value)) {
    return null;
  }

  return readGraphSection(value);
}

function readGraphSection(value: Record<string, unknown>): SerializedGraphSection | null {
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return null;
  }

  return {
    nodes: value.nodes as ScanResults['nodes'],
    edges: value.edges as ReadonlyArray<StoredScanEdge>,
    crossAccount: readCrossAccount(value.crossAccount),
  };
}

function readCrossAccount(value: unknown): CrossAccountJson {
  if (!isRecord(value) || !Array.isArray(value.edges) || !isRecord(value.summary)) {
    return createEmptyCrossAccountJson();
  }

  return {
    edges: value.edges as readonly CrossAccountEdge[],
    summary: {
      total: readNumber(value.summary.total) ?? value.edges.length,
      byKind: isRecord(value.summary.byKind)
        ? (value.summary.byKind as Readonly<Record<string, number>>)
        : {},
      complete: readNumber(value.summary.complete) ?? 0,
      partial: readNumber(value.summary.partial) ?? 0,
      critical: readNumber(value.summary.critical) ?? 0,
      degraded: readNumber(value.summary.degraded) ?? 0,
      informational: readNumber(value.summary.informational) ?? 0,
    },
  };
}

function readRawScanResults(value: unknown): ScanResults | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.timestamp !== 'string' ||
    typeof value.provider !== 'string' ||
    !Array.isArray(value.regions) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !isRecord(value.analysis) ||
    !isRecord(value.validationReport) ||
    !isRecord(value.drpPlan)
  ) {
    return null;
  }

  return value as unknown as ScanResults;
}

function readFindings(value: unknown): readonly WeightedValidationResult[] | null {
  if (isRecord(value) && Array.isArray(value.findings)) {
    return value.findings as readonly WeightedValidationResult[];
  }

  if (
    isRecord(value) &&
    isRecord(value.validationReport) &&
    Array.isArray(value.validationReport.results)
  ) {
    return value.validationReport.results as readonly WeightedValidationResult[];
  }

  return null;
}

function readServices(value: unknown): readonly Service[] | null {
  if (isRecord(value) && Array.isArray(value.services)) {
    return value.services as readonly Service[];
  }

  if (
    isRecord(value) &&
    isRecord(value.servicePosture) &&
    isRecord(value.servicePosture.detection) &&
    Array.isArray(value.servicePosture.detection.services)
  ) {
    return value.servicePosture.detection.services as readonly Service[];
  }

  return null;
}

function createEmptyCrossAccountJson(): CrossAccountJson {
  return {
    edges: [],
    summary: {
      total: 0,
      byKind: {},
      complete: 0,
      partial: 0,
      critical: 0,
      degraded: 0,
      informational: 0,
    },
  };
}

function openOutputFile(outputPath: string): void {
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', outputPath], { windowsHide: true }, handleOpenError);
    return;
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(command, [outputPath], handleOpenError);
}

function handleOpenError(error: Error | null): void {
  if (error) {
    writeError(`Unable to open graph automatically: ${error.message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

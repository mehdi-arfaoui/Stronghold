import fs from 'node:fs';
import path from 'node:path';

import type {
  CircularDependency,
  DRPlan,
  GraphAnalysisReport,
  InfraNode,
  RegionalRisk,
  ValidationReport,
} from '@stronghold-dr/core';

import { FileStoreError } from '../errors/cli-error.js';

export interface SerializedCriticalityScores {
  readonly [nodeId: string]: number;
}

export interface SerializedGraphAnalysis {
  readonly timestamp: string;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly spofs: GraphAnalysisReport['spofs'];
  readonly criticalityScores: SerializedCriticalityScores;
  readonly redundancyIssues: GraphAnalysisReport['redundancyIssues'];
  readonly regionalRisks: readonly RegionalRisk[];
  readonly circularDeps: readonly CircularDependency[];
  readonly cascadeChains: GraphAnalysisReport['cascadeChains'];
  readonly resilienceScore: number;
}

export interface StoredScanEdge {
  readonly source: string;
  readonly target: string;
  readonly type: string;
}

export interface ScanResults {
  readonly timestamp: string;
  readonly provider: string;
  readonly regions: readonly string[];
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<StoredScanEdge>;
  readonly analysis: SerializedGraphAnalysis;
  readonly validationReport: ValidationReport;
  readonly drpPlan: DRPlan;
  readonly warnings?: readonly string[];
  readonly isDemo?: boolean;
}

const GITIGNORE_CONTENT = `# Stronghold scan results contain infrastructure metadata (ARNs, IPs, configurations).
# These files do NOT contain AWS credentials or secrets.
# Review content before committing.
*
!.gitignore
`;

export function saveScanResults(results: ScanResults, filePath: string): void {
  const targetPath = path.resolve(filePath);
  ensureDirectory(path.dirname(targetPath));
  ensureGitignore(path.dirname(targetPath));

  try {
    fs.writeFileSync(targetPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  } catch (error) {
    throw new FileStoreError(`Unable to save scan results to ${targetPath}.`, error);
  }
}

export function loadScanResults(filePath: string): ScanResults {
  const targetPath = path.resolve(filePath);
  if (!fs.existsSync(targetPath)) {
    throw new FileStoreError(`No scan results found at ${targetPath}.`);
  }

  try {
    const contents = fs.readFileSync(targetPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;
    return validateScanResults(parsed, targetPath);
  } catch (error) {
    if (error instanceof FileStoreError) {
      throw error;
    }
    throw new FileStoreError(`Unable to load scan results from ${targetPath}.`, error);
  }
}

function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function ensureGitignore(directoryPath: string): void {
  const gitignorePath = path.join(directoryPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    return;
  }

  fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf8');
}

function validateScanResults(value: unknown, filePath: string): ScanResults {
  if (!isRecord(value)) {
    throw new FileStoreError(`Scan results at ${filePath} must be a JSON object.`);
  }

  const timestamp = readString(value.timestamp);
  const provider = readString(value.provider);
  const regions = readStringArray(value.regions);
  const nodes = Array.isArray(value.nodes) ? (value.nodes as readonly InfraNode[]) : null;
  const edges = Array.isArray(value.edges) ? (value.edges as ReadonlyArray<StoredScanEdge>) : null;
  const analysis = isRecord(value.analysis)
    ? (value.analysis as unknown as SerializedGraphAnalysis)
    : null;
  const validationReport = isRecord(value.validationReport)
    ? (value.validationReport as unknown as ValidationReport)
    : null;
  const drpPlan = isRecord(value.drpPlan) ? (value.drpPlan as unknown as DRPlan) : null;

  if (!timestamp || !provider || !nodes || !edges || !analysis || !validationReport || !drpPlan) {
    throw new FileStoreError(`Scan results at ${filePath} are missing required fields.`);
  }

  return {
    timestamp,
    provider,
    regions,
    nodes,
    edges,
    analysis,
    validationReport,
    drpPlan,
    ...(Array.isArray(value.warnings) ? { warnings: readStringArray(value.warnings) } : {}),
    ...(typeof value.isDemo === 'boolean' ? { isDemo: value.isDemo } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

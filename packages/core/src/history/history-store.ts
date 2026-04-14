import fs from 'node:fs';
import path from 'node:path';

import {
  summarizeEvidenceMaturity,
  type EvidenceMaturitySummary,
  type ValidationReport,
  type ValidationReportWithEvidence,
} from '../validation/index.js';
import type { ServicePosture } from '../services/index.js';
import { calculateProofOfRecovery } from '../scoring/index.js';
import type {
  BuildScanSnapshotInput,
  HistoryQueryOptions,
  HistoryStore,
  ScanSnapshot,
  ServiceSnapshot,
} from './history-types.js';

const ACTIVE_FINDING_STATUSES = new Set(['fail', 'error']);
const GITIGNORE_FILENAME = '.gitignore';
const GITIGNORE_CONTENT = `# Stronghold local posture memory contains infrastructure-derived metadata.
# Review content before committing.
*
!.gitignore
`;

export const DEFAULT_HISTORY_RETENTION_LIMIT = 50;

export class FileHistoryStore implements HistoryStore {
  public constructor(
    private readonly filePath: string,
    private readonly retentionLimit = DEFAULT_HISTORY_RETENTION_LIMIT,
  ) {}

  public async addSnapshot(snapshot: ScanSnapshot): Promise<void> {
    const snapshots = this.readSnapshots();
    snapshots.push(snapshot);
    const retained =
      snapshots.length > this.retentionLimit
        ? snapshots.slice(snapshots.length - this.retentionLimit)
        : snapshots;
    this.writeSnapshots(retained);
  }

  public async getSnapshots(options: HistoryQueryOptions = {}): Promise<readonly ScanSnapshot[]> {
    const filtered = this.readSnapshots().filter((snapshot) => {
      if (options.since && snapshot.timestamp < options.since) {
        return false;
      }
      if (options.until && snapshot.timestamp > options.until) {
        return false;
      }
      return true;
    });
    if (typeof options.limit === 'number' && options.limit > 0) {
      return filtered.slice(Math.max(0, filtered.length - options.limit));
    }
    return filtered;
  }

  public async getLatest(): Promise<ScanSnapshot | null> {
    const snapshots = this.readSnapshots();
    return snapshots.at(-1) ?? null;
  }

  public async getPrevious(): Promise<ScanSnapshot | null> {
    const snapshots = this.readSnapshots();
    return snapshots.length >= 2 ? snapshots[snapshots.length - 2] ?? null : null;
  }

  public async count(): Promise<number> {
    return this.readSnapshots().length;
  }

  public async replaceLatest(snapshot: ScanSnapshot): Promise<void> {
    const snapshots = this.readSnapshots();
    if (snapshots.length === 0) {
      this.writeSnapshots([snapshot]);
      return;
    }

    snapshots[snapshots.length - 1] = snapshot;
    this.writeSnapshots(snapshots);
  }

  private readSnapshots(): ScanSnapshot[] {
    const resolvedPath = path.resolve(this.filePath);
    if (!fs.existsSync(resolvedPath)) {
      return [];
    }

    const contents = fs.readFileSync(resolvedPath, 'utf8');
    return contents
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => parseScanSnapshot(line, resolvedPath));
  }

  private writeSnapshots(snapshots: readonly ScanSnapshot[]): void {
    const resolvedPath = path.resolve(this.filePath);
    ensureDirectory(path.dirname(resolvedPath));
    ensureGitignore(path.dirname(resolvedPath));
    const serialized = snapshots.map((snapshot) => JSON.stringify(snapshot)).join('\n');
    fs.writeFileSync(resolvedPath, serialized.length > 0 ? `${serialized}\n` : '', 'utf8');
  }
}

export function buildScanSnapshot(input: BuildScanSnapshotInput): ScanSnapshot {
  const evidenceSummary = input.evidenceSummary ?? resolveEvidenceSummary(input.validationReport);
  const services = buildServiceSnapshots(input.servicePosture);
  const proofOfRecovery = calculateProofOfRecovery({
    validationReport: input.validationReport,
    servicePosture: input.servicePosture,
  });
  const findings = input.validationReport.results.filter((result) =>
    ACTIVE_FINDING_STATUSES.has(result.status),
  );

  return {
    id: input.scanId,
    timestamp: input.timestamp,
    globalScore: input.validationReport.scoreBreakdown.overall,
    globalGrade: input.validationReport.scoreBreakdown.grade,
    proofOfRecovery: proofOfRecovery.proofOfRecovery,
    claimedProtection: input.realityGap?.claimedProtection ?? 0,
    provenRecoverability: input.realityGap?.provenRecoverability ?? null,
    realityGap: input.realityGap?.realityGap ?? null,
    observedCoverage: proofOfRecovery.observedCoverage,
    totalResources: input.totalResources,
    totalFindings: findings.length,
    findingsBySeverity: countBySeverity(findings),
    services,
    scenarioCoverage: {
      total: input.scenarioAnalysis?.summary.total ?? 0,
      covered: input.scenarioAnalysis?.summary.covered ?? 0,
      partiallyCovered: input.scenarioAnalysis?.summary.partiallyCovered ?? 0,
      uncovered: input.scenarioAnalysis?.summary.uncovered ?? 0,
    },
    ...(input.servicePosture || input.governance
      ? {
          governance: buildGovernanceSnapshot(input),
        }
      : {}),
    evidenceDistribution: {
      observed: evidenceSummary.counts.observed,
      inferred: evidenceSummary.counts.inferred,
      declared: evidenceSummary.counts.declared,
      tested: evidenceSummary.counts.tested,
      expired: evidenceSummary.counts.expired,
    },
    findingIds: Array.from(
      new Set(findings.map((finding) => buildFindingKey(finding.ruleId, finding.nodeId))),
    ),
    regions: [...input.regions],
    scanDurationMs: input.scanDurationMs ?? 0,
    scannerSuccessCount: input.scannerSuccessCount ?? 0,
    scannerFailureCount: input.scannerFailureCount ?? 0,
  };
}

export function buildFindingKey(ruleId: string, nodeId: string): string {
  return `${ruleId}::${nodeId}`;
}

function buildServiceSnapshots(posture: ServicePosture | null | undefined): readonly ServiceSnapshot[] {
  if (!posture) {
    return [];
  }

  return posture.services.map((service) => {
    const trackedFindings = service.score.findings.filter((finding) =>
      ACTIVE_FINDING_STATUSES.has(finding.status),
    );

    return {
      serviceId: service.service.id,
      serviceName: service.service.name,
      score: service.score.score,
      grade: service.score.grade,
      findingCount: trackedFindings.length,
      criticalFindingCount: trackedFindings.filter((finding) => finding.severity === 'critical').length,
      resourceCount: service.service.resources.length,
    };
  });
}

function buildGovernanceSnapshot(
  input: BuildScanSnapshotInput,
): NonNullable<ScanSnapshot['governance']> {
  const services = input.servicePosture?.services ?? [];
  const confirmedOwners = services.filter(
    (service) => service.service.governance?.ownerStatus === 'confirmed',
  ).length;
  const ownerCoverage =
    services.length === 0 ? 0 : Math.round((confirmedOwners / services.length) * 100);

  return {
    ownerCoverage,
    activeAcceptances: input.governance?.riskAcceptances.filter(
      (acceptance) => acceptance.status === 'active',
    ).length ?? 0,
    expiredAcceptances: input.governance?.riskAcceptances.filter(
      (acceptance) => acceptance.status === 'expired',
    ).length ?? 0,
    policyViolations: input.governance?.policyViolations?.length ?? 0,
  };
}

function resolveEvidenceSummary(
  validationReport: BuildScanSnapshotInput['validationReport'],
): EvidenceMaturitySummary {
  if (hasEvidenceSummary(validationReport)) {
    return validationReport.evidenceSummary;
  }
  return summarizeEvidenceMaturity(validationReport.results);
}

function countBySeverity(
  findings: BuildScanSnapshotInput['validationReport']['results'],
): Record<string, number> {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  findings.forEach((finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  });

  return counts;
}

function parseScanSnapshot(contents: string, filePath: string): ScanSnapshot {
  const parsed = JSON.parse(contents) as unknown;
  return validateScanSnapshot(parsed, filePath);
}

function validateScanSnapshot(value: unknown, filePath: string): ScanSnapshot {
  if (!isRecord(value)) {
    throw new Error(`History snapshot at ${filePath} must be a JSON object.`);
  }

  return {
    id: readString(value.id, filePath, 'id'),
    timestamp: readString(value.timestamp, filePath, 'timestamp'),
    globalScore: readNumber(value.globalScore, filePath, 'globalScore'),
    globalGrade: readString(value.globalGrade, filePath, 'globalGrade'),
    proofOfRecovery:
      value.proofOfRecovery === null
        ? null
        : typeof value.proofOfRecovery === 'number'
          ? readNumber(value.proofOfRecovery, filePath, 'proofOfRecovery')
          : null,
    claimedProtection:
      typeof value.claimedProtection === 'number'
        ? readNumber(value.claimedProtection, filePath, 'claimedProtection')
        : 0,
    provenRecoverability:
      value.provenRecoverability === null
        ? null
        : typeof value.provenRecoverability === 'number'
          ? readNumber(value.provenRecoverability, filePath, 'provenRecoverability')
          : null,
    realityGap:
      value.realityGap === null
        ? null
        : typeof value.realityGap === 'number'
          ? readNumber(value.realityGap, filePath, 'realityGap')
          : null,
    observedCoverage:
      typeof value.observedCoverage === 'number'
        ? readNumber(value.observedCoverage, filePath, 'observedCoverage')
        : 0,
    totalResources: readNumber(value.totalResources, filePath, 'totalResources'),
    totalFindings: readNumber(value.totalFindings, filePath, 'totalFindings'),
    findingsBySeverity: readNumberRecord(value.findingsBySeverity, filePath, 'findingsBySeverity'),
    services: readServiceSnapshots(value.services, filePath),
    ...(typeof value.totalDebt === 'number' ? { totalDebt: value.totalDebt } : {}),
    scenarioCoverage: readScenarioCoverage(value.scenarioCoverage, filePath),
    ...(value.governance ? { governance: readGovernanceSnapshot(value.governance, filePath) } : {}),
    evidenceDistribution: readNumberRecord(
      value.evidenceDistribution,
      filePath,
      'evidenceDistribution',
    ),
    findingIds: readStringArray(value.findingIds, filePath, 'findingIds'),
    regions: readStringArray(value.regions, filePath, 'regions'),
    scanDurationMs: readNumber(value.scanDurationMs, filePath, 'scanDurationMs'),
    scannerSuccessCount: readNumber(value.scannerSuccessCount, filePath, 'scannerSuccessCount'),
    scannerFailureCount: readNumber(value.scannerFailureCount, filePath, 'scannerFailureCount'),
  };
}

function readServiceSnapshots(value: unknown, filePath: string): readonly ServiceSnapshot[] {
  if (!Array.isArray(value)) {
    throw new Error(`History snapshot at ${filePath} is missing services.`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`History snapshot at ${filePath} has an invalid service snapshot at ${index}.`);
    }

    return {
      serviceId: readString(entry.serviceId, filePath, `services[${index}].serviceId`),
      serviceName: readString(entry.serviceName, filePath, `services[${index}].serviceName`),
      score: readNumber(entry.score, filePath, `services[${index}].score`),
      grade: readString(entry.grade, filePath, `services[${index}].grade`) as ServiceSnapshot['grade'],
      findingCount: readNumber(entry.findingCount, filePath, `services[${index}].findingCount`),
      criticalFindingCount: readNumber(
        entry.criticalFindingCount,
        filePath,
        `services[${index}].criticalFindingCount`,
      ),
      resourceCount: readNumber(entry.resourceCount, filePath, `services[${index}].resourceCount`),
      ...(typeof entry.debt === 'number' ? { debt: entry.debt } : {}),
    };
  });
}

function readScenarioCoverage(
  value: unknown,
  filePath: string,
): ScanSnapshot['scenarioCoverage'] {
  if (!isRecord(value)) {
    throw new Error(`History snapshot at ${filePath} is missing scenarioCoverage.`);
  }

  return {
    total: readNumber(value.total, filePath, 'scenarioCoverage.total'),
    covered: readNumber(value.covered, filePath, 'scenarioCoverage.covered'),
    partiallyCovered: readNumber(
      value.partiallyCovered,
      filePath,
      'scenarioCoverage.partiallyCovered',
    ),
    uncovered: readNumber(value.uncovered, filePath, 'scenarioCoverage.uncovered'),
  };
}

function readGovernanceSnapshot(
  value: unknown,
  filePath: string,
): NonNullable<ScanSnapshot['governance']> {
  if (!isRecord(value)) {
    throw new Error(`History snapshot at ${filePath} has an invalid governance section.`);
  }

  return {
    ownerCoverage: readNumber(value.ownerCoverage, filePath, 'governance.ownerCoverage'),
    activeAcceptances: readNumber(
      value.activeAcceptances,
      filePath,
      'governance.activeAcceptances',
    ),
    expiredAcceptances: readNumber(
      value.expiredAcceptances,
      filePath,
      'governance.expiredAcceptances',
    ),
    policyViolations: readNumber(
      value.policyViolations,
      filePath,
      'governance.policyViolations',
    ),
  };
}

function readString(value: unknown, filePath: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`History snapshot at ${filePath} is missing ${field}.`);
  }
  return value;
}

function readNumber(value: unknown, filePath: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`History snapshot at ${filePath} is missing ${field}.`);
  }
  return value;
}

function readStringArray(value: unknown, filePath: string, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`History snapshot at ${filePath} is missing ${field}.`);
  }
  return value;
}

function readNumberRecord(value: unknown, filePath: string, field: string): Record<string, number> {
  if (!isRecord(value)) {
    throw new Error(`History snapshot at ${filePath} is missing ${field}.`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, readNumber(entry, filePath, `${field}.${key}`)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasEvidenceSummary(
  report: ValidationReport,
): report is ValidationReportWithEvidence {
  return 'evidenceSummary' in report;
}

function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function ensureGitignore(directoryPath: string): void {
  if (path.basename(directoryPath) !== '.stronghold') {
    return;
  }

  const gitignorePath = path.join(directoryPath, GITIGNORE_FILENAME);
  if (fs.existsSync(gitignorePath)) {
    return;
  }

  fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf8');
}

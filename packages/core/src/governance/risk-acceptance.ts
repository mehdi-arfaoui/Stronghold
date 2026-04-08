import {
  calculateScoreBreakdown,
  collectCriticalFailures,
  summarizeEvidenceMaturity,
  type Grade,
  type InfraNode,
  type ValidationReport,
  type ValidationSeverity,
  type WeightedValidationResult,
} from '../validation/index.js';
import { scoreServices } from '../services/service-scoring.js';
import type { ContextualFinding } from '../services/finding-types.js';
import type { ServicePosture } from '../services/service-posture-types.js';
import type { DRPolicy, PolicyViolation } from './policy-types.js';
import type { GovernanceRiskAcceptanceDefinition } from './governance-types.js';

const SEVERITY_RANK: Readonly<Record<ValidationSeverity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface RiskAcceptance {
  readonly id: string;
  readonly findingKey: string;
  readonly acceptedBy: string;
  readonly justification: string;
  readonly acceptedAt: string;
  readonly expiresAt: string;
  readonly severityAtAcceptance: ValidationSeverity;
  readonly reviewNotes?: string;
  readonly status: RiskAcceptanceStatus;
}

export type RiskAcceptanceStatus = 'active' | 'expired' | 'superseded';

export interface GovernanceScoreSnapshot {
  readonly score: number;
  readonly grade: Grade;
}

export interface GovernanceScoreComparison {
  readonly withAcceptances: GovernanceScoreSnapshot;
  readonly withoutAcceptances: GovernanceScoreSnapshot;
  readonly excludedFindings: number;
}

export interface GovernanceState {
  readonly riskAcceptances: readonly RiskAcceptance[];
  readonly score: GovernanceScoreComparison;
  readonly policies?: readonly DRPolicy[];
  readonly policyViolations?: readonly PolicyViolation[];
}

export function materializeRiskAcceptances(
  definitions: readonly GovernanceRiskAcceptanceDefinition[],
): readonly RiskAcceptance[] {
  return definitions.map((definition) => ({
    ...definition,
    status: 'active',
  }));
}

export function applyRiskAcceptances(
  findings: readonly ContextualFinding[],
  acceptances: readonly RiskAcceptance[],
  asOf = new Date(),
): readonly ContextualFinding[] {
  return resolveRiskAcceptanceApplication(findings, acceptances, asOf).findings;
}

export function applyRiskAcceptancesToServicePosture(
  posture: ServicePosture,
  validationReport: ValidationReport,
  nodes: readonly InfraNode[],
  acceptances: readonly RiskAcceptance[],
  asOf = new Date(),
): {
  readonly posture: ServicePosture;
  readonly governance: GovernanceState;
} {
  const application = resolveRiskAcceptanceApplication(posture.contextualFindings, acceptances, asOf);
  const acceptedFindingKeys = new Set(
    application.findings
      .filter((finding) => finding.riskAccepted === true)
      .map((finding) => buildFindingKey(finding.ruleId, finding.nodeId)),
  );
  const adjustedValidationReport = buildFilteredValidationReport(validationReport, acceptedFindingKeys);
  const adjustedScoring = scoreServices(
    posture.services.map((service) => service.service),
    adjustedValidationReport,
    nodes,
  );
  const scoreByServiceId = new Map(
    adjustedScoring.services.map((serviceScore) => [serviceScore.serviceId, serviceScore] as const),
  );

  return {
    posture: {
      ...posture,
      scoring: adjustedScoring,
      contextualFindings: application.findings,
      services: posture.services.map((service) => ({
        ...service,
        score: scoreByServiceId.get(service.service.id) ?? service.score,
        contextualFindings: application.findings.filter((finding) => finding.serviceId === service.service.id),
      })),
      unassigned: {
        ...posture.unassigned,
        score: adjustedScoring.unassigned,
        contextualFindings: application.findings.filter((finding) => finding.serviceId === null),
      },
    },
    governance: {
      riskAcceptances: application.acceptances,
      score: {
        withAcceptances: {
          score: adjustedValidationReport.scoreBreakdown.overall,
          grade: adjustedValidationReport.scoreBreakdown.grade,
        },
        withoutAcceptances: {
          score: validationReport.scoreBreakdown.overall,
          grade: validationReport.scoreBreakdown.grade,
        },
        excludedFindings: acceptedFindingKeys.size,
      },
    },
  };
}

export function buildFilteredValidationReport(
  validationReport: ValidationReport,
  excludedFindingKeys: ReadonlySet<string>,
): ValidationReport {
  const results = validationReport.results.filter(
    (result) => !excludedFindingKeys.has(buildFindingKey(result.ruleId, result.nodeId)),
  );
  const scoreBreakdown =
    results.length === 0
      ? {
          ...validationReport.scoreBreakdown,
          overall: 100,
          grade: 'A' as const,
          byCategory: {
            backup: 100,
            redundancy: 100,
            failover: 100,
            detection: 100,
            recovery: 100,
            replication: 100,
          },
        }
      : calculateScoreBreakdown(results);

  return {
    ...validationReport,
    totalChecks: results.length,
    passed: countByStatus(results, 'pass'),
    failed: countByStatus(results, 'fail'),
    warnings: countByStatus(results, 'warn'),
    skipped: countByStatus(results, 'skip'),
    errors: countByStatus(results, 'error'),
    results,
    score: scoreBreakdown.overall,
    scoreBreakdown,
    criticalFailures: collectCriticalFailures(results),
    ...('evidenceSummary' in validationReport
      ? {
          evidenceSummary: summarizeEvidenceMaturity(results),
        }
      : {}),
  };
}

function resolveRiskAcceptanceApplication(
  findings: readonly ContextualFinding[],
  acceptances: readonly RiskAcceptance[],
  asOf: Date,
): {
  readonly findings: readonly ContextualFinding[];
  readonly acceptances: readonly RiskAcceptance[];
} {
  const findingsByKey = new Map(
    findings.map((finding) => [buildFindingKey(finding.ruleId, finding.nodeId), finding] as const),
  );
  const resolvedAcceptances = acceptances.map((acceptance) =>
    resolveRiskAcceptanceStatus(acceptance, findingsByKey.get(acceptance.findingKey) ?? null, asOf),
  );
  const latestAcceptanceByFindingKey = new Map<string, RiskAcceptance>();

  resolvedAcceptances.forEach((acceptance) => {
    const current = latestAcceptanceByFindingKey.get(acceptance.findingKey);
    if (!current) {
      latestAcceptanceByFindingKey.set(acceptance.findingKey, acceptance);
      return;
    }

    if (compareAcceptanceFreshness(acceptance, current) > 0) {
      latestAcceptanceByFindingKey.set(acceptance.findingKey, acceptance);
    }
  });

  return {
    findings: findings.map((finding) => {
      const acceptance = latestAcceptanceByFindingKey.get(buildFindingKey(finding.ruleId, finding.nodeId));
      if (!acceptance) {
        return finding;
      }

      return {
        ...finding,
        ...(acceptance.status === 'active' ? { riskAccepted: true } : {}),
        riskAcceptance: acceptance,
      };
    }),
    acceptances: resolvedAcceptances,
  };
}

function resolveRiskAcceptanceStatus(
  acceptance: RiskAcceptance,
  finding: ContextualFinding | null,
  asOf: Date,
): RiskAcceptance {
  if (Date.parse(acceptance.expiresAt) <= asOf.getTime()) {
    return {
      ...acceptance,
      status: 'expired',
    };
  }

  if (
    finding &&
    SEVERITY_RANK[finding.severity] > SEVERITY_RANK[acceptance.severityAtAcceptance]
  ) {
    return {
      ...acceptance,
      status: 'superseded',
    };
  }

  return {
    ...acceptance,
    status: 'active',
  };
}

function countByStatus(
  results: readonly WeightedValidationResult[],
  status: WeightedValidationResult['status'],
): number {
  return results.filter((result) => result.status === status).length;
}

function compareAcceptanceFreshness(left: RiskAcceptance, right: RiskAcceptance): number {
  return (
    Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt) ||
    Date.parse(left.expiresAt) - Date.parse(right.expiresAt) ||
    left.id.localeCompare(right.id)
  );
}

function buildFindingKey(ruleId: string, nodeId: string): string {
  return `${ruleId}::${nodeId}`;
}

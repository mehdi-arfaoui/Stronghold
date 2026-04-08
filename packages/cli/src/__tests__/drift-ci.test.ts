import { describe, expect, it } from 'vitest';

import type {
  DriftImpactAnalysis,
  DriftReport,
  ValidationReport,
  WeightedValidationResult,
} from '@stronghold-dr/core';

import {
  buildDriftCheckReport,
  determineDriftExitCode,
  formatGitHubActionsAnnotations,
  isCiEnvironment,
  renderDriftCheckTerminalReport,
} from '../output/drift.js';

function makeResult(
  overrides: Partial<WeightedValidationResult> &
    Pick<
      WeightedValidationResult,
      'ruleId' | 'nodeId' | 'nodeName' | 'nodeType' | 'status' | 'severity' | 'category' | 'weight'
    >,
): WeightedValidationResult {
  return {
    ruleId: overrides.ruleId,
    nodeId: overrides.nodeId,
    nodeName: overrides.nodeName,
    nodeType: overrides.nodeType,
    status: overrides.status,
    severity: overrides.severity,
    category: overrides.category,
    weight: overrides.weight,
    message: overrides.message ?? `${overrides.ruleId} ${overrides.status}`,
    remediation: overrides.remediation,
    details: overrides.details,
    weightBreakdown: overrides.weightBreakdown ?? {
      severityWeight: 4,
      criticalityWeight: 2,
      blastRadiusWeight: 2,
      directDependentCount: 3,
    },
  };
}

function makeValidationReport(
  score: number,
  results: readonly WeightedValidationResult[],
): ValidationReport {
  return {
    timestamp: '2026-04-01T08:00:00.000Z',
    totalChecks: results.length,
    passed: results.filter((result) => result.status === 'pass').length,
    failed: results.filter((result) => result.status === 'fail').length,
    warnings: results.filter((result) => result.status === 'warn').length,
    skipped: results.filter((result) => result.status === 'skip').length,
    errors: results.filter((result) => result.status === 'error').length,
    results,
    score,
    scoreBreakdown: {
      overall: score,
      byCategory: {
        backup: score,
        redundancy: score,
        failover: score,
        detection: score,
        recovery: score,
        replication: score,
      },
      grade: score >= 80 ? 'B' : score >= 60 ? 'C' : 'D',
      weakestCategory: 'backup',
      scoringMethod: 'weighted',
      disclaimer: 'Testing only.',
    },
    criticalFailures: results.filter((result) => result.severity === 'critical' && result.status === 'fail'),
    scannedResources: 1,
  };
}

function makeDriftReport(changes: DriftReport['changes']): DriftReport {
  return {
    scanIdBefore: 'before',
    scanIdAfter: 'after',
    timestamp: new Date('2026-04-01T08:00:00.000Z'),
    changes,
    summary: {
      total: changes.length,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byCategory: {
        backup_changed: 0,
        redundancy_changed: 0,
        network_changed: 0,
        security_changed: 0,
        resource_added: 0,
        resource_removed: 0,
        config_changed: 0,
        dependency_changed: 0,
      },
      drpStale: changes.length > 0,
    },
  };
}

function makeImpactAnalysis(
  overrides: Partial<DriftImpactAnalysis> = {},
): DriftImpactAnalysis {
  return {
    impacts: [],
    status: 'current',
    affectedSections: [],
    message: 'DRP status: CURRENT - no sections affected by drift.',
    ...overrides,
  };
}

describe('drift CI helpers', () => {
  it('suppresses colors and spinners in CI-friendly terminal output', () => {
    const report = buildDriftCheckReport({
      baselineValidation: makeValidationReport(78, []),
      currentValidation: makeValidationReport(65, []),
      driftReport: makeDriftReport([]),
      drpImpact: makeImpactAnalysis(),
    });

    const output = renderDriftCheckTerminalReport(report, makeDriftReport([]), '2026-04-01T00:00:00.000Z');

    expect(output).not.toMatch(/\u001b\[/);
    expect(output).not.toMatch(/[|/\\-]\s*$/m);
  });

  it('detects CI environments from process variables', () => {
    expect(isCiEnvironment({ CI: 'true' })).toBe(true);
    expect(isCiEnvironment({ GITHUB_ACTIONS: 'true' })).toBe(true);
    expect(isCiEnvironment({ GITLAB_CI: 'true' })).toBe(true);
    expect(isCiEnvironment({ JENKINS_URL: 'https://jenkins.example.com' })).toBe(true);
    expect(isCiEnvironment({})).toBe(false);
  });

  it('returns exit code 1 when the DR score decreases', () => {
    const report = buildDriftCheckReport({
      baselineValidation: makeValidationReport(78, []),
      currentValidation: makeValidationReport(65, []),
      driftReport: makeDriftReport([
        {
          id: 'multi_az_disabled:db:multi_az',
          category: 'redundancy_changed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: 'DATABASE',
          field: 'multi_az',
          previousValue: true,
          currentValue: false,
          description: 'Multi-AZ redundancy was disabled for main-database.',
          drImpact: 'A zonal failure can now interrupt recovery.',
          affectedServices: [],
        },
      ]),
      drpImpact: makeImpactAnalysis(),
    });

    expect(determineDriftExitCode(report, 1)).toBe(1);
  });

  it('returns exit code 0 when no drift exists', () => {
    const report = buildDriftCheckReport({
      baselineValidation: makeValidationReport(78, []),
      currentValidation: makeValidationReport(78, []),
      driftReport: makeDriftReport([]),
      drpImpact: makeImpactAnalysis(),
    });

    expect(determineDriftExitCode(report, 1)).toBe(0);
  });

  it('honors fail-threshold before failing on score changes', () => {
    const report = buildDriftCheckReport({
      baselineValidation: makeValidationReport(78, []),
      currentValidation: makeValidationReport(74, []),
      driftReport: makeDriftReport([
        {
          id: 'replica_removed:db:replicaCount',
          category: 'redundancy_changed',
          severity: 'high',
          resourceId: 'db',
          resourceType: 'DATABASE',
          field: 'replicaCount',
          previousValue: 1,
          currentValue: 0,
          description: 'Replica capacity decreased for main-database.',
          drImpact: 'Read scale and failover headroom are reduced.',
          affectedServices: [],
        },
      ]),
      drpImpact: makeImpactAnalysis(),
    });

    expect(determineDriftExitCode(report, 5)).toBe(0);
    expect(determineDriftExitCode(report, 4)).toBe(1);
  });

  it('produces valid JSON output with the expected fields', () => {
    const baselineResults = [
      makeResult({
        ruleId: 'rds_multi_az_active',
        nodeId: 'db',
        nodeName: 'main-database',
        nodeType: 'DATABASE',
        status: 'pass',
        severity: 'critical',
        category: 'redundancy',
        weight: 20,
      }),
    ];
    const currentResults = [
      makeResult({
        ruleId: 'rds_multi_az_active',
        nodeId: 'db',
        nodeName: 'main-database',
        nodeType: 'DATABASE',
        status: 'fail',
        severity: 'critical',
        category: 'redundancy',
        weight: 20,
        message: 'RDS Multi-AZ is disabled.',
      }),
    ];
    const report = buildDriftCheckReport({
      baselineValidation: makeValidationReport(78, baselineResults),
      currentValidation: makeValidationReport(65, currentResults),
      driftReport: makeDriftReport([
        {
          id: 'multi_az_disabled:db:multi_az',
          category: 'redundancy_changed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: 'DATABASE',
          field: 'multi_az',
          previousValue: true,
          currentValue: false,
          description: 'Multi-AZ redundancy was disabled for main-database.',
          drImpact: 'A zonal failure can now interrupt recovery.',
          affectedServices: [],
        },
      ]),
      drpImpact: makeImpactAnalysis(),
    });

    const parsed = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;

    expect(parsed.hasDrift).toBe(true);
    expect(parsed.scoreBefore).toBe(78);
    expect(parsed.scoreAfter).toBe(65);
    expect(parsed.scoreDelta).toBe(-13);
    expect(Array.isArray(parsed.newFindings)).toBe(true);
    expect(Array.isArray(parsed.resolvedFindings)).toBe(true);
    expect(Array.isArray(parsed.drpImpact)).toBe(true);
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('formats GitHub Actions annotations and limits them to five entries', () => {
    const impacts = Array.from({ length: 6 }, (_, index) => ({
      nodeId: `db-${index}`,
      nodeName: `database-${index}`,
      driftType: 'resource_removed',
      drpSections: ['database-recovery'],
      impact: index === 0 ? 'invalidated' : ('degraded' as const),
      message: `Impact ${index}`,
      estimatedRtoChange: {
        before: '1 minute-5 minutes',
        after: null,
        source: null,
        confidence: 'unverified' as const,
        reason: 'Needs validation.',
      },
    }));
    const report = buildDriftCheckReport({
      baselineValidation: makeValidationReport(78, []),
      currentValidation: makeValidationReport(65, [
        makeResult({
          ruleId: 'backup_recent',
          nodeId: 'db',
          nodeName: 'main-database',
          nodeType: 'DATABASE',
          status: 'fail',
          severity: 'critical',
          category: 'backup',
          weight: 10,
        }),
      ]),
      driftReport: makeDriftReport([
        {
          id: 'resource_removed:db:resource',
          category: 'resource_removed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: 'DATABASE',
          field: 'resource',
          previousValue: 'main-database',
          currentValue: null,
          description: 'Resource removed from the snapshot: main-database.',
          drImpact: 'The DR plan may reference a component that no longer exists.',
          affectedServices: [],
        },
      ]),
      drpImpact: makeImpactAnalysis({
        impacts,
        status: 'stale',
        affectedSections: ['database-recovery'],
        message: 'DRP status: STALE - 1 section affected by drift.',
      }),
    });

    const annotations = formatGitHubActionsAnnotations(report);

    expect(annotations).toHaveLength(5);
    expect(annotations[0]).toContain('::warning title=DR Score Decreased::');
    expect(annotations.some((entry) => entry.includes('::error title=DRP Invalidated::'))).toBe(true);
  });
});

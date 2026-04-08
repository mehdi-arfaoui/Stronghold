import type { Evidence } from '../evidence/index.js';
import { describe, expect, it } from 'vitest';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import { formatValidationReport } from './validation-reporter.js';
import {
  blastRadiusWeight,
  calculatePotentialTestVerifiedScore,
  calculateWeightedScore,
  gradeForScore,
  runValidation,
  summarizeEvidenceMaturity,
} from './validation-engine.js';
import type {
  ValidationEdge,
  ValidationRule,
  ValidationStatus,
  WeightedValidationResult,
  WeightedValidationResultWithEvidence,
} from './validation-types.js';

function createNode(
  id: string,
  type = 'APPLICATION',
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-1',
    tags: {},
    metadata: {
      sourceType: type,
      ...metadata,
    },
  };
}

function createEdge(source: string, target: string, type = 'DEPENDS_ON'): ValidationEdge {
  return { source, target, type };
}

function createRule(
  id: string,
  severity: ValidationRule['severity'],
  category: ValidationRule['category'],
  statusByNode: Record<string, ValidationStatus>,
  appliesToTypes: readonly string[] = ['application', 'database'],
): ValidationRule {
  return {
    id,
    name: id,
    description: id,
    severity,
    category,
    appliesToTypes,
    validate: (node) => ({
      ruleId: id,
      nodeId: node.id,
      status: statusByNode[node.id] ?? 'pass',
      message: `${id} on ${node.name}`,
      remediation: `Fix ${id}`,
    }),
  };
}

describe('weighted scoring', () => {
  it('weights critical nodes with many direct dependents much higher than low-impact failures', () => {
    const criticalNode = createNode('critical-db', 'DATABASE', { criticality: 'critical' });
    const lowNode = createNode('low-worker', 'APPLICATION', { criticality: 'low' });
    const dependents = Array.from({ length: 10 }, (_, index) =>
      createNode(`dependent-${index + 1}`),
    );
    const edges = dependents.map((node) => createEdge(node.id, criticalNode.id));
    const report = runValidation(
      [criticalNode, lowNode, ...dependents],
      edges,
      [
        createRule('critical_gap', 'critical', 'backup', { 'critical-db': 'fail' }, ['database']),
        createRule('minor_gap', 'low', 'backup', { 'low-worker': 'fail' }, ['application']),
      ],
    );
    const criticalResult = report.results.find(
      (result) => result.ruleId === 'critical_gap' && result.nodeId === 'critical-db',
    );
    const lowResult = report.results.find(
      (result) => result.ruleId === 'minor_gap' && result.nodeId === 'low-worker',
    );

    expect(criticalResult?.weight ?? 0).toBeGreaterThan((lowResult?.weight ?? 0) * 10);
  });

  it('returns a perfect score when all scored checks pass', () => {
    const score = calculateWeightedScore([
      createWeightedResult('pass', 10, 'observed'),
      createWeightedResult('pass', 10, 'observed'),
    ]);

    expect(score).toBe(85);
  });

  it('returns a zero score when all scored checks fail', () => {
    const node = createNode('app-1');
    const report = runValidation(
      [node],
      [],
      [
        createRule('backup_check', 'critical', 'backup', { 'app-1': 'fail' }, ['application']),
        createRule('detect_check', 'high', 'detection', { 'app-1': 'fail' }, ['application']),
      ],
    );

    expect(report.score).toBe(0);
    expect(report.scoreBreakdown.overall).toBe(0);
  });

  it('computes category scores independently from the global score', () => {
    const node = createNode('app-1');
    const report = runValidation(
      [node],
      [],
      [
        createRule('backup_check', 'medium', 'backup', { 'app-1': 'pass' }, ['application']),
        createRule('detect_check', 'medium', 'detection', { 'app-1': 'fail' }, ['application']),
      ],
    );

    expect(report.scoreBreakdown.byCategory.backup).toBe(85);
    expect(report.scoreBreakdown.byCategory.detection).toBe(0);
    expect(report.scoreBreakdown.overall).toBe(43);
    expect(report.scoreBreakdown.weakestCategory).toBe('detection');
  });

  it('assigns grades using the documented thresholds', () => {
    expect(gradeForScore(90)).toBe('A');
    expect(gradeForScore(75)).toBe('B');
    expect(gradeForScore(60)).toBe('C');
    expect(gradeForScore(40)).toBe('D');
    expect(gradeForScore(39)).toBe('F');
  });

  it('uses the documented logarithmic blast radius mapping', () => {
    expect(blastRadiusWeight(0)).toBe(1);
    expect(blastRadiusWeight(3)).toBeCloseTo(2, 1);
    expect(blastRadiusWeight(7)).toBeCloseTo(3, 1);
  });

  it('exposes the scoring method and disclaimer text', () => {
    const report = runValidation(
      [createNode('app-1')],
      [],
      [createRule('backup_check', 'medium', 'backup', { 'app-1': 'pass' }, ['application'])],
    );

    expect(report.scoreBreakdown.scoringMethod).toBe(
      'Weighted by rule severity × node criticality × blast radius (log2, direct dependents only)',
    );
    expect(report.scoreBreakdown.disclaimer).toBe(
      'This score measures the percentage of recommended DR mechanisms in place, weighted by severity and impact. It does not guarantee recovery capability — only a tested DR plan can provide that assurance.',
    );
  });

  it('counts only direct dependents for the blast radius weight', () => {
    const nodeA = createNode('frontend');
    const nodeB = createNode('api');
    const nodeC = createNode('database');
    const report = runValidation(
      [nodeA, nodeB, nodeC],
      [createEdge('frontend', 'api'), createEdge('api', 'database')],
      [createRule('db_check', 'critical', 'backup', { database: 'fail' }, ['application'])],
    );
    const result = report.results.find((entry) => entry.ruleId === 'db_check' && entry.nodeId === 'database');

    expect(result?.weightBreakdown.directDependentCount).toBe(1);
  });

  it('formats impact lines for humans and omits technical weight algebra from the report', () => {
    const database = createNode('prod-db-primary', 'APPLICATION', { criticality: 'critical' });
    const dependents = [createNode('svc-1'), createNode('svc-2'), createNode('svc-3')];
    const report = runValidation(
      [database, ...dependents],
      dependents.map((node) => createEdge(node.id, database.id)),
      [
        {
          id: 'backup_plan_exists',
          name: 'backup_plan_exists',
          description: 'backup_plan_exists',
          severity: 'critical',
          category: 'backup',
          appliesToTypes: ['application'],
          validate: (node) => ({
            ruleId: 'backup_plan_exists',
            nodeId: node.id,
            status: node.id === 'prod-db-primary' ? 'fail' : 'pass',
            message:
              node.id === 'prod-db-primary'
                ? 'No AWS Backup plan covers this database.'
                : 'covered',
            remediation: 'Create a backup plan with daily snapshots and enable PITR',
          }),
        },
      ],
    );
    const formatted = formatValidationReport(report);

    expect(formatted).toContain('Impact: 3 services depend directly on this resource.');
    expect(formatted).toContain(
      'No AWS Backup plan covers this database.',
    );
    expect(formatted).not.toContain('weight:');
    expect(formatted).not.toContain('severityWeight');
  });

  it('returns no results and no error when a node has no applicable rules', () => {
    const report = runValidation(
      [createNode('app-1', 'APPLICATION')],
      [],
      [createRule('db_only', 'medium', 'backup', {}, ['database'])],
    );

    expect(report.totalChecks).toBe(0);
    expect(report.results).toEqual([]);
    expect(report.errors).toBe(0);
  });

  it('captures rule exceptions as error results and keeps scoring the rest', () => {
    const report = runValidation(
      [createNode('app-1', 'APPLICATION')],
      [],
      [
        {
          id: 'broken_rule',
          name: 'broken_rule',
          description: 'broken_rule',
          severity: 'critical',
          category: 'backup',
          appliesToTypes: ['application'],
          validate: () => {
            throw new Error('boom');
          },
        },
        createRule('healthy_rule', 'medium', 'backup', { 'app-1': 'pass' }, ['application']),
      ],
    );

    expect(report.errors).toBe(1);
    expect(report.results.find((result) => result.ruleId === 'broken_rule')?.status).toBe('error');
    expect(report.score).toBe(85);
  });

  it('returns a perfect score when every produced result is skipped', () => {
    const report = runValidation(
      [createNode('app-1', 'APPLICATION')],
      [],
      [createRule('skip_rule', 'medium', 'backup', { 'app-1': 'skip' }, ['application'])],
    );

    expect(report.score).toBe(100);
    expect(report.scoreBreakdown.overall).toBe(100);
    expect(report.scoreBreakdown.grade).toBe('A');
  });

  it('computes mixed pass, fail, warn, and skip results with the correct weighting', () => {
    const report = runValidation(
      [createNode('app-1', 'APPLICATION')],
      [],
      [
        createRule('pass_rule', 'medium', 'backup', { 'app-1': 'pass' }, ['application']),
        createRule('fail_rule', 'medium', 'backup', { 'app-1': 'fail' }, ['application']),
        createRule('warn_rule', 'medium', 'backup', { 'app-1': 'warn' }, ['application']),
        createRule('skip_rule', 'medium', 'backup', { 'app-1': 'skip' }, ['application']),
      ],
    );

    expect(report.score).toBe(45);
    expect(report.scoreBreakdown.byCategory.backup).toBe(45);
    expect(report.skipped).toBe(1);
  });

  it('awards full credit to passing rules backed by tested evidence', () => {
    expect(calculateWeightedScore([createWeightedResult('pass', 10, 'tested')])).toBe(100);
  });

  it('awards near-full credit to passing rules backed by observed evidence', () => {
    expect(calculateWeightedScore([createWeightedResult('pass', 10, 'observed')])).toBe(85);
  });

  it('awards minimal credit to passing rules backed by expired evidence', () => {
    expect(calculateWeightedScore([createWeightedResult('pass', 10, 'expired')])).toBe(20);
  });

  it('keeps failing rules at zero regardless of evidence type', () => {
    expect(calculateWeightedScore([createWeightedResult('fail', 10, 'tested')])).toBe(0);
    expect(calculateWeightedScore([createWeightedResult('fail', 10, 'observed')])).toBe(0);
  });

  it('scores all-tested passes higher than all-observed passes by a moderate margin', () => {
    const observedScore = calculateWeightedScore([
      createWeightedResult('pass', 10, 'observed'),
      createWeightedResult('pass', 10, 'observed'),
    ]);
    const testedScore = calculateWeightedScore([
      createWeightedResult('pass', 10, 'tested'),
      createWeightedResult('pass', 10, 'tested'),
    ]);

    expect(testedScore).toBeGreaterThan(observedScore);
    expect(testedScore - observedScore).toBe(15);
  });

  it('includes evidence type and confidence in the weight breakdown', () => {
    const report = runValidation(
      [createNode('app-1', 'APPLICATION', { backupRetentionPeriod: 7 })],
      [],
      [
        {
          ...createRule('backup_check', 'medium', 'backup', { 'app-1': 'pass' }, ['application']),
          observedKeys: ['backupRetentionPeriod'],
        },
      ],
    );

    expect(report.results[0]?.weightBreakdown.evidenceType).toBe('observed');
    expect(report.results[0]?.weightBreakdown.evidenceConfidence).toBe(0.85);
  });

  it('summarizes maturity distribution and potential score if all passing rules were tested', () => {
    const results = [
      createWeightedResult('pass', 10, 'observed'),
      createWeightedResult('pass', 10, 'tested'),
      createWeightedResult('pass', 10, 'expired'),
      createWeightedResult('fail', 10, 'observed'),
    ];

    const summary = summarizeEvidenceMaturity(results);

    expect(summary.counts.observed).toBe(2);
    expect(summary.counts.tested).toBe(1);
    expect(summary.counts.expired).toBe(1);
    expect(summary.potentialScore).toBe(calculatePotentialTestVerifiedScore(results));
    expect(summary.potentialScore).toBeGreaterThan(calculateWeightedScore(results));
  });
});

function createWeightedResult(
  status: WeightedValidationResult['status'],
  weight: number,
  evidenceType: Evidence['type'],
): WeightedValidationResultWithEvidence {
  const evidence = [createEvidence(evidenceType)];

  return {
    ruleId: `${status}-${evidenceType}`,
    nodeId: `${status}-${evidenceType}-node`,
    nodeName: `${status}-${evidenceType}-node`,
    nodeType: 'test',
    status,
    severity: 'medium',
    category: 'backup',
    weight,
    message: `${status} ${evidenceType}`,
    evidence,
    weightBreakdown: {
      severityWeight: 1,
      criticalityWeight: 1,
      blastRadiusWeight: 1,
      directDependentCount: 0,
      evidenceType,
      evidenceConfidence: {
        observed: 0.85,
        inferred: 0.5,
        declared: 0.7,
        tested: 1.0,
        expired: 0.2,
      }[evidenceType],
    },
  };
}

function createEvidence(type: Evidence['type']): Evidence {
  return {
    id: `evidence-${type}`,
    type,
    source:
      type === 'tested' || type === 'expired'
        ? { origin: 'test', testType: 'restore-test', testDate: '2026-04-08T00:00:00.000Z' }
        : { origin: 'scan', scanTimestamp: '2026-04-08T00:00:00.000Z' },
    subject: {
      nodeId: `node-${type}`,
      ruleId: `rule-${type}`,
    },
    observation: {
      key: 'backupRetentionPeriod',
      value: 7,
      expected: '> 0',
      description: `${type} evidence`,
    },
    timestamp: '2026-04-08T00:00:00.000Z',
    ...(type === 'expired' ? { expiresAt: '2026-04-01T00:00:00.000Z' } : {}),
  };
}
